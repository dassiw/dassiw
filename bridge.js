// Runs in the page's own JS context (world: MAIN) so it can read the YouTube
// player object, which isolated content scripts cannot see.
//
// Why it also watches network requests: YouTube now answers subtitle downloads
// (/api/timedtext) with an EMPTY 200 response unless the request carries the
// "proof of origin" token (`pot`) that its own player generates. We cannot mint
// that token, but the player attaches it to its own subtitle request, so we
// borrow the token (and the matching client params) from that request.
(() => {
  if (window.__ytsubBridge) return;
  window.__ytsubBridge = true;

  const reply = (id, payload) =>
    window.postMessage({ source: "ytsub-bridge", id, payload }, "*");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getPlayerResponse = () => {
    const player = document.getElementById("movie_player");
    let pr = null;
    try {
      pr = player && player.getPlayerResponse && player.getPlayerResponse();
    } catch (_) {}
    return pr || window.ytInitialPlayerResponse || null;
  };

  const getTracks = () => {
    const pr = getPlayerResponse();
    return (
      (pr &&
        pr.captions &&
        pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks) ||
      []
    );
  };

  // Languages YouTube offers for auto-translation (null = list not available).
  const getTranslationLanguages = () => {
    const pr = getPlayerResponse();
    const list =
      pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.translationLanguages;
    return Array.isArray(list) && list.length ? list.map((l) => l.languageCode) : null;
  };

  /* ------------------------- proof-of-origin capture ------------------------- */
  const PARAMS = ["pot", "potc", "c", "cver", "cplayer", "cbr", "cbrver", "cos", "cosver", "cplatform"];
  const captured = {}; // videoId -> { pot, c, ... } taken from the player's own request

  function noteUrl(raw) {
    try {
      const url = new URL(String(raw), location.href);
      if (!url.pathname.includes("/api/timedtext")) return;
      const v = url.searchParams.get("v");
      if (!v || !url.searchParams.get("pot")) return;
      const p = {};
      PARAMS.forEach((k) => { if (url.searchParams.has(k)) p[k] = url.searchParams.get(k); });
      captured[v] = p;
    } catch (_) {}
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input) {
      try { noteUrl(typeof input === "string" ? input : input && input.url); } catch (_) {}
      return origFetch.apply(this, arguments);
    };
  }
  const origOpen = window.XMLHttpRequest && XMLHttpRequest.prototype.open;
  if (origOpen) {
    XMLHttpRequest.prototype.open = function (method, url) {
      try { noteUrl(url); } catch (_) {}
      return origOpen.apply(this, arguments);
    };
  }

  // Also covers requests made before this script was installed.
  function lookup(videoId) {
    if (captured[videoId]) return captured[videoId];
    try {
      const entries = performance.getEntriesByType("resource");
      for (let i = entries.length - 1; i >= 0; i--) noteUrl(entries[i].name);
    } catch (_) {}
    return captured[videoId] || null;
  }

  let potJobs = {}; // videoId -> Promise, so parallel callers share one lookup

  async function obtainPot(videoId, lang) {
    const existing = lookup(videoId);
    if (existing) return existing;

    // No subtitle request seen yet: ask the player to load captions, which makes
    // it download a subtitle file (with the token). Restore the previous state after.
    const player = document.getElementById("movie_player");
    if (!player || typeof player.setOption !== "function") return null;
    const tracks = getTracks();
    const wanted = lang || (tracks[0] && tracks[0].languageCode);
    if (!wanted) return null;

    let previous = null;
    try { previous = player.getOption("captions", "track"); } catch (_) {}
    try {
      if (player.loadModule) player.loadModule("captions");
      player.setOption("captions", "track", { languageCode: wanted });
    } catch (_) {}

    let found = null;
    for (let i = 0; i < 40 && !found; i++) {
      await sleep(150);
      found = lookup(videoId);
    }

    try {
      if (previous && previous.languageCode) player.setOption("captions", "track", previous);
      else if (player.unloadModule) player.unloadModule("captions");
    } catch (_) {}
    return found;
  }

  function getPot(videoId, lang) {
    if (!potJobs[videoId]) {
      potJobs[videoId] = obtainPot(videoId, lang).finally(() => { delete potJobs[videoId]; });
    }
    return potJobs[videoId];
  }

  /* ------------------------------- messages ------------------------------- */
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (e.source !== window || !msg || msg.source !== "ytsub-content") return;
    const player = document.getElementById("movie_player");

    switch (msg.type) {
      case "GET_TRACKS": {
        const pr = getPlayerResponse();
        const details = (pr && pr.videoDetails) || {};
        reply(msg.id, {
          videoId: details.videoId || null,
          title: details.title || document.title,
          translationLanguages: getTranslationLanguages(),
          tracks: getTracks().map((t) => ({
            languageCode: t.languageCode,
            name: (t.name && (t.name.simpleText || (t.name.runs || []).map((r) => r.text).join(""))) || t.languageCode,
            baseUrl: t.baseUrl,
            auto: t.kind === "asr",
            translatable: t.isTranslatable !== false,
          })),
        });
        break;
      }
      case "GET_POT": {
        const d = msg.data || {};
        getPot(d.videoId, d.lang)
          .then((pot) => reply(msg.id, { pot: pot || null }))
          .catch(() => reply(msg.id, { pot: null }));
        break;
      }
      case "SEEK":
        if (player && player.seekTo) player.seekTo(msg.data.seconds, true);
        reply(msg.id, { ok: true });
        break;
      case "GET_TIME":
        reply(msg.id, {
          time: player && player.getCurrentTime ? player.getCurrentTime() : 0,
        });
        break;
    }
  });
})();
