const ext = require("path").join(__dirname, "..") + "/";
// in-memory chrome.storage mock
const mem = {};
global.chrome = { runtime: {}, storage: { local: {
  get: (k, cb) => cb({ [k]: mem[k] }), set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); cb && cb(); } } } };
const C = require(ext + "cards.js");
const { parseTranslateResponse } = require(ext + "background.js");
const assert = require("assert");
const MIN = 60e3, DAY = 864e5;

(async () => {
  // spec timings
  let card = { goodCount: 0 };
  assert(C.intervalFor(card, "repeat") < MIN, "repeat < 1 min");
  assert.equal(C.intervalFor(card, "hard"), 3 * MIN);
  assert.equal(C.intervalFor(card, "normal"), 10 * MIN);
  // good ladder: press count -> interval
  const ladder = [];
  card = { goodCount: 0 };
  for (let i = 1; i <= 12; i++) { const n = C.schedule(card, "good", 0); ladder.push([i, n.due / DAY]); card = n; }
  const expect = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 7, 6: 7, 10: 7, 11: 30, 12: 30 };
  for (const [i, d] of ladder) if (expect[i] !== undefined) assert.equal(d, expect[i], `good press #${i}`);
  // other ratings do not reset the good counter
  let c2 = C.schedule({ goodCount: 3 }, "hard", 0);
  assert.equal(c2.goodCount, 3);
  // folders + cards
  const f = await C.addFolder("Food");
  const a = await C.addCard({ front: "학교", back: "school", folderId: f.id });
  assert(!a.duplicate && a.card.due <= Date.now());
  const b = await C.addCard({ front: "학교", back: "school", folderId: f.id });
  assert(b.duplicate, "duplicate in same folder blocked");
  const d = await C.addCard({ front: "학교", back: "school", folderId: "default" });
  assert(!d.duplicate, "same word allowed in another folder");
  await C.deleteFolder(f.id);
  const data = await C.load();
  assert(data.cards.every((x) => x.folderId === "default") && data.cards.length === 2, "cards moved to default");
  assert.equal(C.dueCards(data.cards, "all").length, 2);
  // translate response parsing (shape of Google gtx with dt=t,bd,rm)
  const sample = [[["school", "학교", null, null, 10], [null, null, "hakgyo", "hakgyo"]],
    [["noun", ["school", "schoolhouse"], [], "학교", 1]], "ko"];
  const p = parseTranslateResponse(sample);
  assert.equal(p.translation, "school"); assert.equal(p.romanization, "hakgyo");
  assert.deepEqual(p.defs[0].terms, ["school", "schoolhouse"]);
  // batch line translation (background.js)
  const { translateLines } = require(ext + "background.js");
  let calls = [];
  global.fetch = async (url) => {
    const q = new URL(url).searchParams.get("q"); calls.push(q);
    // like Google: one segment per line, newline kept at the end of each segment
    const segs = q.split("\n").map((l, i, a) => ["KO:" + l + (i < a.length - 1 ? "\n" : ""), l]);
    return { ok: true, status: 200, json: async () => [segs, null, "en"] };
  };
  let out = await translateLines(["Hello there", "I go to\nschool", "Bye"], "en", "ko");
  assert.deepEqual(out, ["KO:Hello there", "KO:I go to school", "KO:Bye"]);
  assert.equal(calls.length, 1, "one request for the whole batch");
  await translateLines(["Hello there", "I go to\nschool", "Bye"], "en", "ko");
  assert.equal(calls.length, 1, "repeat batch served from cache");
  // service merges two lines into one -> falls back to per-line requests, still correct
  calls = [];
  global.fetch = async (url) => {
    const q = new URL(url).searchParams.get("q"); calls.push(q);
    const t = q.includes("\n") ? "KO:" + q.replace(/\n/g, " ") : "KO:" + q; // merged
    return { ok: true, status: 200, json: async () => [[[t, q]], null, "en"] };
  };
  out = await translateLines(["a one", "b two"], "en", "ko");
  assert.deepEqual(out, ["KO:a one", "KO:b two"]); assert.equal(calls.length, 3, "1 batch + 2 single");
  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => translateLines(["x y"], "en", "ko"), /HTTP 429/);
  console.log("unit tests passed");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
