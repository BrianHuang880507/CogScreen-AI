(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";
  const GAME_REWARD_KEY = "gameRewardState";

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

  const REWARD_CATALOG = [
    {
      id: "garden-badge",
      title: "花園徽章",
      cost: 60,
      description: "完成遊戲後可兌換的鼓勵徽章。",
    },
    {
      id: "tea-break-card",
      title: "午茶卡",
      cost: 100,
      description: "送給自己的休息獎勵卡。",
    },
    {
      id: "gold-star",
      title: "金星勳章",
      cost: 180,
      description: "累積多次練習後的成就紀念。",
    },
  ];

  const POINT_RULES = {
    completion: 25,
    logicPerCorrect: 2,
    sequencePerNumber: 2,
    memoryPerPair: 5,
    reactionPerHit: 3,
    focusPerTarget: 10,
    noErrorBonus: 12,
    steadyPlayBonus: 8,
  };

  function ensureAuthenticated() {
    if (sessionStorage.getItem(LOGIN_KEY) !== "true") {
      window.location.href = "/";
      return false;
    }
    return true;
  }

  function generateClientSessionId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
    return `local-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function resolveSessionId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("session_id");
    if (fromQuery) {
      sessionStorage.setItem(REPORT_SESSION_KEY, fromQuery);
      return fromQuery;
    }

    const fromStorage = sessionStorage.getItem(REPORT_SESSION_KEY);
    if (fromStorage) {
      return fromStorage;
    }

    const generated = generateClientSessionId();
    sessionStorage.setItem(REPORT_SESSION_KEY, generated);
    return generated;
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

  function createRewardState() {
    return {
      points: 0,
      redeemed: {},
      ledger: [],
    };
  }

  function normalizeRewardState(rawState) {
    const base = createRewardState();
    if (!rawState || typeof rawState !== "object") {
      return base;
    }
    const points = Number(rawState.points);
    return {
      points: Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0,
      redeemed:
        rawState.redeemed && typeof rawState.redeemed === "object"
          ? { ...rawState.redeemed }
          : {},
      ledger: Array.isArray(rawState.ledger) ? rawState.ledger.slice(-80) : [],
    };
  }

  function readRewardState() {
    try {
      const raw = localStorage.getItem(GAME_REWARD_KEY);
      return normalizeRewardState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return createRewardState();
    }
  }

  function writeRewardState(state) {
    localStorage.setItem(GAME_REWARD_KEY, JSON.stringify(normalizeRewardState(state)));
  }

  function getPointsBalance() {
    return readRewardState().points;
  }

  function formatDuration(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function clampAward(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.max(0, Math.round(numeric));
  }

  function calculateGamePoints(gameKey, payload = {}) {
    let points = POINT_RULES.completion;
    const details = [];

    if (gameKey === "logic") {
      const correct = clampAward(payload.correct ?? payload.total ?? 0);
      points += correct * POINT_RULES.logicPerCorrect;
      details.push(`分類完成 ${correct} 個`);
      if (payload.total && correct >= Number(payload.total)) {
        points += POINT_RULES.noErrorBonus;
        details.push("全數放對");
      }
    } else if (gameKey === "sequence") {
      const completed = clampAward(payload.completed_count ?? payload.total_numbers ?? 0);
      const errors = clampAward(payload.errors);
      points += completed * POINT_RULES.sequencePerNumber;
      points -= Math.min(points, errors * 2);
      details.push(`依序點完 ${completed} 個數字`);
      if (errors === 0) {
        points += POINT_RULES.noErrorBonus;
        details.push("沒有誤點");
      }
    } else if (gameKey === "memory") {
      const pairs = clampAward(payload.pairs_matched ?? payload.pairs_total ?? 0);
      const moves = clampAward(payload.moves);
      points += pairs * POINT_RULES.memoryPerPair;
      details.push(`完成 ${pairs} 組配對`);
      if (pairs > 0 && moves <= pairs * 2.5) {
        points += POINT_RULES.steadyPlayBonus;
        details.push("配對步數穩定");
      }
    } else if (gameKey === "reaction") {
      const hits = clampAward(payload.hits);
      const misses = clampAward(payload.misses);
      points += hits * POINT_RULES.reactionPerHit;
      points -= Math.min(points, misses);
      details.push(`命中 ${hits} 次`);
      if (hits >= 20) {
        points += POINT_RULES.steadyPlayBonus;
        details.push("維持專注命中");
      }
    } else if (gameKey === "focus") {
      const found = clampAward(payload.found ?? payload.total ?? 0);
      points += found * POINT_RULES.focusPerTarget;
      details.push(`找到 ${found} 個差異`);
      if (payload.total && found >= Number(payload.total)) {
        points += POINT_RULES.noErrorBonus;
        details.push("全部找完");
      }
    }

    return {
      points: Math.max(1, Math.round(points)),
      reason: details.join("、") || "完成遊戲",
    };
  }

  function awardGamePoints(sessionId, gameKey, payload = {}) {
    if (!GAME_KEYS.includes(gameKey)) {
      return { points: 0, balance: getPointsBalance(), reason: "" };
    }
    const award = calculateGamePoints(gameKey, payload);
    const state = readRewardState();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: "earn",
      session_id: sessionId || null,
      game_key: gameKey,
      points: award.points,
      reason: award.reason,
      at: new Date().toISOString(),
    };
    state.points += award.points;
    state.ledger.push(entry);
    state.ledger = state.ledger.slice(-80);
    writeRewardState(state);
    renderPointsWidgets(`獲得 ${award.points} 點：${award.reason}`);
    window.dispatchEvent(new CustomEvent("game-points-updated", { detail: entry }));
    return { ...award, balance: state.points };
  }

  function redeemReward(rewardId) {
    const reward = REWARD_CATALOG.find((item) => item.id === rewardId);
    const state = readRewardState();
    if (!reward) {
      return { ok: false, message: "找不到這個獎勵。", balance: state.points };
    }
    if (state.points < reward.cost) {
      return {
        ok: false,
        message: `點數還差 ${reward.cost - state.points} 點才能兌換「${reward.title}」。`,
        balance: state.points,
      };
    }
    state.points -= reward.cost;
    state.redeemed[reward.id] = (Number(state.redeemed[reward.id]) || 0) + 1;
    state.ledger.push({
      id: `${Date.now()}-${reward.id}`,
      type: "redeem",
      reward_id: reward.id,
      reward_title: reward.title,
      points: -reward.cost,
      at: new Date().toISOString(),
    });
    state.ledger = state.ledger.slice(-80);
    writeRewardState(state);
    const message = `已兌換「${reward.title}」，剩餘 ${state.points} 點。`;
    renderPointsWidgets(message);
    window.dispatchEvent(new CustomEvent("game-points-updated", { detail: { reward_id: reward.id } }));
    return { ok: true, message, balance: state.points };
  }

  function ensureGamePointsChip() {
    const body = document.body;
    if (!body || !String(body.dataset.page || "").startsWith("game-")) {
      return;
    }
    if (document.getElementById("gamePointsBalance")) {
      return;
    }
    const chip = document.createElement("div");
    chip.className = "game-points-chip";
    chip.innerHTML = '點數 <strong id="gamePointsBalance">0</strong>';
    document.body.appendChild(chip);
  }

  function ensureRewardsPanel() {
    const body = document.body;
    if (!body || body.dataset.page !== "games" || document.getElementById("rewardList")) {
      return;
    }
    const summary = document.querySelector(".game-summary-panel");
    if (!summary || !summary.parentElement) {
      return;
    }
    const panel = document.createElement("section");
    panel.className = "panel reward-panel";
    panel.innerHTML = `
      <div class="reward-panel-head">
        <div>
          <h2>遊戲點數與獎勵</h2>
          <p class="muted">完成遊戲會累積點數，可兌換虛擬獎勵。</p>
        </div>
        <div class="reward-balance"><span id="rewardPointsBalance">0</span> 點</div>
      </div>
      <div id="rewardList" class="reward-list"></div>
      <p id="rewardFeedback" class="reward-feedback" aria-live="polite"></p>
    `;
    summary.insertAdjacentElement("afterend", panel);
  }

  function renderPointsWidgets(feedback = "") {
    ensureGamePointsChip();
    ensureRewardsPanel();
    const state = readRewardState();
    const balanceEls = [
      document.getElementById("gamePointsBalance"),
      document.getElementById("rewardPointsBalance"),
    ].filter(Boolean);
    balanceEls.forEach((el) => {
      el.textContent = String(state.points);
    });

    const listEl = document.getElementById("rewardList");
    if (listEl) {
      listEl.innerHTML = "";
      REWARD_CATALOG.forEach((reward) => {
        const owned = Number(state.redeemed[reward.id]) || 0;
        const item = document.createElement("article");
        item.className = "reward-item";
        item.innerHTML = `
          <div>
            <h3>${reward.title}</h3>
            <p>${reward.description}</p>
            <span class="reward-owned">已兌換 ${owned} 次</span>
          </div>
          <button class="reward-redeem-button" type="button" data-reward-id="${reward.id}">
            ${reward.cost} 點兌換
          </button>
        `;
        const button = item.querySelector("button");
        if (button) {
          button.disabled = state.points < reward.cost;
          button.addEventListener("click", () => {
            const result = redeemReward(reward.id);
            const feedbackEl = document.getElementById("rewardFeedback");
            if (feedbackEl) {
              feedbackEl.textContent = result.message;
              feedbackEl.classList.toggle("is-error", !result.ok);
            }
          });
        }
        listEl.appendChild(item);
      });
    }

    const feedbackEl = document.getElementById("rewardFeedback");
    if (feedbackEl && feedback) {
      feedbackEl.textContent = feedback;
      feedbackEl.classList.remove("is-error");
    }
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
    REWARD_CATALOG,
    POINT_RULES,
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
    getPointsBalance,
    awardGamePoints,
    redeemReward,
    renderPointsWidgets,
    formatDuration,
  };

  renderPointsWidgets();
})();
