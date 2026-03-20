(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";

  // Playable games.
  const GAME_KEYS = ["logic", "sequence", "memory", "reaction", "focus"];

  // Completion is category-based, not per playable game.
  const REQUIRED_CATEGORIES = ["logic", "memory", "reaction", "focus"];
  const CATEGORY_GAME_KEYS = {
    logic: ["logic", "sequence"],
    memory: ["memory"],
    reaction: ["reaction"],
    focus: ["focus"],
  };

  const GAME_ROUTE_MAP = {
    logic: "/game-logic.html",
    sequence: "/game-sequence.html",
    memory: "/game-memory.html",
    reaction: "/game-reaction.html",
    focus: "/game-focus.html",
  };

  function ensureAuthenticated() {
    if (sessionStorage.getItem(LOGIN_KEY) !== "true") {
      window.location.href = "/";
      return false;
    }
    return true;
  }

  function resolveSessionId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("session_id");
    if (fromQuery) {
      sessionStorage.setItem(REPORT_SESSION_KEY, fromQuery);
      return fromQuery;
    }
    return sessionStorage.getItem(REPORT_SESSION_KEY);
  }

  function readResultsMap() {
    try {
      const raw = localStorage.getItem(GAME_RESULTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function writeResultsMap(map) {
    localStorage.setItem(GAME_RESULTS_KEY, JSON.stringify(map));
  }

  function createEmptyEntry(sessionId) {
    return {
      session_id: sessionId || null,
      logic: null,
      sequence: null,
      memory: null,
      reaction: null,
      focus: null,
    };
  }

  function normalizeEntry(sessionId, existing) {
    const base = createEmptyEntry(sessionId);
    if (!existing || typeof existing !== "object") {
      return base;
    }
    return {
      ...base,
      updated_at: existing.updated_at || null,
      logic: existing.logic || existing.logic_classify || null,
      sequence: existing.sequence || existing.logic_sequence || null,
      memory: existing.memory || existing.memory_match || null,
      reaction: existing.reaction || null,
      focus: existing.focus || null,
    };
  }

  function getSessionGameResults(sessionId) {
    if (!sessionId) {
      return createEmptyEntry(null);
    }
    const map = readResultsMap();
    return normalizeEntry(sessionId, map[sessionId] || {});
  }

  function saveSessionGameResult(sessionId, gameKey, payload) {
    if (!sessionId || !GAME_KEYS.includes(gameKey)) {
      return;
    }
    const map = readResultsMap();
    const previous = normalizeEntry(sessionId, map[sessionId] || {});
    map[sessionId] = {
      ...previous,
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      [gameKey]: payload,
    };
    writeResultsMap(map);
  }

  function isCategoryCompleted(entry, category) {
    const keys = CATEGORY_GAME_KEYS[category] || [];
    if (!entry || !keys.length) {
      return false;
    }
    return keys.some((key) => Boolean(entry[key]));
  }

  function countCompletedGames(entry) {
    if (!entry) {
      return 0;
    }
    return REQUIRED_CATEGORIES.filter((category) => isCategoryCompleted(entry, category)).length;
  }

  function allGamesCompleted(entry) {
    return countCompletedGames(entry) === REQUIRED_CATEGORIES.length;
  }

  function withSession(path, sessionId) {
    if (!sessionId) {
      return path;
    }
    const params = new URLSearchParams({ session_id: sessionId });
    return `${path}?${params.toString()}`;
  }

  function buildGameUrl(gameKey, sessionId) {
    const route = GAME_ROUTE_MAP[gameKey] || "/games.html";
    return withSession(route, sessionId);
  }

  function buildGameHubUrl(sessionId) {
    return withSession("/games.html", sessionId);
  }

  function buildResultsUrl(sessionId) {
    return withSession("/results.html", sessionId);
  }

  window.GameFlow = {
    GAME_KEYS,
    REQUIRED_CATEGORIES,
    CATEGORY_GAME_KEYS,
    ensureAuthenticated,
    resolveSessionId,
    getSessionGameResults,
    saveSessionGameResult,
    isCategoryCompleted,
    countCompletedGames,
    allGamesCompleted,
    buildGameUrl,
    buildGameHubUrl,
    buildResultsUrl,
  };
})();
