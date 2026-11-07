// Service worker: looks words up so the content script does not run into
// YouTube's cross-origin limits. Uses Google Translate's public web endpoint
// (no API key). It is unofficial, so every field is parsed defensively.

const cache = new Map();

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

// Exported shape of the response so it can be unit-tested.
function parseTranslateResponse(data) {
  const parts = Array.isArray(data && data[0]) ? data[0] : [];
  const translation = parts.map((p) => (p && typeof p[0] === "string" ? p[0] : "")).join("").trim();

  let romanization = "";
  for (const p of parts) {
    if (p && typeof p[3] === "string" && p[3]) romanization = p[3]; // transliteration of the source text
  }

  const defs = [];
  if (Array.isArray(data[1])) {
    for (const entry of data[1].slice(0, 3)) {
      const terms = Array.isArray(entry[1]) ? entry[1].filter((t) => typeof t === "string").slice(0, 4) : [];
      if (terms.length) defs.push({ pos: typeof entry[0] === "string" ? entry[0] : "", terms });
    }
  }

  const examples = [];
  const exBlock = data[13] && data[13][0];
  if (Array.isArray(exBlock)) {
    for (const e of exBlock.slice(0, 2)) {
      const text = stripTags(e && e[0]);
      if (text) examples.push(text);
    }
  }

  return { translation, romanization, defs, examples, detected: typeof data[2] === "string" ? data[2] : "" };
}

async function translate(text, sl, tl) {
  const key = `${sl}|${tl}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx" +
    `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
    "&dt=t&dt=bd&dt=ex&dt=rm&q=" + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation service returned HTTP ${res.status}.`);
  const parsed = parseTranslateResponse(await res.json());
  if (!parsed.translation) throw new Error("No translation found.");
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(key, parsed);
  return parsed;
}

/* ---- whole subtitle lines (used when a video lacks one of the two languages) ---- */
const batchCache = new Map();

async function gtxText(text, sl, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx" +
    `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=` + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation service returned HTTP ${res.status}`);
  const data = await res.json();
  const parts = Array.isArray(data && data[0]) ? data[0] : [];
  return parts.map((p) => (p && typeof p[0] === "string" ? p[0] : "")).join("");
}

// Translates many short lines with one request (newline separated) and splits the
// answer back. If the service merges or splits lines, falls back to one request per line.
async function translateLines(texts, sl, tl) {
  const clean = texts.map((t) => String(t).replace(/\s*\n\s*/g, " ").trim());
  const key = `${sl}|${tl}|${clean.join("\n")}`;
  if (batchCache.has(key)) return batchCache.get(key);
  const out = (await gtxText(clean.join("\n"), sl, tl)).split("\n").map((s) => s.trim());
  let lines = out;
  if (out.length !== clean.length) {
    lines = [];
    for (const t of clean) lines.push(t ? (await gtxText(t, sl, tl)).trim() : "");
  }
  if (batchCache.size > 300) batchCache.delete(batchCache.keys().next().value);
  batchCache.set(key, lines);
  return lines;
}

/* ---- 한국어기초사전 (Korean Learners' Dictionary) official API ---- */
const krCache = new Map();

// Returns the raw XML. The key is read from storage here, so pages never see it.
async function krdictFetch(q, fresh) {
  const stored = await chrome.storage.local.get("krdictKey");
  const key = String((stored && stored.krdictKey) || "").trim();
  if (!key) {
    const e = new Error("No dictionary key set");
    e.noKey = true;
    throw e;
  }
  const word = String(q || "").slice(0, 40);
  if (!fresh && krCache.has(word)) return krCache.get(word);
  const params = new URLSearchParams({
    key, q: word, part: "word", translated: "y", trans_lang: "1", // 1 = English
    advanced: "y", method: "exact", num: "10",
  });
  const res = await fetch("https://krdict.korean.go.kr/api/search?" + params.toString());
  if (!res.ok) throw new Error(`Dictionary returned HTTP ${res.status}`);
  const text = await res.text();
  if (!/<error>/.test(text)) {
    if (krCache.size > 300) krCache.delete(krCache.keys().next().value);
    krCache.set(word, text);
  }
  return text;
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (!req) return false;
    if (req.action === "translate") {
      translate(String(req.text || "").slice(0, 500), req.sl || "auto", req.tl || "en")
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message || "Translation failed." }));
      return true; // async response
    }
    if (req.action === "krdict") {
      krdictFetch(req.q, !!req.fresh)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((err) => sendResponse({ ok: false, error: err.message || "Dictionary lookup failed", noKey: !!err.noKey }));
      return true;
    }
    if (req.action === "translateBatch") {
      const texts = Array.isArray(req.texts) ? req.texts.slice(0, 60) : [];
      translateLines(texts, req.sl || "auto", req.tl || "en")
        .then((lines) => sendResponse({ ok: true, lines }))
        .catch((err) => sendResponse({ ok: false, error: err.message || "Translation failed." }));
      return true;
    }
    return false;
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseTranslateResponse, translateLines, krdictFetch };
