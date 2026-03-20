(function () {
  const flow = window.GameFlow;
  if (!flow) {
    return;
  }
  if (!flow.ensureAuthenticated()) {
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
  const SYMBOL_POOL = [
    "🍊",
    "🍉",
    "🍓",
    "🍇",
    "🥝",
    "🍍",
    "🍒",
    "🍋",
    "🥭",
    "🍐",
    "🍎",
    "🍑",
    "🍈",
    "🫐",
  ];

  const DIFFICULTY_CONFIG = {
    easy: {
      label: "簡單",
      pairs: 8,
      columns: 4,
      scoreBase: 120,
      timePenalty: 2.2,
      mistakePenalty: 4.4,
    },
    medium: {
      label: "中等",
      pairs: 10,
      columns: 5,
      scoreBase: 132,
      timePenalty: 2,
      mistakePenalty: 4.9,
    },
    hard: {
      label: "困難",
      pairs: 12,
      columns: 6,
      scoreBase: 145,
      timePenalty: 1.8,
      mistakePenalty: 5.4,
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
      instructionEl.textContent = `請找出 ${config.pairs} 組相同圖片配對。`;
    }
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${requiredCount()}`;
    }
  }

  function setStartOverlayVisible(visible) {
    if (!startOverlayEl) {
      return;
    }
    startOverlayEl.classList.toggle("hidden", !visible);
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
      timerEl.textContent = "0.0";
      return;
    }
    const elapsed = (Date.now() - startAtMs) / 1000;
    timerEl.textContent = elapsed.toFixed(1);
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
    if (!boardEl) {
      return;
    }
    const config = getDifficultyConfig();
    boardEl.style.setProperty("--memory-columns", String(config.columns));
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
    if (!boardEl) {
      return null;
    }
    return boardEl.querySelector(`[data-index="${index}"]`);
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
      setStatus("四類能力遊戲已完成，將前往結果分析。");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1700);
      return;
    }
    setStatus("本遊戲已完成，將返回遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1700);
  }

  function finishGame() {
    const config = getDifficultyConfig();
    running = false;
    stopTimer();
    updateTimer();

    const elapsed = startAtMs ? (Date.now() - startAtMs) / 1000 : 0;
    const matchedPairs = Math.floor(matched.size / 2);
    const wrongAttempts = Math.max(0, moves - matchedPairs);
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          config.scoreBase -
            elapsed * config.timePenalty -
            wrongAttempts * config.mistakePenalty,
        ),
      ),
    );
    const endedAt = new Date();

    if (resultEl) {
      resultEl.textContent = `完成配對，用時 ${elapsed.toFixed(1)} 秒，翻牌 ${moves} 次，得分 ${score}。`;
    }

    onComplete({
      difficulty: selectedDifficulty,
      pairs_total: config.pairs,
      pairs_matched: matchedPairs,
      moves,
      score,
      duration_sec: Number(elapsed.toFixed(1)),
      completed_at: endedAt.toISOString(),
      details: {
        started_at: startedAtIso,
        ended_at: endedAt.toISOString(),
        columns: config.columns,
        wrong_attempts: wrongAttempts,
        attempts: [...attemptLog],
      },
    });
  }

  function onCardClick(index) {
    if (!running || lockInput || matched.has(index)) {
      return;
    }
    if (firstIndex === index) {
      return;
    }

    revealIndex(index, true);

    if (firstIndex === null) {
      firstIndex = index;
      setStatus("請選擇第二張牌。");
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
      setStatus("配對成功，請繼續。");
      if (matched.size === deck.length) {
        finishGame();
      }
      return;
    }

    setStatus("配對失敗，請再試一次。");
    window.setTimeout(() => {
      revealIndex(firstIndex, false);
      revealIndex(secondIndex, false);
      firstIndex = null;
      secondIndex = null;
      lockInput = false;
    }, 550);
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
      resultEl.textContent = "尚未開始。";
    }
    setStatus(`已切換為 ${getDifficultyConfig().label}，按下藍色三角形開始。`);
  }

  function startGame() {
    clearRedirect();
    running = true;
    prepareRoundBoard();
    startedAtIso = new Date().toISOString();
    startAtMs = Date.now();
    updateTimer();
    stopTimer();
    timerInterval = window.setInterval(updateTimer, 100);

    setStartOverlayVisible(false);
    renderDifficulty();
    setStatus("遊戲進行中，請找出所有配對。");
    if (resultEl) {
      resultEl.textContent = "遊戲進行中...";
    }
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.memory || !resultEl) {
      return;
    }
    const difficultyLabel =
      DIFFICULTY_CONFIG[entry.memory.difficulty || ""]?.label || "--";
    resultEl.textContent = `上次結果：難度 ${difficultyLabel}，配對 ${entry.memory.pairs_matched}/${entry.memory.pairs_total}，得分 ${entry.memory.score}。`;
  }

  function initDifficulty() {
    const stored = loadStoredDifficulty();
    if (stored && DIFFICULTY_CONFIG[stored]) {
      selectedDifficulty = stored;
    }
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
  setStatus("請先選擇難度，再按下藍色三角形開始。");
})();
