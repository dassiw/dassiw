const { JSDOM } = require("jsdom");
const fs = require("fs"), assert = require("assert");
const ext = require("path").join(__dirname, "..") + "/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5, MIN = 6e4;
const fx = require("./fixtures.js");

function storageMock(seed) {
  const mem = seed ? JSON.parse(JSON.stringify(seed)) : {};
  return { mem, api: {
    get: (k, cb) => { const r = { [k]: mem[k] }; if (cb) { cb(r); return; } return Promise.resolve(r); },
    set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); if (cb) { cb(); return; } return Promise.resolve(); },
    remove: (k, cb) => { delete mem[k]; if (cb) { cb(); return; } return Promise.resolve(); },
  } };
}
const key = (win, k, opts = {}) => win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));

async function testReview() {
  const now = Date.now();
  const mk = (id, front, back) => ({ id, front, back, folderId: "default", created: now, due: now - 1000, goodCount: 0, example: front + " 예문", exampleTr: "example", videoId: "abc", videoTime: 5 });
  const st = storageMock({ ytcards: { folders: [{ id: "default", name: "Default" }], cards: [mk("a", "학교", "school"), mk("b", "집", "house")], settings: {} } });
  const dom = await JSDOM.fromFile(ext + "review.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) { w.chrome = { runtime: {}, storage: { local: st.api, onChanged: { addListener() {} } } }; },
  });
  const w = dom.window, $ = (id) => w.document.getElementById(id);
  await new Promise((r) => w.addEventListener("load", r)); await wait(100);
  assert.equal($("front").textContent, "학교", "first due card shown");
  assert($("rate").hidden, "rating hidden before reveal");
  key(w, "4"); await wait(30);
  assert.equal(st.mem.ytcards.cards[0].goodCount || 0, 0, "1-4 ignored before answer is shown");
  key(w, " "); await wait(30);
  assert(!$("rate").hidden && $("back").textContent === "school", "answer revealed");
  assert.equal($("int-repeat").textContent, "<1 min"); assert.equal($("int-hard").textContent, "3 min");
  assert.equal($("int-normal").textContent, "10 min"); assert.equal($("int-good").textContent, "1 day");
  const t0 = Date.now(); key(w, "4"); await wait(60);
  let a = st.mem.ytcards.cards.find((c) => c.id === "a");
  assert.equal(a.goodCount, 1); assert(Math.abs(a.due - (t0 + DAY)) < 2000, "Good -> +1 day");
  assert.equal($("front").textContent, "집", "moved to next card");
  key(w, " "); key(w, "1"); await wait(60);
  let b = st.mem.ytcards.cards.find((c) => c.id === "b");
  assert(b.due - t0 < MIN && b.due > t0, "Repeat -> under a minute");
  assert($("card").hidden && /Next card in/.test($("emptyText").textContent), "countdown shown when nothing due: " + $("emptyText").textContent);
  w.close(); console.log("review page: keys 1-4, reveal, scheduling, countdown OK");
}

