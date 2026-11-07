const { JSDOM } = require("jsdom");
const fs = require("fs"), assert = require("assert");
const ext = require("path").join(__dirname, "..") + "/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup({ preexistingPot = false, playerRequests = true, codes = ['en','ko'], translationLanguages, failTranslate = false, translatable = true, manyCues = false, time = 3, failBatch = false }) {
  const html = '<!doctype html><div id="movie_player"></div><video class="html5-main-video"></video>';
  const dom = new JSDOM(html, { url: "https://www.youtube.com/watch?v=abc", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  const log = { fetched: [], setOption: [], unload: 0, load: 0, bg: [] };
  const cue = (t) => JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 5000, segs: [{ utf8: t }] }] });
  const many = () => JSON.stringify({ events: Array.from({ length: 100 }, (_, i) => ({ tStartMs: i * 10000, dDurationMs: 9000, segs: [{ utf8: "line " + i }] })) });

  // fake YouTube server: empty 200 unless the request carries the player's token
  w.fetch = async (u) => {
    u = String(u); log.fetched.push(u);
    const q = new URL(u).searchParams;
    const ok = q.get("pot") === "TOK" && q.get("c") === "WEB" && !(failTranslate && q.get("tlang"));
    const lang = q.get("tlang") || q.get("lang");
    const text = !ok ? "" : manyCues && lang === "en" ? many() : lang === "ko" ? cue("학교에 가요.") : cue("I go to school.");
    return { ok: true, status: 200, text: async () => text };
  };
  const entries = preexistingPot ? [{ name: "https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=TOK&c=WEB&cver=2.2" }] : [];
  Object.defineProperty(w.performance, "getEntriesByType", { value: () => entries, configurable: true });

  const track = (code) => ({ languageCode: code, isTranslatable: translatable, name: { simpleText: code }, baseUrl: `https://www.youtube.com/api/timedtext?v=abc&expire=1&sparams=v&signature=SIG&lang=${code}` });
  const player = doc.getElementById("movie_player");
  player.getPlayerResponse = () => ({ videoDetails: { videoId: "abc", title: "T" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: codes.map(track), translationLanguages: translationLanguages && translationLanguages.map((c) => ({ languageCode: c })) } } });
  player.getOption = () => ({});
  player.loadModule = () => log.load++;
  player.unloadModule = () => log.unload++;
  player.setOption = (m, o, v) => {
    log.setOption.push([m, o, v]);
    if (playerRequests && o === "track" && v && v.languageCode)
      setTimeout(() => w.fetch(`https://www.youtube.com/api/timedtext?v=abc&lang=${v.languageCode}&pot=TOK&c=WEB&cver=2.2`), 30);
  };
  const v = doc.querySelector("video");
  Object.defineProperty(v, "paused", { get: () => true }); Object.defineProperty(v, "currentTime", { get: () => time });

  w.postMessage = (data) => setTimeout(() => w.dispatchEvent(new w.MessageEvent("message", { data, source: w })), 0);
  let onMsg;
  w.chrome = { runtime: { sendMessage(msg, cb) {
      log.bg.push(msg);
      if (msg.action !== "translateBatch") return cb({ ok: false, error: "n/a" });
      setTimeout(() => (failBatch ? cb({ ok: false, error: "HTTP 429" }) : cb({ ok: true, lines: msg.texts.map((x) => "KO:" + x) })), 5);
    }, onMessage: { addListener: (f) => (onMsg = f) } },
    storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
  w.eval(fs.readFileSync(ext + "bridge.js", "utf8"));
  w.eval(fs.readFileSync(ext + "cards.js", "utf8"));
  w.eval(fs.readFileSync(ext + "content.js", "utf8"));
  const send = (req) => new Promise((r) => onMsg(req, {}, r));
  return { w, log, send, dom };
}

