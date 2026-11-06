// Flashcard review page: study with buttons / keys 1-4, and manage folders + cards.
(() => {
  const $ = (id) => document.getElementById(id);
  const RATINGS = ["repeat", "hard", "normal", "good"]; // keys 1, 2, 3, 4

  let data = { folders: [], cards: [], settings: {} };
  let view = "study";
  let folder = "all";
  let current = null;
  let revealed = false;
  let waitTimer = null;

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => n.append(c));
    return n;
  }

  let toastTimer = null;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  const folderName = (id) => (data.folders.find((f) => f.id === id) || { name: "Default" }).name;
  const poolCards = () => (folder === "all" ? data.cards : data.cards.filter((c) => c.folderId === folder));
  const dueIn = (cards) => YTCards.dueCards(cards, "all", Date.now());

  async function reload() {
    data = await YTCards.load();
    if (folder !== "all" && !data.folders.some((f) => f.id === folder)) folder = "all";
  }

  function highlight(container, text, word) {
    container.textContent = "";
    const i = text.toLowerCase().indexOf(word.toLowerCase());
    if (i < 0 || !word) { container.textContent = text; return; }
    container.append(
      text.slice(0, i),
      h("mark", {}, text.slice(i, i + word.length)),
      text.slice(i + word.length)
    );
  }

  /* ------------------------------ filter ------------------------------ */
  function fillFilter() {
    const sel = $("folderFilter");
    sel.textContent = "";
    sel.add(new Option(`All folders (${dueIn(data.cards).length} due)`, "all"));
    data.folders.forEach((f) => {
      const n = dueIn(data.cards.filter((c) => c.folderId === f.id)).length;
      sel.add(new Option(`${f.name} (${n} due)`, f.id));
    });
    sel.value = folder;
  }

  /* ------------------------------- study ------------------------------ */
  function updateCounts() {
    const pool = poolCards();
    $("counts").textContent = `${dueIn(pool).length} due · ${pool.length} card${pool.length === 1 ? "" : "s"} in this selection`;
  }

  function showNext() {
    clearInterval(waitTimer);
    fillFilter();
    updateCounts();
    const due = dueIn(poolCards());
    if (due.length) {
      current = due[0];
      revealed = false;
      renderCard();
    } else {
      current = null;
      renderEmpty();
    }
  }

  function renderCard() {
    $("empty").hidden = true;
    $("card").hidden = false;
    $("front").textContent = current.front;
    $("rom").textContent = current.romanization || "";
    $("answer").hidden = true;
    $("rate").hidden = true;
    $("showBtn").hidden = false;
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    $("showBtn").hidden = true;
    $("back").textContent = current.back || "(no translation saved)";
    $("extra").textContent = current.extra || "";
    const hasEx = !!current.example;
    $("exBox").hidden = !hasEx;
    if (hasEx) {
      highlight($("exSrc"), current.example, current.front);
      $("exTr").textContent = current.exampleTr || "";
    }
    const link = $("source");
    link.hidden = !current.videoId;
    if (current.videoId) {
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(current.videoId)}&t=${current.videoTime || 0}s`;
    }
    RATINGS.forEach((r) => {
      $("int-" + r).textContent = YTCards.formatInterval(YTCards.intervalFor(current, r));
    });
    $("answer").hidden = false;
    $("rate").hidden = false;
  }

  function renderEmpty() {
    $("card").hidden = true;
    $("rate").hidden = true;
    $("empty").hidden = false;
    const pool = poolCards();
    if (!pool.length) {
      $("emptyTitle").textContent = "No cards here yet";
      $("emptyText").textContent = "Open a YouTube video, turn on dual subtitles, click a word and press “Add to flashcards”.";
      return;
    }
    const next = Math.min(...pool.map((c) => c.due));
    $("emptyTitle").textContent = "All caught up 🎉";
    const update = () => {
      if (Date.now() >= next) { showNext(); return; }
      $("emptyText").textContent = `Next card in ${YTCards.formatCountdown(next - Date.now())}.`;
    };
    update();
    waitTimer = setInterval(update, 1000);
  }

  function rate(rating) {
    if (!current || !revealed) return;
    const updated = YTCards.schedule(current, rating);
    const i = data.cards.findIndex((c) => c.id === updated.id);
    if (i >= 0) data.cards[i] = updated;
    current = null;
    YTCards.updateCard(updated.id, updated).catch((e) => toast(e.message));
    showNext();
  }

  /* ------------------------------ manage ------------------------------ */
  function renderManage() {
    fillFilter();
    // folders
    const list = $("folderList");
    list.textContent = "";
    data.folders.forEach((f) => {
      const count = data.cards.filter((c) => c.folderId === f.id).length;
      const li = h("li", {},
        h("span", { class: "fname" }, f.name),
        h("span", { class: "muted" }, `${count} card${count === 1 ? "" : "s"}`),
        h("button", { class: "small", onclick: () => renameFolder(f) }, "Rename"),
        f.id === YTCards.DEFAULT_FOLDER.id
          ? ""
          : h("button", { class: "small danger", onclick: () => removeFolder(f, count) }, "Delete")
      );
      list.append(li);
    });

    // cards
    const q = $("cardSearch").value.trim().toLowerCase();
    const cards = poolCards()
      .filter((c) => !q || [c.front, c.back, c.example, c.exampleTr, c.extra].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.created - a.created);
    $("cardCount").textContent = `(${cards.length})`;
    const table = $("cardTable");
    table.textContent = "";
    if (!cards.length) {
      table.append(h("div", { class: "muted" }, "No cards to show."));
      return;
    }
    const now = Date.now();
    cards.slice(0, 300).forEach((c) => {
      const sel = h("select", { onchange: (e) => moveCard(c.id, e.target.value) },
        data.folders.map((f) => h("option", { value: f.id, selected: f.id === c.folderId }, f.name)));
      table.append(
        h("div", { class: "crow" },
          h("div", {}, h("span", { class: "cword" }, c.front), " ", h("span", { class: "cback" }, c.back || "")),
          h("button", { class: "small danger", onclick: () => removeCard(c) }, "Delete"),
          h("div", { class: "cmeta" },
            sel,
            h("span", {}, c.due <= now ? "due now" : `due in ${YTCards.formatCountdown(c.due - now)}`),
            h("span", {}, `Good ×${c.goodCount || 0}`),
            c.example ? h("span", {}, "“" + c.example.slice(0, 70) + (c.example.length > 70 ? "…" : "") + "”") : ""
          )
        )
      );
    });
    if (cards.length > 300) table.append(h("div", { class: "muted" }, `Showing the newest 300 of ${cards.length}. Use search to narrow down.`));
  }

  async function mutateAndRender(fn, okText) {
    try {
      await fn();
      await reload();
      renderManage();
      if (okText) toast(okText);
    } catch (e) {
      toast(e.message || "Something went wrong.");
    }
  }
  const renameFolder = (f) => {
    const name = prompt("Rename folder", f.name);
    if (name && name.trim() && name.trim() !== f.name) mutateAndRender(() => YTCards.renameFolder(f.id, name), "Folder renamed");
  };
  const removeFolder = (f, count) => {
    const msg = count
      ? `Delete “${f.name}”? Its ${count} card(s) will be moved to “Default”.`
      : `Delete the empty folder “${f.name}”?`;
    if (confirm(msg)) mutateAndRender(() => YTCards.deleteFolder(f.id), "Folder deleted");
  };
  const moveCard = (id, folderId) => mutateAndRender(() => YTCards.updateCard(id, { folderId }), "Card moved");
  const removeCard = (c) => {
    if (confirm(`Delete the card “${c.front}”?`)) mutateAndRender(() => YTCards.deleteCard(c.id), "Card deleted");
  };

  /* ------------------------------ wiring ------------------------------ */
  function setView(v) {
    view = v;
    $("studyView").hidden = v !== "study";
    $("manageView").hidden = v !== "manage";
    $("tabStudy").classList.toggle("active", v === "study");
    $("tabManage").classList.toggle("active", v === "manage");
    if (v === "study") showNext();
    else { clearInterval(waitTimer); renderManage(); }
  }

  $("tabStudy").addEventListener("click", () => setView("study"));
  $("tabManage").addEventListener("click", () => setView("manage"));
  $("folderFilter").addEventListener("change", (e) => {
    folder = e.target.value;
    if (view === "study") showNext(); else renderManage();
  });
  $("showBtn").addEventListener("click", reveal);
  document.querySelectorAll(".rbtn").forEach((b) => b.addEventListener("click", () => rate(b.dataset.rating)));
  $("cardSearch").addEventListener("input", renderManage);
  $("newFolderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("newFolderName").value;
    if (!name.trim()) return;
    $("newFolderName").value = "";
    mutateAndRender(() => YTCards.addFolder(name), "Folder created");
  });

  document.addEventListener("keydown", (e) => {
    if (view !== "study" || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === " " || e.key === "Enter") {
      if (current && !revealed) { e.preventDefault(); reveal(); }
    } else if (e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      rate(RATINGS[Number(e.key) - 1]);
    }
  });

  // Words saved from YouTube show up here without a refresh.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.ytcards) return;
    await reload();
    if (view === "manage") { renderManage(); return; }
    fillFilter();
    updateCounts();
    if (!current) showNext();
  });

  (async () => {
    await reload();
    setView("study");
  })();
})();