async function testContent() {
  const st = storageMock({});
  const html = '<!doctype html><div id="movie_player"><video class="html5-main-video"></video></div>';
  const dom = new JSDOM(html, { url: "https://www.youtube.com/watch?v=abc", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  // fake <video>
  const v = doc.querySelector("video"); let paused = false, played = 0;
  Object.defineProperty(v, "paused", { get: () => paused });
  Object.defineProperty(v, "currentTime", { get: () => 3 });
  v.pause = () => { paused = true; v.dispatchEvent(new w.Event("pause")); };
  v.play = () => { paused = false; played++; v.dispatchEvent(new w.Event("play")); return Promise.resolve(); };
  // postMessage with a proper event.source, plus a fake page bridge
  w.postMessage = (data) => setTimeout(() => w.dispatchEvent(new w.MessageEvent("message", { data, source: w })), 0);
  w.addEventListener("message", (e) => {
    const m = e.data; if (!m || m.source !== "ytsub-content") return;
    if (m.type === "GET_TRACKS") w.postMessage({ source: "ytsub-bridge", id: m.id, payload: { videoId: "abc", title: "T", tracks: [
      { languageCode: "ko", name: "Korean", baseUrl: "https://www.youtube.com/api/timedtext?lang=ko" },
      { languageCode: "en", name: "English", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" }] } });
  });
  const cue = (t) => JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 5000, segs: [{ utf8: t }] }] });
  w.fetch = async (u) => ({ ok: true, text: async () => (u.includes("lang=ko") ? cue("학교에 가요.") : cue("I go to school.")) });
  const sent = []; let onMsg; let noKey = false;
  w.chrome = { runtime: {
    sendMessage: (msg, cb) => {
      if (msg.action === "krdict") { setTimeout(() => cb(noKey ? { ok: false, error: "No dictionary key set", noKey: true } : { ok: true, text: msg.q === "학교" ? fx.XML_SCHOOL : fx.XML_EMPTY }), 5); return; }
      sent.push(msg); setTimeout(() => cb({ ok: true, translation: msg.text.includes("가요") ? "I go." : "to school", romanization: "hakgyoe",
      defs: [{ pos: "noun", terms: ["school"] }], examples: ["그는 학교에 갔다"] }), 5); },
    onMessage: { addListener: (f) => (onMsg = f) } },
    storage: { local: st.api } };
  w.eval(fs.readFileSync(ext + "cards.js", "utf8")); w.eval(fs.readFileSync(ext + "krdict.js", "utf8")); w.eval(fs.readFileSync(ext + "content.js", "utf8"));

  const res = await new Promise((r) => onMsg({ action: "dualSet", settings: { enabled: true, top: "ko", bottom: "en", size: 22 } }, {}, r));
  assert(res.ok && res.state.status === "ok", "dual loaded: " + JSON.stringify(res.state));
  await wait(250);
  const words = [...doc.querySelectorAll(".ytsub-top .ytsub-word")].map((n) => n.textContent);
  assert.deepEqual(words, ["학교에", "가요."], "top line split into word spans");
  assert.equal(doc.querySelectorAll(".ytsub-bottom .ytsub-word").length, 4, "bottom line words too");

  // click a word
  doc.querySelector(".ytsub-top .ytsub-word").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert(paused, "video paused on click");
  await wait(80);
  const card = doc.getElementById("ytsub-card");
  assert(card, "card shown");
  const txt = card.textContent;
  assert(txt.includes("학교에") && txt.includes("to school") && txt.includes("hakgyoe"), "word, translation, romanization: " + txt);
  assert(txt.includes("학교에 가요.") && txt.includes("I go to school."), "example sentence in both languages");
  assert(txt.includes("그는 학교에 갔다"), "extra example");
  assert.equal(sent[0].sl, "ko"); assert.equal(sent[0].tl, "en");
  const ctext = card.textContent;
  assert(ctext.includes("Dictionary · 한국어기초사전") && ctext.includes("Basic form: 학교"), "dictionary section + basic form: " + ctext);
  assert(ctext.includes("명사") && ctext.includes("어휘등급 초급") && ctext.includes("1. 교사가 학생을 가르치는 기관.") && ctext.includes("2. 수업을 하는 일.") && ctext.includes("— school"), "pos, level, numbered meanings, English gloss");
  assert(!ctext.includes("어휘등급 없음"), "'없음' level hidden");
  const links = card.querySelectorAll("a.ytsub-c-dlink");
  assert.equal(links.length, 1, "only the official dictionary link is shown");
  assert(links[0].href.startsWith("https://krdict.korean.go.kr/") && links[0].rel === "noopener" && links[0].target === "_blank");

  // save into a NEW folder
  const sel = card.querySelector("select"); sel.value = "__new__"; sel.dispatchEvent(new w.Event("change"));
  const inp = card.querySelector("input"); assert(!inp.hidden, "new folder input visible");
  inp.value = "Drama"; card.querySelector(".ytsub-c-add").click(); await wait(60);
  const saved = st.mem.ytcards;
  const folder = saved.folders.find((f) => f.name === "Drama");
  assert(folder && saved.cards.length === 1, "folder + card stored");
  const c = saved.cards[0];
  assert.equal(c.front, "학교에"); assert.equal(c.back, "to school"); assert.equal(c.folderId, folder.id);
  assert(c.extra.startsWith("학교 · 명사 · 어휘등급 초급\n1. 교사가 학생을 가르치는 기관. — school"), "saved card keeps meanings: " + c.extra);
  assert.equal(c.example, "학교에 가요."); assert.equal(c.exampleTr, "I go to school."); assert.equal(c.videoId, "abc");
  assert(/Saved/.test(card.querySelector(".ytsub-c-msg").textContent), "saved message");
  // saving again says already saved
  assert(card.querySelector(".ytsub-c-add").disabled && /Already/.test(card.querySelector(".ytsub-c-add").textContent), "duplicate blocked");

  // Escape closes and resumes playback
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(!doc.getElementById("ytsub-card"), "card closed by Esc"); assert(!paused && played === 1, "video resumed");

  // clicking an English word translates to Korean; video already paused -> must NOT auto-resume
  paused = true; sent.length = 0;
  doc.querySelectorAll(".ytsub-bottom .ytsub-word")[3].dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wait(40);
  assert.equal(sent[0].text, "school"); assert.equal(sent[0].tl, "ko", "English word -> Korean");
  doc.querySelector("#ytsub-card .ytsub-c-close").click();
  assert(paused && played === 1, "stays paused if it was paused before"); 
  // no dictionary key: clear hint, and the word can still be saved
  noKey = true; paused = true;
  doc.querySelectorAll(".ytsub-top .ytsub-word")[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wait(80);
  const c2 = doc.getElementById("ytsub-card");
  assert(/Meanings need a free dictionary key/.test(c2.textContent), "no-key hint: " + c2.textContent);
  assert(!c2.querySelector(".ytsub-c-add").disabled, "can still save without a dictionary");
  c2.querySelector(".ytsub-c-close").click();
  w.close(); console.log("content: word spans, pause, card, example, save to new folder, duplicate, Esc/resume OK");
}

async function testPopup() {
  const st = storageMock({}); let krBody = fx.XML_SCHOOL;
  const dom = await JSDOM.fromFile(ext + "popup.html", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) { w.chrome = { runtime: { getURL: (p) => "chrome-extension://x/" + p, sendMessage: (m, cb) => setTimeout(() => cb({ ok: true, text: krBody }), 5) }, storage: { local: st.api },
      tabs: { query: async () => [{ id: 1, url: "https://example.com/" }], create: (o) => (w.__created = o), sendMessage() {} } }; } });
  const w = dom.window; await new Promise((r) => w.addEventListener("load", r)); await wait(80);
  const b = w.document.getElementById("reviewBtn");
  assert(/Review flashcards \(0 due · 0 saved\)/.test(b.textContent), b.textContent);
  const $ = (id) => w.document.getElementById(id);
  assert($("dictSet").open, "key box opens by itself when no key is saved");
  $("krSave").click(); assert(/Paste your key first/.test($("krStatus").textContent));
  $("krKey").value = "  KEY1 "; $("krSave").click(); await wait(80);
  assert.equal(st.mem.krdictKey, "KEY1", "key stored trimmed"); assert.equal($("krKey").value, "", "key field cleared after saving");
  assert(/Key works ✓ — 학교 \(명사, 초급\)/.test($("krStatus").textContent), $("krStatus").textContent);
  krBody = fx.XML_ERR; $("krKey").value = "BAD"; $("krSave").click(); await wait(80);
  assert(/refused the key: Unregistered key/.test($("krStatus").textContent) && $("krStatus").classList.contains("error"), $("krStatus").textContent);
  $("krRemove").click(); await wait(30);
  assert(!("krdictKey" in st.mem) && /Key removed/.test($("krStatus").textContent), "key removed");
  b.click(); assert.equal(w.__created.url, "chrome-extension://x/review.html");

  w.close(); console.log("popup: review button works even on a non-YouTube tab OK");
}

(async () => { await testReview(); await testContent(); await testPopup(); console.log("UI TESTS PASSED"); process.exit(0); })()
  .catch((e) => { console.error("FAIL:", e.stack || e); process.exit(1); });
