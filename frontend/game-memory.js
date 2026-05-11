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
  const memoryImage = (path) => `/static/images/games/classify/${path}`;
  const CARD_POOL = [
    { id: "fruit-kiwi", label: "奇異果", image: memoryImage("medium/food_0009.png") },
    { id: "fruit-green-apple", label: "青蘋果", image: memoryImage("medium/food_0010.png") },
    { id: "fruit-banana", label: "香蕉", image: memoryImage("medium/food_0012.png") },
    { id: "fruit-pear", label: "梨子", image: memoryImage("medium/food_0027.png") },
    { id: "fruit-pineapple", label: "鳳梨", image: memoryImage("medium/food_0028.png") },
    { id: "fruit-grapes", label: "葡萄", image: memoryImage("medium/food_0031.png") },
    { id: "fruit-mango", label: "芒果", image: memoryImage("medium/food_0032.png") },
    { id: "fruit-strawberry", label: "草莓", image: memoryImage("medium/food_0033.png") },
    { id: "fruit-lemon", label: "檸檬", image: memoryImage("medium/food_0034.png") },
    { id: "fruit-peach", label: "水蜜桃", image: memoryImage("medium/food_0035.png") },
    { id: "fruit-red-apple", label: "紅蘋果", image: memoryImage("medium/food_0051.png") },
    { id: "fruit-watermelon", label: "西瓜", image: memoryImage("medium/food_0052.png") },
    { id: "fruit-blueberry", label: "藍莓", image: memoryImage("medium/food_0053.png") },
    { id: "fruit-cherry", label: "櫻桃", image: memoryImage("medium/food_0054.png") },
    { id: "fruit-orange", label: "橘子", image: memoryImage("medium/food_0057.png") },
    { id: "fruit-avocado", label: "酪梨", image: memoryImage("medium/food_0077.png") },
  ];

  // Scores prioritize completion accuracy; duration is recorded separately.
  const DIFFICULTY_CONFIG = {
    easy: {
      label: "簡單",
      pairs: 4,
      columns: 4,
      wrongAttemptPenalty: 10,
    },
    medium: {
      label: "一般",
      pairs: 8,
      columns: 4,
      wrongAttemptPenalty: 8,
    },
    hard: {
      label: "挑戰",
      pairs: 10,
      columns: 5,
      wrongAttemptPenalty: 6,
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
    const chosen = shuffle(CARD_POOL).slice(0, config.pairs);
    deck = shuffle(
      chosen.flatMap((card, pairId) => [
        { pairId, ...card },
        { pairId, ...card },
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
      const image = document.createElement("img");
      image.className = "memory-card-image";
      image.src = card.image;
      image.alt = card.label;
      image.loading = "eager";
      image.decoding = "async";
      image.addEventListener("error", () => {
        image.remove();
        back.textContent = card.label;
        back.classList.add("memory-card-back-fallback");
      });
      back.appendChild(image);

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

  function calculateMemoryScore(wrongAttempts, movesCount, pairsTotal, config) {
    const safePairs = Math.max(1, Number(pairsTotal) || 1);
    const safeMoves = Math.max(1, Number(movesCount) || 1);
    const safeWrongAttempts = Math.max(0, Number(wrongAttempts) || 0);
    const wrongAttemptPenalty = Math.max(1, Number(config.wrongAttemptPenalty) || 8);
    const movesPerPair = safeMoves / safePairs;
    const accuracyRate = Math.round((safePairs / safeMoves) * 100);
    const score = Math.max(0, Math.min(100, 100 - safeWrongAttempts * wrongAttemptPenalty));
    return {
      score,
      accuracyRate: Math.max(0, Math.min(100, accuracyRate)),
      wrongAttemptPenalty,
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
    const scoreResult = calculateMemoryScore(wrongAttempts, moves, config.pairs, config);
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
        scoring_version: "v4_accuracy_completion_no_time_penalty",
        scoring_basis: "wrong_attempts_only",
        wrong_attempt_penalty: scoreResult.wrongAttemptPenalty,
        accuracy_rate: scoreResult.accuracyRate,
        moves_per_pair: scoreResult.movesPerPair,
        attempts: [...attemptLog],
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "memory", payload);

    if (resultEl) {
      resultEl.textContent = `完成配對，錯誤配對 ${wrongAttempts} 次，嘗試 ${moves} 次，原遊戲分數 ${scoreResult.score}，本次獲得 ${pointAward.points} 點。`;
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
      first_symbol: first ? first.label : null,
      second_symbol: second ? second.label : null,
      first_image: first ? first.image : null,
      second_image: second ? second.image : null,
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
    setStatus(`已選擇 ${getDifficultyConfig().label}，按開始後開始遊戲。`);
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
    const wrongAttempts = Number(entry.memory.details?.wrong_attempts);
    const wrongText = Number.isFinite(wrongAttempts) ? `，錯誤配對 ${wrongAttempts} 次` : "";
    resultEl.textContent = `上次結果：${difficultyLabel}，完成 ${entry.memory.pairs_matched}/${entry.memory.pairs_total} 組${wrongText}，原遊戲分數 ${entry.memory.score}。`;
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
