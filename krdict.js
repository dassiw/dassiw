// Korean Learners' Dictionary (한국어기초사전, National Institute of Korean Language)
// lookup used by the word card and the popup. The network request itself is made by
// background.js (it holds your API key); this file builds the queries, parses the
// XML answer and formats the "meaning section" (품사, 어휘등급, numbered 뜻풀이).
(() => {
  if (globalThis.YTKrdict) return;

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, error: "No response from the extension." });
        });
      } catch (_) {
        resolve({ ok: false, error: "Extension was updated. Reload this page." });
      }
    });

  // Verbs that contract when conjugated: 했어요 -> 하다, 돼요 -> 되다, 와요 -> 오다 ...
  const CONTRACT = { 해: "하", 했: "하", 돼: "되", 됐: "되", 와: "오", 왔: "오", 봐: "보", 봤: "보", 줘: "주", 줬: "주" };
  const contracted = (s) => (s && CONTRACT[s.slice(-1)] ? s.slice(0, -1) + CONTRACT[s.slice(-1)] + "다" : "");

  // Subtitles contain inflected words ("학교에서", "가요"), but the dictionary only knows
  // basic forms ("학교", "가다"). Try the word, then shorter stems, with and without "다".
  // Fully irregular verbs (예뻐요 -> 예쁘다) are not recognised.
  function candidates(word) {
    const w = String(word || "").trim();
    if (!w) return [];
    const out = [];
    const add = (s) => { if (s && !out.includes(s)) out.push(s); };
    add(w);
    add(contracted(w));
    for (let k = 1; k <= 3 && w.length - k >= 1; k++) {
      const stem = w.slice(0, -k);
      add(contracted(stem));
      if (stem.length <= 1) { add(stem + "다"); add(stem); } // 가 -> 가다 is far likelier than 가
      else { add(stem); add(stem + "다"); }
    }
    return out.slice(0, 6);
  }

  const txt = (node, tag) => {
    const n = node && node.getElementsByTagName(tag)[0];
    return n ? (n.textContent || "").trim() : "";
  };

  // XML from /api/search -> { error } or { entries: [...] }
  function parse(text) {
    const body = String(text || "").trim();
    if (!body) return { error: "empty answer from the dictionary" };
    let doc;
    try {
      doc = new DOMParser().parseFromString(body, "text/xml");
    } catch (_) {
      return { error: "unreadable answer from the dictionary" };
    }
    if (doc.getElementsByTagName("parsererror").length) return { error: "unreadable answer from the dictionary" };
    const err = doc.getElementsByTagName("error")[0];
    if (err) {
      const code = txt(err, "error_code");
      const message = txt(err, "message");
      return { error: `${message || "request refused"}${code ? ` (code ${code})` : ""}`, code };
    }
    const entries = Array.from(doc.getElementsByTagName("item")).map((item) => {
      const link = txt(item, "link");
      return {
        targetCode: txt(item, "target_code"),
        word: txt(item, "word"),
        supNo: Number(txt(item, "sup_no")) || 0,
        pronunciation: txt(item, "pronunciation"),
        pos: txt(item, "pos"),
        grade: txt(item, "word_grade"),
        link: /^https:\/\/krdict\.korean\.go\.kr\//.test(link) ? link : "",
        senses: Array.from(item.getElementsByTagName("sense")).map((s, i) => ({
          order: Number(txt(s, "sense_order")) || i + 1,
          definition: txt(s, "definition"),
          transWord: txt(s, "trans_word"),
          transDfn: txt(s, "trans_dfn"),
        })).filter((s) => s.definition),
      };
    }).filter((e) => e.word && e.senses.length);
    return { entries };
  }

  async function lookup(word) {
    for (const q of candidates(word)) {
      const res = await send({ action: "krdict", q });
      if (!res.ok) return { ok: false, error: res.error, noKey: !!res.noKey };
      const parsed = parse(res.text);
      if (parsed.error) return { ok: false, error: parsed.error };
      if (parsed.entries.length) return { ok: true, matched: q, entries: parsed.entries };
    }
    return { ok: true, matched: null, entries: [] };
  }

  const gradeOf = (e) => (e.grade && e.grade !== "없음" ? e.grade : "");

  // Plain-text version stored on a flashcard.
  function toText(entries, maxEntries = 3, maxSenses = 4) {
    return entries.slice(0, maxEntries).map((e) => {
      const g = gradeOf(e);
      const head = [e.word, e.pos, g ? `어휘등급 ${g}` : ""].filter(Boolean).join(" · ");
      const lines = e.senses.slice(0, maxSenses).map((s) => `${s.order}. ${s.definition}${s.transWord ? ` — ${s.transWord}` : ""}`);
      return [head, ...lines].join("\n");
    }).join("\n\n");
  }

  const api = { candidates, parse, lookup, gradeOf, toText };
  globalThis.YTKrdict = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
