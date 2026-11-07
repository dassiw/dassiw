const { JSDOM } = require("jsdom");
global.DOMParser = new JSDOM("").window.DOMParser;
const assert = require("assert"), fx = require("./fixtures.js");
const ext = require("path").join(__dirname, "..") + "/";

(async () => {
  // ---- parse
  global.chrome = { runtime: {} };
  const K = require(ext + "krdict.js");
  let p = K.parse(fx.XML_SCHOOL);
  assert.equal(p.entries.length, 2);
  const e = p.entries[0];
  assert.deepEqual([e.word, e.pos, e.grade, e.pronunciation, e.supNo], ["학교", "명사", "초급", "학꾜", 0]);
  assert.equal(e.senses.length, 2); assert.equal(e.senses[0].transWord, "school"); assert.equal(e.senses[1].order, 2);
  assert(e.link.startsWith("https://krdict.korean.go.kr/"), "official link kept");
  assert.equal(p.entries[1].link, "", "links to other sites are dropped");
  assert.equal(K.gradeOf(p.entries[1]), "", "'없음' grade is not shown");
  assert.deepEqual(K.parse(fx.XML_EMPTY), { entries: [] });
  assert(/Unregistered key \(code 020\)/.test(K.parse(fx.XML_ERR).error));
  assert(K.parse("").error && K.parse("<a><b></a>").error, "empty / broken answers give an error, not a crash");
  const t = K.toText(p.entries);
  assert(t.startsWith("학교 · 명사 · 어휘등급 초급\n1. 교사가 학생을 가르치는 기관. — school\n2. 수업을 하는 일. — school; class"), t);
  assert(!/어휘등급 없음/.test(t));
  console.log("parse / text OK");

  // ---- word forms -> basic forms
  const has = (w, c) => assert(K.candidates(w).includes(c), `${w} -> ${c} in ${K.candidates(w)}`);
  has("학교에서", "학교"); has("사람들이", "사람"); has("가요", "가다"); has("먹었어요", "먹다"); has("했어요", "하다"); has("해요", "하다"); has("돼요", "되다"); has("됐어요", "되다"); has("와요", "오다"); has("봤어요", "보다"); has("줬어", "주다"); has("해", "하다");
  assert.equal(K.candidates("가요")[1], "가다", "1-syllable stems try +다 first");
  assert.equal(K.candidates("사람")[0], "사람", "the exact word is always tried first");
  assert(K.candidates("먹었어요").length <= 6 && K.candidates("").length === 0);
  console.log("candidates OK:", K.candidates("학교에서").join(" > "));

  // ---- lookup: stops at the first candidate the dictionary knows
  const asked = [];
  global.chrome.runtime.sendMessage = (m, cb) => { asked.push(m.q); cb({ ok: true, text: m.q === "학교" ? fx.XML_SCHOOL : fx.XML_EMPTY }); };
  let r = await K.lookup("학교에서");
  assert(r.ok && r.matched === "학교" && r.entries[0].word === "학교", JSON.stringify(r).slice(0, 80));
  assert.deepEqual(asked, ["학교에서", "학교에", "학교에다", "학교"], "stopped at the match: " + asked);
  r = await K.lookup("쀍쀍"); assert(r.ok && r.matched === null && r.entries.length === 0, "unknown word -> empty, not an error");
  global.chrome.runtime.sendMessage = (m, cb) => cb({ ok: false, error: "No dictionary key set", noKey: true });
  r = await K.lookup("사람"); assert(!r.ok && r.noKey, "missing key reported");
  global.chrome.runtime.sendMessage = (m, cb) => cb({ ok: true, text: fx.XML_ERR });
  r = await K.lookup("사람"); assert(!r.ok && /Unregistered key/.test(r.error), "API error surfaced");
  console.log("lookup OK");

  // ---- background: request building, key handling, cache
  const mem = {};
  global.chrome = { storage: { local: { get: async (k) => ({ [k]: mem[k] }) } }, runtime: {} };
  const urls = []; let body = fx.XML_SCHOOL, status = 200;
  global.fetch = async (u) => { urls.push(u); return { ok: status === 200, status, text: async () => body }; };
  const B = require(ext + "background.js");
  await assert.rejects(() => B.krdictFetch("사람"), (err) => err.noKey === true, "no key -> noKey error, no request");
  assert.equal(urls.length, 0);
  mem.krdictKey = "  ABC123  ";
  assert.equal(await B.krdictFetch("학교에"), fx.XML_SCHOOL);
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, "https://krdict.korean.go.kr/api/search");
  assert.deepEqual([u.searchParams.get("key"), u.searchParams.get("q"), u.searchParams.get("translated"), u.searchParams.get("trans_lang"), u.searchParams.get("advanced"), u.searchParams.get("method"), u.searchParams.get("part")],
    ["ABC123", "학교에", "y", "1", "y", "exact", "word"]);
  await B.krdictFetch("학교에"); assert.equal(urls.length, 1, "second lookup served from cache");
  await B.krdictFetch("학교에", true); assert.equal(urls.length, 2, "fresh=true skips the cache");
  body = fx.XML_ERR; await B.krdictFetch("틀림"); await B.krdictFetch("틀림");
  assert.equal(urls.length, 4, "error answers are not cached");
  status = 503; await assert.rejects(() => B.krdictFetch("다른"), /HTTP 503/);
  console.log("background OK:", urls[0]);
  console.log("KRDICT TESTS PASSED");
})().catch((e) => { console.error("FAIL:", e.stack || e); process.exit(1); });
