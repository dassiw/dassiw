// Flashcard storage + spaced-repetition scheduling.
// Shared by the YouTube content script, the popup and the review page.
// Everything lives in chrome.storage.local under one key.
(() => {
  if (globalThis.YTCards) return;

  const KEY = "ytcards";
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

  // Review timings (see README):
  //   Repeat -> under 1 minute, Hard -> 3 min, Normal -> 10 min,
  //   Good   -> depends on how many times Good has been pressed for the word.
  const REPEAT_MS = 45 * SEC;
  const HARD_MS = 3 * MIN;
  const NORMAL_MS = 10 * MIN;

  function goodInterval(goodCount) {
    if (goodCount > 10) return 30 * DAY; // more than 10 -> a month
    if (goodCount >= 5) return 7 * DAY;  // 5-10 -> a week
    return DAY;                          // 1-4 -> a day
  }

  function intervalFor(card, rating) {
    switch (rating) {
      case "repeat": return REPEAT_MS;
      case "hard": return HARD_MS;
      case "normal": return NORMAL_MS;
      case "good": return goodInterval((card.goodCount || 0) + 1);
      default: throw new Error("Unknown rating: " + rating);
    }
  }

  function schedule(card, rating, now = Date.now()) {
    const ms = intervalFor(card, rating);
    return {
      ...card,
      goodCount: rating === "good" ? (card.goodCount || 0) + 1 : card.goodCount || 0,
      due: now + ms,
      lastRating: rating,
      lastReviewed: now,
      reviews: (card.reviews || 0) + 1,
    };
  }

  function formatInterval(ms) {
    if (ms < MIN) return "<1 min";
    if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
    if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
    const days = Math.round(ms / DAY);
    if (days >= 30) return "1 month";
    if (days === 7) return "1 week";
    return days === 1 ? "1 day" : `${days} days`;
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / SEC));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
    if (s < 2 * 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.round(s / 86400)} days`;
  }

  /* ----------------------------- storage ----------------------------- */
  const DEFAULT_FOLDER = { id: "default", name: "Default" };

  function readRaw() {
    return new Promise((resolve) => {
      chrome.storage.local.get(KEY, (r) => resolve((r && r[KEY]) || null));
    });
  }
  function writeRaw(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [KEY]: data }, () => {
        if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  async function load() {
    const raw = (await readRaw()) || {};
    const folders = Array.isArray(raw.folders) && raw.folders.length ? raw.folders : [{ ...DEFAULT_FOLDER }];
    if (!folders.some((f) => f.id === DEFAULT_FOLDER.id)) folders.unshift({ ...DEFAULT_FOLDER });
    return {
      folders,
      cards: Array.isArray(raw.cards) ? raw.cards : [],
      settings: raw.settings || {},
    };
  }

  // Serialise read-modify-write cycles inside one page so they cannot overlap.
  let chain = Promise.resolve();
  function mutate(fn) {
    const run = chain.then(async () => {
      const data = await load();
      const result = await fn(data);
      await writeRaw(data);
      return result;
    });
    chain = run.catch(() => {});
    return run;
  }

  const uid = () =>
    globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  function addFolder(name) {
    name = String(name || "").trim().slice(0, 40);
    if (!name) return Promise.reject(new Error("Folder name is empty."));
    return mutate((data) => {
      const existing = data.folders.find((f) => sameName(f.name, name));
      if (existing) return existing;
      const folder = { id: uid(), name };
      data.folders.push(folder);
      return folder;
    });
  }

  function renameFolder(id, name) {
    name = String(name || "").trim().slice(0, 40);
    if (!name) return Promise.reject(new Error("Folder name is empty."));
    return mutate((data) => {
      const folder = data.folders.find((f) => f.id === id);
      if (!folder) throw new Error("Folder not found.");
      if (data.folders.some((f) => f.id !== id && sameName(f.name, name))) throw new Error("A folder with that name already exists.");
      folder.name = name;
      return folder;
    });
  }

  // Deleting a folder never deletes cards: they move to the Default folder.
  function deleteFolder(id) {
    if (id === DEFAULT_FOLDER.id) return Promise.reject(new Error("The Default folder cannot be deleted."));
    return mutate((data) => {
      data.folders = data.folders.filter((f) => f.id !== id);
      data.cards.forEach((c) => { if (c.folderId === id) c.folderId = DEFAULT_FOLDER.id; });
      if (data.settings.lastFolderId === id) data.settings.lastFolderId = DEFAULT_FOLDER.id;
    });
  }

  function findCard(cards, front, folderId) {
    const f = String(front).trim().toLowerCase();
    return cards.find((c) => c.folderId === folderId && c.front.trim().toLowerCase() === f) || null;
  }

  // Returns { card, duplicate }. A word already in the same folder is not added twice.
  function addCard(fields) {
    return mutate((data) => {
      const folderId = data.folders.some((f) => f.id === fields.folderId) ? fields.folderId : DEFAULT_FOLDER.id;
      const dup = findCard(data.cards, fields.front, folderId);
      if (dup) return { card: dup, duplicate: true };
      const now = Date.now();
      const card = {
        id: uid(),
        front: String(fields.front).trim(),
        back: fields.back || "",
        romanization: fields.romanization || "",
        extra: fields.extra || "",
        example: fields.example || "",
        exampleTr: fields.exampleTr || "",
        lang: fields.lang || "",
        videoId: fields.videoId || "",
        videoTime: Math.floor(fields.videoTime || 0),
        folderId,
        created: now,
        due: now, // new cards are due immediately
        goodCount: 0,
        reviews: 0,
      };
      data.cards.push(card);
      data.settings.lastFolderId = folderId;
      return { card, duplicate: false };
    });
  }

  function updateCard(id, patch) {
    return mutate((data) => {
      const i = data.cards.findIndex((c) => c.id === id);
      if (i < 0) throw new Error("Card not found.");
      data.cards[i] = { ...data.cards[i], ...patch, id };
      return data.cards[i];
    });
  }

  function deleteCard(id) {
    return mutate((data) => {
      data.cards = data.cards.filter((c) => c.id !== id);
    });
  }

  function setLastFolder(folderId) {
    return mutate((data) => {
      data.settings.lastFolderId = folderId;
    });
  }

  // Cards that are due now, most overdue first. folderId null/"all" = every folder.
  function dueCards(cards, folderId, now = Date.now()) {
    return cards
      .filter((c) => (!folderId || folderId === "all" || c.folderId === folderId) && c.due <= now)
      .sort((a, b) => a.due - b.due);
  }

  const api = {
    REPEAT_MS, HARD_MS, NORMAL_MS, DEFAULT_FOLDER,
    goodInterval, intervalFor, schedule, formatInterval, formatCountdown,
    load, addFolder, renameFolder, deleteFolder,
    findCard, addCard, updateCard, deleteCard, setLastFolder, dueCards,
  };
  globalThis.YTCards = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
