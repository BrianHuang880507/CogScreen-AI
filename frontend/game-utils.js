(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";
  const GAME_KEYS = ["logic", "reaction", "focus"];

  const GAME_ROUTE_MAP = {
    logic: "/game-logic.html",
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

  function getSessionGameResults(sessionId) {
    if (!sessionId) {
      return {
        session_id: null,
        logic: null,
        reaction: null,
        focus: null,
      };
    }
    const map = readResultsMap();
    const existing = map[sessionId] || {};
    return {
      session_id: sessionId,
      logic: existing.logic || null,
      reaction: existing.reaction || null,
      focus: existing.focus || null,
    };
  }

  function saveSessionGameResult(sessionId, gameKey, payload) {
    if (!sessionId || !GAME_KEYS.includes(gameKey)) {
      return;
    }
    const map = readResultsMap();
    const previous = map[sessionId] || {};
    map[sessionId] = {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      logic: previous.logic || null,
      reaction: previous.reaction || null,
      focus: previous.focus || null,
      [gameKey]: payload,
    };
    writeResultsMap(map);
  }

  function countCompletedGames(entry) {
    if (!entry) {
      return 0;
    }
    return GAME_KEYS.filter((key) => Boolean(entry[key])).length;
  }

  function allGamesCompleted(entry) {
    return countCompletedGames(entry) === GAME_KEYS.length;
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
    ensureAuthenticated,
    resolveSessionId,
    getSessionGameResults,
    saveSessionGameResult,
    countCompletedGames,
    allGamesCompleted,
    buildGameUrl,
    buildGameHubUrl,
    buildResultsUrl,
  };
})();
