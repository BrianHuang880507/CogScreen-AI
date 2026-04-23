(function () {
  const flow = window.GameFlow;
  if (!flow || !flow.ensureAuthenticated()) {
    return;
  }

  const sessionId = flow.resolveSessionId();
  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const backToGames = document.getElementById("backToGames");
  const boardEl = document.getElementById("memoryBoard");
  const instructionEl = document.getElementById("memoryInstruction");
  const matchedEl = document.getElementById("memoryMatched");
  const totalPairsEl = document.getElementById("memoryPairsTotal");
  const movesEl = document.getElementById("memoryMoves");
  const timerEl = document.getElementById("memoryTimer");
  const resultEl = document.getElementById("memoryResult");
  const startOverlayEl = document.getElementById("memoryStartOverlay");
  const startButtonEl = document.getElementById("memoryStartButton");
  const difficultyButtons = Array.from(
    document.querySelectorAll(".difficulty-button[data-difficulty]"),
  );

  const DIFFICULTY_STORAGE_KEY = "memoryDifficulty";
  const SYMBOL_POOL = ["茶", "花", "米", "魚", "杯", "車", "門", "鞋", "書", "傘", "燈", "鐘", "桃", "星"];

  // Completion-time scoring is intentionally minute-level for older adults.
  const DIFFICULTY_CONFIG = {
    easy: {
      label: "簡單",
      pairs: 6,
      columns: 3,
      timeTargetSec: 120,
      timeLimitSec: 300,
      guardMinMovesPerPair: 1.6,
      guardMaxMovesPerPair: 4.2,
      guardMinMultiplier: 0.5,
    },
    medium: {
      label: "一般",
      pairs: 8,
      columns: 4,
      timeTargetSec: 180,
      timeLimitSec: 420,
      guardMinMovesPerPair: 1.7,
      guardMaxMovesPerPair: 4.5,
      guardMinMultiplier: 0.5,
    },
    hard: {
      label: "挑戰",
      pairs: 10,
      columns: 5,
      timeTargetSec: 240,
      timeLimitSec: 540,
      guardMinMovesPerPair: 1.8,
      guardMaxMovesPerPair: 4.8,
      guardMinMultiplier: 0.5,
    },
  };

  let selectedDifficulty = "easy";
  let redirectTimer = null;
  let timerInterval = null;
  let running = false;
  let deck = [];
  let firstIndex = null;
  let secondIndex = null;
  let lockInput = false;
  let matched = new Set();
  let moves = 0;
  let startAtMs = 0;
  let startedAtIso = null;
  let attemptLog = [];

  function requiredCount() {
    return Array.isArray(flow.REQUIRED_CATEGORIES)
      ? flow.REQUIRED_CATEGORIES.length
      : flow.GAME_KEYS.length;
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  function clearRedirect() {
    if (redirectTimer) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
    }
  }

  function stopTimer() {
    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function loadStoredDifficulty() {
    try {
      return sessionStorage.getItem(DIFFICULTY_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveStoredDifficulty(value) {
    try {
      sessionStorage.setItem(DIFFICULTY_STORAGE_KEY, value);
    } catch (error) {
      return;
    }
  }

  function getDifficultyConfig() {
    return DIFFICULTY_CONFIG[selectedDifficulty] || DIFFICULTY_CONFIG.easy;
  }

  function renderDifficulty() {
    const config = getDifficultyConfig();
    difficultyButtons.forEach((button) => {
      const isActive = button.dataset.difficulty === selectedDifficulty;
      button.classList.toggle("is-active", isActive);
      button.disabled = running;
    });
    if (instructionEl) {
      instructionEl.textContent = `請找出 ${config.pairs} 組相同牌面。沒有倒數，完成時間會被記錄。`;
    }
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${requiredCount()}`;
    }
  }

  function setStartOverlayVisible(visible) {
    if (startOverlayEl) {
      startOverlayEl.classList.toggle("hidden", !visible);
    }
  }

  function shuffle(list) {
    const next = [...list];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = next[i];
      next[i] = next[j];
      next[j] = temp;
    }
    return next;
  }

  function updateTimer() {
    if (!timerEl) {
      return;
    }
    if (!running || !startAtMs) {
      timerEl.textContent = "00:00";
      return;
    }
    timerEl.textContent = flow.formatDuration((Date.now() - startAtMs) / 1000);
  }

  function updateMeta() {
    const config = getDifficultyConfig();
    if (matchedEl) {
      matchedEl.textContent = String(Math.floor(matched.size / 2));
    }
    if (totalPairsEl) {
      totalPairsEl.textContent = String(config.pairs);
    }
    if (movesEl) {
      movesEl.textContent = String(moves);
    }
  }

  function setCardFace(cardButton, reveal) {
    cardButton.classList.toggle("is-revealed", reveal);
  }

  function applyBoardLayout() {
    if (boardEl) {
      boardEl.style.setProperty("--memory-columns", String(getDifficultyConfig().columns));
    }
  }

  function buildDeck() {
    const config = getDifficultyConfig();
    const chosen = shuffle(SYMBOL_POOL).slice(0, config.pairs);
    deck = shuffle(
      chosen.flatMap((symbol, pairId) => [
        { pairId, symbol },
        { pairId, symbol },
      ]),
    );
  }

  function renderBoard() {
    if (!boardEl) {
      return;
    }
    boardEl.innerHTML = "";
    deck.forEach((card, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "memory-card";
      btn.dataset.index = String(index);
      btn.setAttribute("aria-pressed", "false");

      const front = document.createElement("span");
      front.className = "memory-card-front";
      front.textContent = "?";

      const back = document.createElement("span");
      back.className = "memory-card-back";
      back.textContent = card.symbol;

      btn.appendChild(front);
      btn.appendChild(back);
      btn.addEventListener("click", () => onCardClick(index));
      boardEl.appendChild(btn);
    });
  }

  function resetRoundState() {
    firstIndex = null;
    secondIndex = null;
    lockInput = false;
    matched = new Set();
    moves = 0;
    startAtMs = 0;
    startedAtIso = null;
    attemptLog = [];
  }

  function prepareRoundBoard() {
    resetRoundState();
    applyBoardLayout();
    buildDeck();
    renderBoard();
    updateMeta();
    updateTimer();
  }

  function cardButtonAt(index) {
    return boardEl ? boardEl.querySelector(`[data-index="${index}"]`) : null;
  }

  function revealIndex(index, reveal) {
    const btn = cardButtonAt(index);
    if (!btn) {
      return;
    }
    setCardFace(btn, reveal);
    btn.disabled = matched.has(index);
    btn.setAttribute("aria-pressed", reveal ? "true" : "false");
  }

  function onComplete(payload) {
    if (!sessionId) {
      return;
    }
    flow.saveSessionGameResult(sessionId, "memory", payload);
    renderProgress();
    clearRedirect();
    const entry = flow.getSessionGameResults(sessionId);
    if (flow.allGamesCompleted(entry)) {
      setStatus("四類遊戲都完成了，正在前往結果分析。");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1800);
      return;
    }
    setStatus("圖片配對完成，正在回到遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1800);
  }

  function calculateMemoryScore(elapsedSec, movesCount, pairsTotal, config) {
    const safePairs = Math.max(1, Number(pairsTotal) || 1);
    const safeMoves = Math.max(1, Number(movesCount) || 1);
    const safeElapsed = Math.max(0, Number(elapsedSec) || 0);
    const targetSec = Math.max(1, Number(config.timeTargetSec) || 1);
    const limitSec = Math.max(targetSec + 1, Number(config.timeLimitSec) || targetSec + 1);
    const overTarget = Math.max(0, safeElapsed - targetSec);
    const timeScore = Math.max(
      0,
      Math.round((1 - Math.min(overTarget / (limitSec - targetSec), 1)) * 100),
    );
    const minMovesPerPair = Math.max(1, Number(config.guardMinMovesPerPair) || 1);
    const maxMovesPerPair = Math.max(
      minMovesPerPair + 0.01,
      Number(config.guardMaxMovesPerPair) || minMovesPerPair + 0.01,
    );
    const minMultiplier = Math.max(0.2, Math.min(1, Number(config.guardMinMultiplier) || 0.5));
    const movesPerPair = safeMoves / safePairs;

    let guardMultiplier = 1;
    if (movesPerPair > minMovesPerPair) {
      const guardRatio = Math.min(
        (movesPerPair - minMovesPerPair) / (maxMovesPerPair - minMovesPerPair),
        1,
      );
      guardMultiplier = 1 - guardRatio * (1 - minMultiplier);
    }

    const score = Math.max(0, Math.min(100, Math.round(timeScore * guardMultiplier)));
    return {
      score,
      timeScore,
      guardMultiplier: Number(guardMultiplier.toFixed(3)),
      movesPerPair: Number(movesPerPair.toFixed(2)),
    };
  }

  function finishGame() {
    const config = getDifficultyConfig();
    running = false;
    stopTimer();
    updateTimer();

    const elapsed = startAtMs ? (Date.now() - startAtMs) / 1000 : 0;
    const matchedPairs = Math.floor(matched.size / 2);
    const wrongAttempts = Math.max(0, moves - matchedPairs);
    const scoreResult = calculateMemoryScore(elapsed, moves, config.pairs, config);
    const endedAt = new Date();
    const payload = {
      difficulty: selectedDifficulty,
      pairs_total: config.pairs,
      pairs_matched: matchedPairs,
      moves,
      score: scoreResult.score,
      duration_sec: Number(elapsed.toFixed(1)),
      completed_at: endedAt.toISOString(),
      details: {
        started_at: startedAtIso,
        ended_at: endedAt.toISOString(),
        columns: config.columns,
        wrong_attempts: wrongAttempts,
        scoring_version: "v3_minute_completion_time",
        time_target_sec: config.timeTargetSec,
        time_limit_sec: config.timeLimitSec,
        time_score: scoreResult.timeScore,
        guard_multiplier: scoreResult.guardMultiplier,
        moves_per_pair: scoreResult.movesPerPair,
        attempts: [...attemptLog],
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "memory", payload);

    if (resultEl) {
      resultEl.textContent = `完成配對，用時 ${flow.formatDuration(elapsed)}，翻牌 ${moves} 次，原遊戲分數 ${scoreResult.score}，本次獲得 ${pointAward.points} 點。`;
    }

    onComplete(payload);
  }

  function onCardClick(index) {
    if (!running || lockInput || matched.has(index) || firstIndex === index) {
      return;
    }

    revealIndex(index, true);

    if (firstIndex === null) {
      firstIndex = index;
      setStatus("請再翻一張，找相同的牌。");
      return;
    }

    secondIndex = index;
    lockInput = true;
    moves += 1;
    updateMeta();

    const first = deck[firstIndex];
    const second = deck[secondIndex];
    const isMatch = first && second && first.pairId === second.pairId;
    attemptLog.push({
      at: new Date().toISOString(),
      first_index: firstIndex,
      second_index: secondIndex,
      first_symbol: first ? first.symbol : null,
      second_symbol: second ? second.symbol : null,
      is_match: isMatch,
    });

    if (isMatch) {
      matched.add(firstIndex);
      matched.add(secondIndex);
      firstIndex = null;
      secondIndex = null;
      lockInput = false;
      updateMeta();
      setStatus("配對成功，繼續找下一組。");
      if (matched.size === deck.length) {
        finishGame();
      }
      return;
    }

    setStatus("這一組不同，稍後會蓋回去。");
    window.setTimeout(() => {
      revealIndex(firstIndex, false);
      revealIndex(secondIndex, false);
      firstIndex = null;
      secondIndex = null;
      lockInput = false;
    }, 900);
  }

  function setDifficulty(nextDifficulty) {
    if (running || !DIFFICULTY_CONFIG[nextDifficulty]) {
      return;
    }
    selectedDifficulty = nextDifficulty;
    saveStoredDifficulty(selectedDifficulty);
    renderDifficulty();
    prepareRoundBoard();
    if (resultEl) {
      resultEl.textContent = "按開始後，翻牌找出相同內容。";
    }
    setStatus(`已選擇 ${getDifficultyConfig().label}，按開始後開始計時。`);
  }

  function startGame() {
    clearRedirect();
    running = true;
    prepareRoundBoard();
    startedAtIso = new Date().toISOString();
    startAtMs = Date.now();
    updateTimer();
    stopTimer();
    timerInterval = window.setInterval(updateTimer, 500);

    setStartOverlayVisible(false);
    renderDifficulty();
    setStatus("請翻兩張牌，找出相同的一組。");
    if (resultEl) {
      resultEl.textContent = "遊戲進行中。";
    }
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.memory || !resultEl) {
      return;
    }
    const difficultyLabel = DIFFICULTY_CONFIG[entry.memory.difficulty || ""]?.label || "--";
    resultEl.textContent = `上次結果：${difficultyLabel}，完成 ${entry.memory.pairs_matched}/${entry.memory.pairs_total} 組，原遊戲分數 ${entry.memory.score}。`;
  }

  function initDifficulty() {
    selectedDifficulty = "easy";
    saveStoredDifficulty(selectedDifficulty);
    renderDifficulty();
    difficultyButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setDifficulty(button.dataset.difficulty || "easy");
      });
    });
  }

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }
  if (backToGames) {
    backToGames.href = flow.buildGameHubUrl(sessionId);
  }
  if (startButtonEl) {
    startButtonEl.addEventListener("click", startGame);
  }

  initDifficulty();
  prepareRoundBoard();
  renderProgress();
  hydrate();
  setStartOverlayVisible(true);
  updateMeta();
  setStatus("請選擇難度，按開始後翻牌配對。");
})();
