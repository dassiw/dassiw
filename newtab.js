// New tab mini lesson. Shares flashcard storage (YTCards) with the YouTube extension,
// so words saved here appear in the Review page with the same 1-4 buttons.

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

// ---------- Lesson progression: one new word per new tab ----------
const PROGRESS_KEY = "hangulNewTab.nextIndex";
const index = parseInt(localStorage.getItem(PROGRESS_KEY) || "0", 10) % WORDS.length;
localStorage.setItem(PROGRESS_KEY, String(index + 1));
const word = WORDS[index];

document.getElementById("progress").textContent = `word ${index + 1} of ${WORDS.length}`;
document.getElementById("hangul").textContent = word.hangul;
document.getElementById("romanization").textContent = `[${word.romanization}]`;
document.getElementById("pos").textContent = word.pos;
document.getElementById("meaning").textContent = word.meaning;
document.getElementById("sentenceKo").textContent = word.sentence_ko;
document.getElementById("sentenceEn").textContent = word.sentence_en;
document.getElementById("tip").textContent = word.tip;

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

document.getElementById("speakWord").addEventListener("click", e =>
  speak(word.hangul, e.currentTarget));
document.getElementById("speakSentence").addEventListener("click", e =>
  speak(word.sentence_ko, e.currentTarget));

// ---------- Flashcards: save this word to a folder ----------
const folderSelect = document.getElementById("folderSelect");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");

async function initFolders() {
  const data = await YTCards.load();
  data.folders.forEach(f => folderSelect.add(new Option(f.name, f.id)));
  const last = data.settings.lastFolderId;
  folderSelect.value = data.folders.some(f => f.id === last) ? last : YTCards.DEFAULT_FOLDER.id;
}

async function saveWord() {
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
    saveStatus.textContent = duplicate
      ? "Already in that folder."
      : "Saved to flashcards.";
  } catch (err) {
    saveStatus.textContent = "Could not save: " + (err.message || err);
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", saveWord);
initFolders();

// Keyboard shortcuts: 1 = word, 2 = sentence, 3 = add to flashcards
document.addEventListener("keydown", e => {
  if (e.target.tagName === "SELECT") return;
  if (e.key === "1") speak(word.hangul, document.getElementById("speakWord"));
  if (e.key === "2") speak(word.sentence_ko, document.getElementById("speakSentence"));
  if (e.key === "3") saveWord();
});

// ---------- Random related background photo ----------
function loadBackground() {
  const bg = document.getElementById("bg");
  const url = `https://loremflickr.com/1920/1080/${word.keywords}?random=${Math.floor(Math.random() * 1e6)}`;
  const img = new Image();
  img.onload = () => { bg.style.backgroundImage = `url("${url}")`; };
  img.onerror = () => { bg.style.backgroundImage = ""; }; // keep gradient fallback
  img.src = url;
}
loadBackground();
