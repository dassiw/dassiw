// New tab mini lesson. Shares flashcard storage (YTCards) with the YouTube extension.
// The lesson deck mixes the built-in words with Korean words saved from YouTube videos
// (those keep the video sentence, a screenshot of the moment, and a link back to the video).

// ---------- Clock ----------
function tick() {
  const now = new Date();
  document.getElementById("time").textContent = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit"
  });
  document.getElementById("date").textContent = now.toLocaleDateString("en-US", {
    month: "short", day: "2-digit", year: "numeric"
  });
}
tick();
setInterval(tick, 1000);

// ---------- Element handles ----------
const $ = (id) => document.getElementById(id);
const folderSelect = $("folderSelect");
const saveBtn = $("saveBtn");
const saveStatus = $("saveStatus");
const saveRow = $("saveRow");

// ---------- Build the lesson deck ----------
// Built-in words and video words alternate, so both show up regularly.
function videoWordsFrom(cards) {
  return cards
    .filter((c) => c.videoId && c.lang === "ko")
    .sort((a, b) => b.created - a.created)
    .map((c) => ({
      hangul: c.front,
      romanization: c.romanization || "",
      pos: "from video",
      meaning: c.back || "(saved from a video)",
      sentence_ko: c.example || "",
      sentence_en: c.exampleTr || "",
      tip: c.extra ? "Other meanings: " + c.extra : "You saved this word while watching a video.",
      keywords: "",
      isVideo: true,
      screenshot: c.screenshot || "",
      videoId: c.videoId,
      videoTime: c.videoTime || 0
    }));
}

function interleave(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

const PROGRESS_KEY = "hangulNewTab.nextIndex";
let deck = WORDS.slice();
let word = null;

// ---------- Rendering one lesson word ----------
function renderWord(index) {
  word = deck[index];
  $("progress").textContent = `word ${index + 1} of ${deck.length}`;
  $("hangul").textContent = word.hangul;
  $("romanization").textContent = word.romanization ? `[${word.romanization}]` : "";
  $("pos").textContent = word.pos;
  $("meaning").textContent = word.meaning;
  $("sentenceKo").textContent = word.sentence_ko;
  $("sentenceEn").textContent = word.sentence_en;
  $("tip").textContent = word.tip;

  // Video words already live in your flashcards, so hide the save row for them.
  saveRow.hidden = !!word.isVideo;
  saveStatus.textContent = "";

  const shot = $("videoShot");
  if (word.isVideo) {
    shot.hidden = false;
    const img = $("shotImg");
    img.hidden = !word.screenshot;
    img.src = word.screenshot || "";
    const link = $("shotLink");
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(word.videoId)}&t=${Math.floor(word.videoTime)}s`;
  } else {
    shot.hidden = true;
  }
  loadBackground();
}

// ---------- Lesson progression: one new word per new tab ----------
function currentIndex() {
  return parseInt(localStorage.getItem(PROGRESS_KEY) || "0", 10) % deck.length;
}

// ---------- Native Korean pronunciation (browser text-to-speech) ----------
let koVoice = null;

function pickKoreanVoice() {
  const voices = window.speechSynthesis.getVoices();
  koVoice = voices.find(v => v.lang === "ko-KR") ||
            voices.find(v => v.lang.startsWith("ko")) || null;
}
pickKoreanVoice();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = pickKoreanVoice;
}

function speak(text, button) {
  if (!text) return;
  if (!("speechSynthesis" in window)) {
    alert("Your browser does not support speech output.");
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 0.85; // slightly slower for learners
  if (koVoice) utter.voice = koVoice;

  if (button) {
    button.classList.add("playing");
    utter.onend = utter.onerror = () => button.classList.remove("playing");
  }
  window.speechSynthesis.speak(utter);
}

$("speakWord").addEventListener("click", e => speak(word.hangul, e.currentTarget));
$("speakSentence").addEventListener("click", e => speak(word.sentence_ko, e.currentTarget));

// ---------- Flashcards: save a built-in word to a folder ----------
async function initFolders() {
  const data = await YTCards.load();
  data.folders.forEach(f => folderSelect.add(new Option(f.name, f.id)));
  const last = data.settings.lastFolderId;
  folderSelect.value = data.folders.some(f => f.id === last) ? last : YTCards.DEFAULT_FOLDER.id;
}

async function saveWord() {
  if (!word || word.isVideo) return;
  saveBtn.disabled = true;
  try {
    const { duplicate } = await YTCards.addCard({
      front: word.hangul,
      back: word.meaning,
      romanization: word.romanization,
      extra: word.tip,
      example: word.sentence_ko,
      exampleTr: word.sentence_en,
      lang: "ko",
      folderId: folderSelect.value
    });
    saveStatus.textContent = duplicate ? "Already in that folder." : "Saved to flashcards.";
  } catch (err) {
    saveStatus.textContent = "Could not save: " + (err.message || err);
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", saveWord);

// Keyboard shortcuts: 1 = word, 2 = sentence, 3 = add to flashcards
document.addEventListener("keydown", e => {
  if (e.target.tagName === "SELECT") return;
  if (!word) return;
  if (e.key === "1") speak(word.hangul, $("speakWord"));
  if (e.key === "2") speak(word.sentence_ko, $("speakSentence"));
  if (e.key === "3") saveWord();
});

// ---------- Random related background photo ----------
function loadBackground() {
  const bg = $("bg");
  const keywords = word.keywords || "korea,language,city";
  const url = `https://loremflickr.com/1920/1080/${keywords}?random=${Math.floor(Math.random() * 1e6)}`;
  const img = new Image();
  img.onload = () => { bg.style.backgroundImage = `url("${url}")`; };
  img.onerror = () => { bg.style.backgroundImage = ""; }; // keep gradient fallback
  img.src = url;
}

// ---------- Start ----------
async function init() {
  let videoWords = [];
  try {
    const data = await YTCards.load();
    videoWords = videoWordsFrom(data.cards);
  } catch (_err) {
    videoWords = [];
  }
  deck = interleave(WORDS, videoWords);
  const index = currentIndex();
  localStorage.setItem(PROGRESS_KEY, String(index + 1));
  renderWord(index);
}

init();
initFolders();
