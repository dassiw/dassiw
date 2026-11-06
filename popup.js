const $ = (id) => document.getElementById(id);
const els = {
  title: $("videoTitle"), controls: $("controls"), status: $("status"),
  list: $("transcript"), track: $("trackSelect"), translate: $("translateSelect"),
  search: $("search"), times: $("showTimes"),
};

let tabId = null;
let tracks = [];
let cues = [];
let videoTitle = "video";
let pollTimer = null;

const send = (payload) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "Can't reach the page. Reload the YouTube tab and try again." });
      } else {
        resolve(res || { ok: false, error: "No response from page." });
      }
    });
  });

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("error", isError);
  els.status.hidden = !msg;
}

/* ---------------------------- Dual subtitles ---------------------------- */
const LANGS = [
  ["ko", "Korean (한국어)"], ["en", "English"], ["ja", "Japanese"], ["zh-Hans", "Chinese"],
  ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"],
  ["ru", "Russian"], ["hi", "Hindi"],
];
const dual = {
  box: $("dual"), enabled: $("dualEnabled"), top: $("dualTop"),
  bottom: $("dualBottom"), size: $("dualSize"), status: $("dualStatus"),
};

function fillLangs(select, allowNone) {
  select.innerHTML = "";
  if (allowNone) select.add(new Option("None (single line)", ""));
  LANGS.forEach(([code, name]) => select.add(new Option(name, code)));
}
const readDual = () => ({
  enabled: dual.enabled.checked,
  top: dual.top.value,
  bottom: dual.bottom.value,
  size: Number(dual.size.value),
});
function showDualState(state) {
  dual.status.textContent = (state && state.message) || "";
  dual.status.className = "dual-status" + (state && state.status === "error" ? " error" : state && state.status === "loading" ? " loading" : state && state.status === "partial" ? " warn" : "");
}
async function pushDual() {
  showDualState({ status: "loading", message: "Applying…" });
  const res = await send({ action: "dualSet", settings: readDual() });
  showDualState(res.ok ? res.state : { status: "error", message: res.error });
}
async function initDual() {
  fillLangs(dual.top, false);
  fillLangs(dual.bottom, true);
  const res = await send({ action: "dualGet" });
  if (res.ok) {
    dual.enabled.checked = !!res.settings.enabled;
    dual.top.value = res.settings.top;
    dual.bottom.value = res.settings.bottom;
    dual.size.value = String(res.settings.size);
    showDualState(res.state);
  }
  dual.box.hidden = false;
  [dual.enabled, dual.top, dual.bottom, dual.size].forEach((el) => el.addEventListener("change", pushDual));
}

/* ------------------------------ Transcript ------------------------------ */
const pad = (n, w = 2) => String(n).padStart(w, "0");
function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtSrt(sec) {
  const ms = Math.round((sec % 1) * 1000);
  const t = Math.floor(sec);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)},${pad(ms, 3)}`;
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render() {
  const q = els.search.value.trim().toLowerCase();
  els.list.className = els.times.checked ? "" : "no-times";
  els.list.innerHTML = "";
  const frag = document.createDocumentFragment();
  cues.forEach((c, i) => {
    if (q && !c.text.toLowerCase().includes(q)) return;
    const li = document.createElement("li");
    li.dataset.index = i;
    li.dataset.start = c.start;
    let text = escapeHtml(c.text);
    if (q) text = text.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
    li.innerHTML = `<span class="ts">${fmtClock(c.start)}</span><span class="tx">${text}</span>`;
    li.addEventListener("click", () => send({ action: "seek", seconds: c.start }));
    frag.appendChild(li);
  });
  els.list.appendChild(frag);
  if (!els.list.children.length) setStatus(q ? "No matches." : "No subtitle lines found.");
  else setStatus("");
}

async function loadTranscript() {
  const track = tracks[els.track.value];
  if (!track) return;
  setStatus("Loading subtitles…");
  els.list.innerHTML = "";
  const res = await send({ action: "getTranscript", baseUrl: track.baseUrl, translateTo: els.translate.value || null });
  if (!res.ok) { setStatus(res.error, true); return; }
  cues = res.cues;
  render();
}

function plainText(withTimes) {
  return cues.map((c) => (withTimes ? `[${fmtClock(c.start)}] ` : "") + c.text).join("\n");
}
function srtText() {
  return cues.map((c, i) => {
    const end = c.start + (c.dur || 2);
    return `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(end)}\n${c.text}\n`;
  }).join("\n");
}
function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = () => videoTitle.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "subtitles";

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const res = await send({ action: "getTime" });
    if (!res.ok || !cues.length) return;
    let active = -1;
    for (let i = 0; i < cues.length; i++) { if (cues[i].start <= res.time) active = i; else break; }
    const prev = els.list.querySelector("li.active");
    const next = els.list.querySelector(`li[data-index="${active}"]`);
    if (prev === next) return;
    if (prev) prev.classList.remove("active");
    if (next) { next.classList.add("active"); next.scrollIntoView({ block: "nearest" }); }
  }, 500);
}

/* ------------------------------ Flashcards ------------------------------ */
async function initReview() {
  const btn = $("reviewBtn");
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
    window.close();
  });
  try {
    const data = await YTCards.load();
    const due = YTCards.dueCards(data.cards, "all").length;
    btn.textContent = `Review flashcards (${due} due · ${data.cards.length} saved)`;
  } catch (_) {}
}

async function init() {
  initReview(); // works on any page, not only on YouTube
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.youtube\.com\/watch/.test(tab.url || "")) {
    setStatus("Open a YouTube video (youtube.com/watch…) and click the extension again.", true);
    return;
  }
  tabId = tab.id;

  // If the tab was open before install, inject the content script on demand.
  let ping = await send({ action: "ping" });
  if (!ping.ok) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["cards.js", "content.js"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"], world: "MAIN" });
      ping = await send({ action: "ping" });
    } catch (_) {}
  }
  if (!ping.ok) { setStatus(ping.error || "Reload the YouTube tab and try again.", true); return; }

  await initDual();

  const info = await send({ action: "getTracks" });
  if (!info.ok) { setStatus(info.error, true); return; }
  videoTitle = info.title || "video";
  els.title.textContent = videoTitle;
  tracks = info.tracks;
  if (!tracks.length) { setStatus("This video has no subtitles available.", true); return; }

  tracks.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = t.name + (t.auto && !/auto/i.test(t.name) ? " (auto-generated)" : "");
    els.track.appendChild(opt);
  });
  els.controls.hidden = false;
  await loadTranscript();
  startPolling();
}

els.track.addEventListener("change", loadTranscript);
els.translate.addEventListener("change", loadTranscript);
els.search.addEventListener("input", render);
els.times.addEventListener("change", render);
$("copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(plainText(els.times.checked));
  const b = $("copyBtn"); b.textContent = "Copied!"; setTimeout(() => (b.textContent = "Copy"), 1200);
});
$("txtBtn").addEventListener("click", () => download(`${safeName()}.txt`, plainText(els.times.checked), "text/plain"));
$("srtBtn").addEventListener("click", () => download(`${safeName()}.srt`, srtText(), "application/x-subrip"));

init();
