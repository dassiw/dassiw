// Isolated content script.
//  - talks to the popup (chrome.runtime) and to the page bridge (window.postMessage)
//  - renders the dual-language subtitle overlay on top of the YouTube player
//  - click a word -> pause, show translation + example, save to flashcards
(() => {
  if (window.__ytsubLoaded) return;
  window.__ytsubLoaded = true;

  /* ------------------------------------------------------------------ */
  /* Bridge plumbing                                                     */
  /* ------------------------------------------------------------------ */
  const pending = new Map();
  let counter = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (e.source !== window || !msg || msg.source !== "ytsub-bridge") return;
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.payload);
    }
  });

  function callBridge(type, data, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++counter}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Page bridge did not respond. Reload the YouTube tab."));
      }, timeout);
      pending.set(id, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      window.postMessage({ source: "ytsub-content", id, type, data }, "*");
    });
  }

  const currentVideoId = () => new URL(location.href).searchParams.get("v");
  const getVideo = () => document.querySelector("video.html5-main-video") || document.querySelector("video");

  async function getTracks() {
    const info = await callBridge("GET_TRACKS");
    // YouTube is a single-page app: make sure data belongs to the video on screen.
    if (info.videoId && currentVideoId() && info.videoId !== currentVideoId()) {
      await sleep(800);
      return callBridge("GET_TRACKS");
    }
    return info;
  }

  async function getTracksRetry(tries = 4) {
    let info = await getTracks();
    for (let i = 1; i < tries && !info.tracks.length; i++) {
      await sleep(1000);
      info = await getTracks();
    }
    return info;
  }

  // YouTube answers subtitle downloads with an empty 200 unless the request
  // carries the player's proof-of-origin token (`pot`). We try a plain request
  // first, and on an empty answer retry with the token borrowed from the player
  // (see bridge.js). Once a video needs it, every later request uses it directly.
  const needsPot = new Set();

  async function fetchTrackText(url) {
    const res = await fetch(url.toString(), { credentials: "include" });
    const text = res.ok ? await res.text() : "";
    return { status: res.status, text: text.trim() };
  }

  async function fetchWithPot(url, videoId) {
    const lang = url.searchParams.get("lang") || undefined;
    const { pot } = await callBridge("GET_POT", { videoId, lang }, 9000);
    if (!pot) return { status: 0, text: "", noPot: true };
    const withPot = new URL(url.toString());
    Object.entries(pot).forEach(([k, v]) => withPot.searchParams.set(k, v));
    return fetchTrackText(withPot);
  }

  async function getTranscript({ baseUrl, translateTo }) {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    if (translateTo) url.searchParams.set("tlang", translateTo);
    const videoId = url.searchParams.get("v") || currentVideoId();

    // Decide once, up front: a parallel request may flag the video while this one is in flight.
    const startedWithPot = needsPot.has(videoId);
    let r = startedWithPot ? await fetchWithPot(url, videoId) : await fetchTrackText(url);
    if (!r.text && !startedWithPot) {
      needsPot.add(videoId);
      r = await fetchWithPot(url, videoId);
    }
    if (!r.text) {
      throw new Error(
        r.noPot
          ? "Could not get YouTube's access token for the subtitles. Reload the tab, or press the CC button on the player once and try again."
          : translateTo
            ? `YouTube returned nothing when auto-translating to ${langName(translateTo)} (HTTP ${r.status})`
            : `YouTube returned an empty subtitle file for this track (HTTP ${r.status}). Reload the tab and try again.`
      );
    }
    let json;
    try {
      json = JSON.parse(r.text);
    } catch (_) {
      throw new Error("YouTube returned subtitles in an unreadable format.");
    }
    return (json.events || [])
      .filter((ev) => ev.segs)
      .map((ev) => ({
        start: (ev.tStartMs || 0) / 1000,
        dur: (ev.dDurationMs || 0) / 1000,
        text: ev.segs.map((s) => s.utf8).join("").replace(/\s*\n\s*/g, " ").trim(),
      }))
      .filter((c) => c.text);
  }

  const sendBg = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, error: "No response from the extension." });
        });
      } catch (err) {
        resolve({ ok: false, error: "Extension was updated. Reload this YouTube tab." });
      }
    });

  /* ------------------------------------------------------------------ */
  /* Dual subtitles                                                      */
  /* ------------------------------------------------------------------ */
  const DEFAULTS = { enabled: false, top: "ko", bottom: "en", size: 22 };
  const LANG_NAMES = {
    ko: "Korean", en: "English", ja: "Japanese", "zh-Hans": "Chinese",
    es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ru: "Russian", hi: "Hindi",
  };
  const langName = (c) => LANG_NAMES[c] || c;

  let settings = { ...DEFAULTS };
  let state = { status: "off", message: "" };
  let cuesTop = [];
  let cuesBottom = [];
  let loadedKey = null;
  let loadToken = 0;
  let overlay = null, topEl = null, bottomEl = null, tickTimer = null;
  let lastTop = "", lastBottom = "", lastWidth = 0;

  // Prefer a real track in the wanted language (manual before auto-generated).
  // If none exists, ask YouTube to machine-translate the best available track.
  function pickTrack(tracks, lang, translationLangs) {
    const match = tracks.filter(
      (t) => t.languageCode === lang || t.languageCode.startsWith(lang + "-")
    );
    if (match.length) {
      return { track: match.find((t) => !t.auto) || match[0], translateTo: null };
    }
    // No real track: only auto-translate when YouTube says that is possible.
    if (translationLangs && !translationLangs.includes(lang)) {
      return { track: null, reason: `YouTube does not offer auto-translation to ${langName(lang)} for this video` };
    }
    const sources = tracks.filter((t) => t.translatable !== false);
    if (!sources.length) {
      return { track: null, reason: "this video's subtitles cannot be auto-translated" };
    }
    return { track: sources.find((t) => !t.auto) || sources[0], translateTo: lang };
  }

  // Cue active at time t (cues are sorted by start time).
  function textAt(cues, t) {
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let i = idx; i >= 0 && i > idx - 4; i--) {
      const c = cues[i];
      if (t < c.start + (c.dur || 2)) return c.text;
    }
    return "";
  }

  function injectStyle() {
    if (document.getElementById("ytsub-style")) return;
    const style = document.createElement("style");
    style.id = "ytsub-style";
    style.textContent = `
      #ytsub-dual{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);
        width:84%;display:flex;flex-direction:column;align-items:center;gap:4px;
        text-align:center;z-index:60;pointer-events:none;}
      .ytsub-line{display:inline-block;max-width:100%;padding:2px 10px;border-radius:4px;
        background:rgba(8,8,8,.75);color:#fff;line-height:1.35;
        text-shadow:0 1px 2px #000;font-family:"YouTube Noto","Noto Sans KR","Malgun Gothic",Roboto,Arial,sans-serif;}
      .ytsub-line:empty{display:none;}
      .ytsub-top{color:#ffe082;font-weight:500;}
      .ytsub-word{pointer-events:auto;cursor:pointer;border-radius:3px;user-select:none;-webkit-user-select:none;}
      .ytsub-word:hover{background:rgba(255,255,255,.28);}
      .ytsub-word.ytsub-sel{background:#ffd54f;color:#111;text-shadow:none;}
      html.ytsub-hide-native .ytp-caption-window-container{display:none !important;}

      #ytsub-card{position:absolute;top:5%;left:50%;transform:translateX(-50%);
        width:min(440px,92%);max-height:80%;overflow:auto;z-index:70;box-sizing:border-box;
        background:rgba(20,20,26,.97);color:#f1f1f1;border-radius:12px;padding:14px 16px;
        font:14px/1.45 Roboto,"Noto Sans KR","Malgun Gothic",Arial,sans-serif;text-align:left;
        box-shadow:0 10px 40px rgba(0,0,0,.65);cursor:default;}
      #ytsub-card *{box-sizing:border-box;}
      .ytsub-c-head{display:flex;align-items:baseline;gap:10px;}
      .ytsub-c-word{font-size:24px;font-weight:700;color:#ffe082;}
      .ytsub-c-rom{flex:1;color:#9aa4b2;font-size:13px;}
      .ytsub-c-close{margin-left:auto;background:none;border:0;color:#aaa;font-size:16px;cursor:pointer;padding:2px 6px;}
      .ytsub-c-close:hover{color:#fff;}
      .ytsub-c-trans{font-size:19px;margin:6px 0 2px;}
      .ytsub-c-trans.err{font-size:13px;color:#f28b82;}
      .ytsub-c-defs{color:#b8c0cc;font-size:13px;}
      .ytsub-c-defs div{margin-top:2px;}
      .ytsub-c-sec{margin-top:10px;padding-top:8px;border-top:1px solid #333;}
      .ytsub-c-label{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#8a93a0;margin-bottom:3px;}
      .ytsub-c-ex{font-size:15px;}
      .ytsub-c-ex2{font-size:13px;color:#aeb6c2;margin-top:2px;}
      .ytsub-c-more div{font-size:13px;color:#cfd5de;margin-top:2px;}
      .ytsub-hl{background:#ffd54f;color:#111;border-radius:3px;padding:0 2px;}
      .ytsub-c-save{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;}
      .ytsub-c-save select,.ytsub-c-save input{flex:1;min-width:120px;padding:6px 8px;border-radius:6px;
        border:1px solid #444;background:#2a2a33;color:#fff;font:inherit;font-size:13px;}
      .ytsub-c-add{padding:6px 12px;border-radius:6px;border:0;background:#3ea6ff;color:#06121f;
        font:inherit;font-size:13px;font-weight:600;cursor:pointer;}
      .ytsub-c-add:disabled{background:#3a3f4a;color:#9aa4b2;cursor:default;}
      .ytsub-c-msg{min-height:16px;margin-top:6px;font-size:12px;color:#81c995;}
    `;
    document.documentElement.appendChild(style);
  }

  function ensureOverlay() {
    const player = document.getElementById("movie_player");
    if (!player) return false;
    if (!overlay || !overlay.isConnected) {
      injectStyle();
      overlay = document.createElement("div");
      overlay.id = "ytsub-dual";
      topEl = document.createElement("div");
      topEl.className = "ytsub-line ytsub-top";
      bottomEl = document.createElement("div");
      bottomEl.className = "ytsub-line ytsub-bottom";
      overlay.append(topEl, bottomEl);
      // Keep word clicks from toggling YouTube's play/pause.
      ["mousedown", "mouseup", "pointerdown", "dblclick"].forEach((type) =>
        overlay.addEventListener(type, (e) => { if (e.target.closest(".ytsub-word")) e.stopPropagation(); })
      );
      overlay.addEventListener("click", (e) => {
        const w = e.target.closest(".ytsub-word");
        if (!w) return;
        e.stopPropagation();
        e.preventDefault();
        openWordCard(w);
      });
      player.appendChild(overlay);
      lastTop = lastBottom = "";
      lastWidth = 0;
    }
    return true;
  }

  // Each word becomes a clickable span (text only, never HTML).
  function renderLine(el, text, side) {
    el.textContent = "";
    for (const tok of text.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { el.appendChild(document.createTextNode(" ")); continue; }
      const span = document.createElement("span");
      span.className = "ytsub-word";
      span.dataset.side = side;
      span.textContent = tok;
      el.appendChild(span);
    }
  }

  function tick() {
    if (!ensureOverlay()) return;
    const video = getVideo();
    if (!video) return;
    const t = video.currentTime;
    const a = textAt(cuesTop, t);
    const b = textAt(cuesBottom, t);
    if (a !== lastTop) { renderLine(topEl, a, "top"); lastTop = a; }
    if (b !== lastBottom) { renderLine(bottomEl, b, "bottom"); lastBottom = b; }
    const w = overlay.parentElement.clientWidth;
    if (w !== lastWidth) {
      lastWidth = w;
      const scale = Math.min(2.2, Math.max(0.7, w / 800));
      overlay.style.fontSize = `${(settings.size * scale).toFixed(1)}px`;
    }
  }

  function startDual() {
    if (!ensureOverlay()) return;
    document.documentElement.classList.add("ytsub-hide-native");
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 100);
    tick();
  }

  function stopDual() {
    clearInterval(tickTimer);
    tickTimer = null;
    closeCard(false);
    document.documentElement.classList.remove("ytsub-hide-native");
    if (overlay) overlay.remove();
    overlay = topEl = bottomEl = null;
    lastTop = lastBottom = "";
    lastWidth = 0;
  }

  /* ---- status text, one entry per subtitle line (top, bottom) ---- */
  // { lang, kind: "native" | "youtube" | "machine" | "error", n, from, pct, warn, error }
  let langInfo = [null, null];

  function rebuildState() {
    const present = langInfo.filter(Boolean);
    const describe = (i) =>
      i.kind === "error" ? `${langName(i.lang)} unavailable (${i.error})`
      : i.kind === "machine"
        ? `${langName(i.lang)} (machine-translated from ${langName(i.from)}${i.pct < 100 ? `, ${i.pct}%` : ""}${i.warn ? `, ${i.warn}` : ""})`
      : `${langName(i.lang)}${i.kind === "youtube" ? " (auto-translated)" : ""}: ${i.n} lines`;
    state = {
      status: present.length && present.every((i) => i.kind === "error") ? "error"
        : present.some((i) => i.kind === "error") ? "partial" : "ok",
      message: present.map(describe).join(" · "),
    };
  }

  // Google's codes: "zh-CN"/"zh-TW" for Chinese, bare language otherwise.
  const gLang = (c) => {
    c = String(c || "auto");
    if (/^zh/.test(c)) return /Hant|TW|HK/.test(c) ? "zh-TW" : "zh-CN";
    return c.split("-")[0];
  };

  // Translates subtitle lines ourselves (used when YouTube has no track in a language
  // and will not auto-translate one). Lines are sent in small batches, nearest to the
  // playhead first, so subtitles appear quickly and long videos are not translated up front.
  function startMachineTranslation(srcCues, sl, tl, index, token) {
    const out = srcCues.map((c) => ({ start: c.start, dur: c.dur, text: "" }));
    const chunks = [];
    let cur = [], len = 0;
    srcCues.forEach((c, i) => {
      const size = encodeURIComponent(c.text).length + 3;
      if (cur.length && (len + size > 3500 || cur.length >= 30)) { chunks.push(cur); cur = []; len = 0; }
      cur.push(i);
      len += size;
    });
    if (cur.length) chunks.push(cur);

    const info = langInfo[index];
    const remaining = chunks.slice();
    let finished = 0, failed = 0, strikes = 0, lastError = "";
    const valid = () => token === loadToken;

    const nextChunk = () => {
      const v = getVideo();
      const t = v ? v.currentTime : 0;
      let best = -1, bestD = Infinity;
      remaining.forEach((ch, k) => {
        const start = srcCues[ch[0]].start;
        const end = srcCues[ch[ch.length - 1]].start;
        // the batch holding the playhead first, then what is coming up, then what was already played
        const d = t >= start && t <= end ? 0 : start > t ? start - t : (t - end) * 2;
        if (d < bestD) { bestD = d; best = k; }
      });
      return best < 0 ? null : remaining.splice(best, 1)[0];
    };

    async function worker() {
      for (;;) {
        if (!valid() || strikes >= 3) return;
        const ch = nextChunk();
        if (!ch) return;
        const req = { action: "translateBatch", texts: ch.map((i) => srcCues[i].text), sl, tl };
        let res = await sendBg(req);
        if (!res.ok && valid()) { await sleep(1200); res = await sendBg(req); }
        if (!valid()) return;
        if (res.ok) {
          ch.forEach((i, k) => { out[i].text = res.lines[k] || ""; });
          strikes = 0;
          finished++;
        } else {
          failed++;
          strikes++;
          lastError = res.error || "translation failed";
        }
        info.pct = Math.round((100 * finished) / chunks.length);
        rebuildState();
      }
    }

    const done = Promise.all([worker(), worker(), worker()]).then(() => {
      if (!valid()) return;
      if (!finished) { info.kind = "error"; info.error = lastError || "translation failed"; }
      else if (failed || remaining.length) info.warn = "some lines could not be translated";
      rebuildState();
      if (state.status === "error") {
        // Nothing usable ended up on screen: hand the video back to YouTube's own captions.
        loadedKey = null;
        stopDual();
      }
    });
    return { cues: out, done };
  }

  async function loadDual() {
    // Same video and languages already loaded: just show it (keeps a running translation alive).
    if (settings.enabled && location.pathname.startsWith("/watch")) {
      const sameKey = `${currentVideoId()}|${settings.top}|${settings.bottom}`;
      if (sameKey === loadedKey && (cuesTop.length || cuesBottom.length)) {
        startDual();
        return;
      }
    }
    const token = ++loadToken;
    if (!settings.enabled || !location.pathname.startsWith("/watch")) {
      stopDual();
      state = { status: "off", message: settings.enabled ? "Open a YouTube video to see subtitles." : "Dual subtitles are off." };
      return;
    }
    const key = `${currentVideoId()}|${settings.top}|${settings.bottom}`;
    state = { status: "loading", message: "Loading subtitles…" };
    try {
      const info = await getTracksRetry();
      if (!info.tracks.length) throw new Error("This video has no subtitles available.");
      const wanted = [settings.top, settings.bottom];
      // Each language is loaded on its own: if one fails, the other still shows.
      const results = await Promise.all(
        wanted.map(async (lang) => {
          if (!lang) return { skipped: true, cues: [], translated: false };
          try {
            const pick = pickTrack(info.tracks, lang, info.translationLanguages);
            if (!pick.track) throw new Error(pick.reason);
            const cues = await getTranscript({ baseUrl: pick.track.baseUrl, translateTo: pick.translateTo });
            if (!cues.length) throw new Error("the subtitle file has no lines");
            return { cues, translated: !!pick.translateTo };
          } catch (err) {
            return { cues: [], translated: false, error: err.message || "failed to load" };
          }
        })
      );
      if (token !== loadToken) return; // a newer request superseded this one

      // A language that failed is filled in by translating the other one ourselves.
      let source = null; // { cues, lang }
      if (wanted.some((l, i) => l && results[i].error)) {
        const have = wanted.findIndex((l, i) => l && !results[i].error && results[i].cues.length);
        if (have >= 0) {
          source = { cues: results[have].cues, lang: wanted[have] };
        } else {
          try {
            const t = info.tracks.find((x) => !x.auto) || info.tracks[0];
            const cues = await getTranscript({ baseUrl: t.baseUrl, translateTo: null });
            if (cues.length) source = { cues, lang: t.languageCode };
          } catch (_) {}
        }
        if (token !== loadToken) return;
      }

      langInfo = [null, null];
      wanted.forEach((lang, i) => {
        if (!lang) return;
        const r = results[i];
        if (!r.error) {
          langInfo[i] = { lang, kind: r.translated ? "youtube" : "native", n: r.cues.length };
        } else if (!source) {
          langInfo[i] = { lang, kind: "error", error: r.error };
        } else if (gLang(source.lang) === gLang(lang)) {
          results[i] = { cues: source.cues, translated: false };
          langInfo[i] = { lang, kind: "native", n: source.cues.length };
        } else {
          langInfo[i] = { lang, kind: "machine", from: source.lang, pct: 0, warn: "" };
          results[i] = { cues: startMachineTranslation(source.cues, gLang(source.lang), gLang(lang), i, token).cues };
        }
      });

      cuesTop = results[0].cues;
      cuesBottom = results[1].cues;
      loadedKey = key;
      rebuildState();
      if (state.status === "error") {
        throw new Error(langInfo.filter(Boolean).map((i) => `${langName(i.lang)}: ${i.error}.`).join(" "));
      }
      startDual();
    } catch (err) {
      if (token !== loadToken) return;
      stopDual();
      state = { status: "error", message: err.message };
    }
  }

  function saveSettings() {
    try {
      chrome.storage.local.set({ dualSettings: settings });
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Word lookup card + saving to flashcards                             */
  /* ------------------------------------------------------------------ */
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  const NEW_FOLDER = "__new__";
  const cleanWord = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function highlight(container, text, word) {
    container.textContent = "";
    const i = text.toLowerCase().indexOf(word.toLowerCase());
    if (i < 0) { container.textContent = text; return; }
    container.append(
      document.createTextNode(text.slice(0, i)),
      el("mark", "ytsub-hl", text.slice(i, i + word.length)),
      document.createTextNode(text.slice(i + word.length))
    );
  }

  let card = null; // { el, wordEl, resume, onPlay }

  function closeCard(resume = true) {
    if (!card) return;
    const c = card;
    card = null;
    c.el.remove();
    c.wordEl.classList.remove("ytsub-sel");
    const video = getVideo();
    if (video) video.removeEventListener("play", c.onPlay);
    if (resume && c.resume && video) video.play().catch(() => {});
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (card && e.key === "Escape") closeCard(true);
    },
    true
  );

  async function openWordCard(wordEl) {
    const word = cleanWord(wordEl.textContent);
    const video = getVideo();
    const player = document.getElementById("movie_player");
    if (!word || !video || !player) return;

    // Remember whether the video was playing before the *first* click.
    const resume = card ? card.resume : !video.paused;
    closeCard(false);
    video.pause();

    const side = wordEl.dataset.side;
    const sentence = side === "top" ? lastTop : lastBottom;
    let otherText = side === "top" ? lastBottom : lastTop;
    const isKo = HANGUL.test(word);
    const front = isKo ? word : word.toLowerCase();
    const videoId = currentVideoId();
    const videoTime = video.currentTime;

    /* ---- build the card ---- */
    const root = el("div");
    root.id = "ytsub-card";
    ["click", "mousedown", "mouseup", "pointerdown", "dblclick", "keydown", "keyup", "keypress", "wheel", "contextmenu"].forEach((t) =>
      root.addEventListener(t, (e) => e.stopPropagation())
    );

    const head = el("div", "ytsub-c-head");
    const rom = el("span", "ytsub-c-rom");
    const closeBtn = el("button", "ytsub-c-close", "✕");
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("click", () => closeCard(true));
    head.append(el("span", "ytsub-c-word", word), rom, closeBtn);

    const trans = el("div", "ytsub-c-trans", "Translating…");
    const defsEl = el("div", "ytsub-c-defs");

    const exSec = el("div", "ytsub-c-sec");
    const exSrc = el("div", "ytsub-c-ex");
    highlight(exSrc, sentence, word);
    const exOther = el("div", "ytsub-c-ex2", otherText);
    exSec.append(el("div", "ytsub-c-label", "Example from this video"), exSrc, exOther);

    const moreSec = el("div", "ytsub-c-sec ytsub-c-more");
    moreSec.hidden = true;

    const saveRow = el("div", "ytsub-c-save");
    const folderSel = el("select");
    folderSel.title = "Flashcard folder";
    const newInput = el("input");
    newInput.type = "text";
    newInput.placeholder = "New folder name";
    newInput.maxLength = 40;
    newInput.hidden = true;
    const addBtn = el("button", "ytsub-c-add", "Add to flashcards");
    addBtn.disabled = true;
    saveRow.append(folderSel, newInput, addBtn);
    const msg = el("div", "ytsub-c-msg");

    root.append(head, trans, defsEl, exSec, moreSec, saveRow, msg);
    player.appendChild(root);
    wordEl.classList.add("ytsub-sel");

    const me = { el: root, wordEl, resume, onPlay: () => closeCard(false) };
    card = me;
    video.addEventListener("play", me.onPlay);

    /* ---- lookup state ---- */
    let result = null; // translation payload from the background worker
    let ready = false; // translation attempt finished (success or failure)
    let data = null;   // flashcard storage snapshot

    function fillFolders(selectedId) {
      folderSel.textContent = "";
      data.folders.forEach((f) => folderSel.add(new Option(f.name, f.id)));
      folderSel.add(new Option("＋ New folder…", NEW_FOLDER));
      folderSel.value = data.folders.some((f) => f.id === selectedId) ? selectedId : "default";
    }

    function refreshSaveState() {
      const isNew = folderSel.value === NEW_FOLDER;
      newInput.hidden = !isNew;
      const dup = !isNew && data && YTCards.findCard(data.cards, front, folderSel.value);
      addBtn.disabled = !ready || !!dup;
      addBtn.textContent = dup ? "✓ Already saved here" : "Add to flashcards";
    }

    folderSel.addEventListener("change", () => {
      msg.textContent = "";
      refreshSaveState();
      if (!newInput.hidden) newInput.focus();
    });

    async function save() {
      if (addBtn.disabled) return;
      addBtn.disabled = true;
      msg.style.color = "";
      try {
        let folderId = folderSel.value;
        if (folderId === NEW_FOLDER) folderId = (await YTCards.addFolder(newInput.value)).id;
        const defsText = result
          ? result.defs.map((d) => (d.pos ? d.pos + ": " : "") + d.terms.join(", ")).join(" · ")
          : "";
        const r = await YTCards.addCard({
          front,
          back: result ? result.translation : "",
          romanization: result && result.romanization !== word ? result.romanization : "",
          extra: defsText,
          example: sentence,
          exampleTr: otherText,
          lang: isKo ? "ko" : "other",
          videoId,
          videoTime,
          folderId,
        });
        data = await YTCards.load();
        newInput.value = "";
        fillFolders(folderId);
        refreshSaveState();
        const name = (data.folders.find((f) => f.id === folderId) || {}).name || "folder";
        msg.textContent = r.duplicate ? `Already in “${name}”.` : `Saved to “${name}” ✓`;
      } catch (err) {
        msg.style.color = "#f28b82";
        msg.textContent = err.message || "Could not save the word.";
        refreshSaveState();
      }
    }
    addBtn.addEventListener("click", save);
    newInput.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

    /* ---- async: folders ---- */
    YTCards.load().then((d) => {
      if (card !== me) return;
      data = d;
      fillFolders(d.settings.lastFolderId);
      refreshSaveState();
    });

    /* ---- async: translation, dictionary, extra example ---- */
    const tl = isKo ? "en" : "ko";
    const sl = isKo ? "ko" : "auto";
    sendBg({ action: "translate", text: word, sl, tl }).then((res) => {
      if (card !== me) return;
      ready = true;
      if (res.ok) {
        result = res;
        trans.textContent = res.translation;
        if (res.romanization && res.romanization.toLowerCase() !== word.toLowerCase()) rom.textContent = res.romanization;
        res.defs.forEach((d) => defsEl.appendChild(el("div", null, (d.pos ? d.pos + ": " : "") + d.terms.join(", "))));
        if (res.examples.length) {
          moreSec.hidden = false;
          moreSec.appendChild(el("div", "ytsub-c-label", "More examples"));
          res.examples.forEach((x) => moreSec.appendChild(el("div", null, x)));
        }
      } else {
        trans.classList.add("err");
        trans.textContent = `Couldn't load the translation (${res.error}). You can still save the word.`;
      }
      refreshSaveState();
    });

    // Only one subtitle line is on screen: translate the sentence for the example.
    if (!otherText && sentence) {
      sendBg({ action: "translate", text: sentence, sl: HANGUL.test(sentence) ? "ko" : "auto", tl }).then((res) => {
        if (card !== me || !res.ok) return;
        otherText = res.translation;
        exOther.textContent = otherText;
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */
  // Watch for YouTube's single-page navigation to a different video.
  let lastVideo = currentVideoId();
  setInterval(() => {
    const v = currentVideoId();
    if (v === lastVideo) return;
    lastVideo = v;
    loadToken++; // cancels any running load / translation
    loadedKey = null;
    cuesTop = [];
    cuesBottom = [];
    closeCard(false);
    if (settings.enabled) setTimeout(loadDual, 600);
  }, 1000);

  try {
    chrome.storage.local.get("dualSettings", (r) => {
      settings = { ...DEFAULTS, ...((r && r.dualSettings) || {}) };
      if (settings.enabled) loadDual();
    });
  } catch (_) {}

  /* ------------------------------------------------------------------ */
  /* Messages from the popup                                             */
  /* ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    (async () => {
      try {
        switch (req.action) {
          case "ping":
            return { ok: true, videoId: currentVideoId() };
          case "getTracks":
            return { ok: true, ...(await getTracks()) };
          case "getTranscript":
            return { ok: true, cues: await getTranscript(req) };
          case "seek":
            await callBridge("SEEK", { seconds: req.seconds });
            return { ok: true };
          case "getTime":
            return { ok: true, ...(await callBridge("GET_TIME")) };
          case "dualGet":
            return { ok: true, settings, state };
          case "dualSet":
            settings = { ...settings, ...req.settings };
            saveSettings();
            lastWidth = 0;
            await loadDual();
            return { ok: true, settings, state };
          default:
            return { ok: false, error: "Unknown action" };
        }
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })().then(sendResponse);
    return true; // keep channel open for async response
  });
})();