(async () => {
  // A) player has not requested subtitles yet -> token must be generated, shared by parallel loads
  let t = setup({});
  let res = await t.send({ action: "dualSet", settings: { enabled: true, top: "ko", bottom: "en", size: 22 } });
  assert(res.ok && res.state.status === "ok", "A: dual loads: " + JSON.stringify(res.state));
  assert(/Korean: 1 lines · English: 1 lines/.test(res.state.message), res.state.message);
  assert.equal(t.log.setOption.filter((x) => x[1] === "track").length, 1, "A: captions toggled only once for parallel loads");
  assert.equal(t.log.unload, 1, "A: captions restored (unloaded) afterwards");
  const withPot = t.log.fetched.filter((u) => u.includes("signature=SIG") && u.includes("pot=TOK"));
  assert.equal(withPot.length, 2, "A: both tracks fetched with token + original signature kept");
  assert(withPot.every((u) => u.includes("c=WEB") && u.includes("fmt=json3")));
  // popup transcript path uses the same code
  const tr = await t.send({ action: "getTranscript", baseUrl: "https://www.youtube.com/api/timedtext?v=abc&signature=SIG&lang=en", translateTo: "ko" });
  assert(tr.ok && tr.cues[0].text === "학교에 가요.", "A: popup transcript works: " + JSON.stringify(tr));
  assert(t.log.fetched.at(-1).includes("tlang=ko") && t.log.fetched.at(-1).includes("pot=TOK"), "A: translation request keeps token");
  assert.equal(t.log.setOption.filter((x) => x[1] === "track").length, 1, "A: no second toggle once token known");
  console.log("A OK: empty answer -> token borrowed from player -> both languages load (1 toggle, restored)");

  // B) token already visible in the page's network history -> player is never touched
  t = setup({ preexistingPot: true });
  res = await t.send({ action: "dualSet", settings: { enabled: true, top: "ko", bottom: "en", size: 22 } });
  assert(res.ok && res.state.status === "ok", "B: " + JSON.stringify(res.state));
  assert.equal(t.log.setOption.length, 0, "B: captions not toggled");
  console.log("B OK: token found in earlier network requests, player left alone");

  // C) token impossible to get -> clear, actionable error (not the old misleading one)
  t = setup({ playerRequests: false });
  res = await t.send({ action: "getTranscript", baseUrl: "https://www.youtube.com/api/timedtext?v=abc&signature=SIG&lang=en" });
  assert(!res.ok && /access token/.test(res.error) && /CC button/.test(res.error), "C: " + JSON.stringify(res));
  assert.equal(t.log.unload, 1, "C: captions restored even on failure");
  console.log("C OK: clear error when no token could be obtained:", res.error);


  const dual = (t) => t.send({ action: "dualSet", settings: { enabled: true, top: "ko", bottom: "en", size: 22 } });

  // D) only English exists and YouTube offers no Korean: we translate it ourselves
  t = setup({ codes: ["en"], translationLanguages: ["es", "fr"] });
  res = await dual(t); await wait(300);
  let st = (await t.send({ action: "dualGet" })).state;
  assert(st.status === "ok" && /Korean \(machine-translated from English\) · English: 1 lines/.test(st.message), "D: " + JSON.stringify(st));
  assert.equal(t.w.document.querySelector(".ytsub-top").textContent, "KO:I go to school.", "D: Korean line is ours");
  assert.equal(t.w.document.querySelector(".ytsub-bottom").textContent, "I go to school.", "D: English still displayed");
  assert(!t.log.fetched.some((u) => u.includes("tlang=ko")), "D: no pointless YouTube translate request");
  console.log("D OK:", st.message);

  // E) YouTube offers Korean but its translation comes back empty: we translate instead
  t = setup({ codes: ["en"], translationLanguages: ["ko"], failTranslate: true });
  res = await dual(t); await wait(300);
  st = (await t.send({ action: "dualGet" })).state;
  assert(st.status === "ok" && /Korean \(machine-translated from English\)/.test(st.message), "E: " + JSON.stringify(st));
  assert.equal(t.w.document.querySelector(".ytsub-top").textContent, "KO:I go to school.");
  console.log("E OK: YouTube translation failed -> extension translation used");

  // F) untranslatable track, two languages wanted: both are translated from the only track;
  //    if the translation service then refuses everything, YouTube's own captions come back
  t = setup({ codes: ["en"], translatable: false, failBatch: true });
  res = await t.send({ action: "dualSet", settings: { enabled: true, top: "ko", bottom: "ja", size: 22 } });
  assert(res.state.status !== "error", "F: starts with machine translation: " + JSON.stringify(res.state));
  await wait(6000);
  st = (await t.send({ action: "dualGet" })).state;
  assert(st.status === "error" && /Korean unavailable \(HTTP 429\).*Japanese unavailable \(HTTP 429\)/.test(st.message), "F: " + JSON.stringify(st));
  assert(!t.w.document.getElementById("ytsub-dual"), "F: overlay removed");
  assert(!t.w.document.documentElement.classList.contains("ytsub-hide-native"), "F: YouTube's own captions restored");
  console.log("F OK:", st.message);

  // G) wanted languages both exist natively -> status ok, no translation request
  t = setup({ codes: ["en", "ko"], translationLanguages: [] });
  res = await dual(t); await wait(250);
  assert(res.state.status === "ok" && !t.log.fetched.some((u) => u.includes("tlang")), JSON.stringify(res.state));
  console.log("G OK: native Korean + English -> ok, no translation used");

  // H) English only, YouTube offers no Korean -> the extension translates the English lines itself
  t = setup({ codes: ["en"], translationLanguages: ["es"] });
  res = await dual(t); await wait(300);
  assert(res.ok && res.state.status === "ok", "H: " + JSON.stringify(res.state));
  assert.equal(t.w.document.querySelector(".ytsub-top").textContent, "KO:I go to school.", "H: Korean line is our translation");
  assert.equal(t.w.document.querySelector(".ytsub-bottom").textContent, "I go to school.", "H: English line untouched");
  let state = (await t.send({ action: "dualGet" })).state;
  assert(/Korean \(machine-translated from English\)/.test(state.message) && state.status === "ok", "H: final status: " + state.message);
  assert.deepEqual([t.log.bg[0].sl, t.log.bg[0].tl], ["en", "ko"]);
  console.log("H OK:", state.message);

  // I) Korean only video -> English line is machine translated from Korean
  t = setup({ codes: ["ko"], translationLanguages: ["es"] });
  res = await dual(t); await wait(300);
  assert.equal(t.w.document.querySelector(".ytsub-top").textContent, "학교에 가요.", "I: native Korean");
  assert.equal(t.w.document.querySelector(".ytsub-bottom").textContent, "KO:학교에 가요.", "I: English line translated");
  assert.deepEqual([t.log.bg[0].sl, t.log.bg[0].tl], ["ko", "en"]);
  console.log("I OK: Korean-only video gets a machine-translated English line");

  // J) the translation service refuses (rate limit) -> original language stays, clear message, no crash
  t = setup({ codes: ["en"], translationLanguages: ["es"], failBatch: true });
  res = await dual(t); await wait(2800);
  state = (await t.send({ action: "dualGet" })).state;
  assert(state.status === "partial" && /Korean unavailable \(HTTP 429\)/.test(state.message) && /English: 1 lines/.test(state.message), JSON.stringify(state));
  assert.equal(t.w.document.querySelector(".ytsub-bottom").textContent, "I go to school.");
  console.log("J OK:", state.message);

  // K) long video: translation starts near the playhead, in small batches, never everything in one request
  t = setup({ codes: ["en"], translationLanguages: ["es"], manyCues: true, time: 500 });
  res = await dual(t); await wait(400);
  const first = t.log.bg.find((m) => m.action === "translateBatch");
  assert(first.texts.length <= 30, "K: batch size " + first.texts.length);
  assert(first.texts.includes("line 50"), "K: first batch covers the playhead (t=500s): " + first.texts[0] + ".." + first.texts.at(-1));
  assert(t.log.bg.length >= 4, "K: whole video eventually translated in batches: " + t.log.bg.length);
  t.w.document.querySelector("video").dispatchEvent(new t.w.Event("timeupdate"));
  await wait(150);
  assert.equal(t.w.document.querySelector(".ytsub-top").textContent, "KO:line 50", "K: line at 500s shown in Korean");
  state = (await t.send({ action: "dualGet" })).state;
  assert(/Korean \(machine-translated from English\)/.test(state.message), "K: finished: " + state.message);
  // toggling size must not restart a translation
  const before = t.log.bg.length;
  await t.send({ action: "dualSet", settings: { size: 28 } }); await wait(100);
  assert.equal(t.log.bg.length, before, "K: size change does not re-translate");
  console.log("K OK: playhead-first batches (" + t.log.bg.length + " requests for 100 lines), no restart on size change");
  console.log("SUBTITLE TESTS PASSED"); process.exit(0);
})().catch((e) => { console.error("FAIL:", e.stack || e); process.exit(1); });
