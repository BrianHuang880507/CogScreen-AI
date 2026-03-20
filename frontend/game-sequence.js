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
  const boardEl = document.getElementById("sequenceBoard");
  const rangeEl = document.getElementById("sequenceRange");
  const nextEl = document.getElementById("sequenceNext");
  const clicksEl = document.getElementById("sequenceClicks");
  const errorsEl = document.getElementById("sequenceErrors");
  const timerEl = document.getElementById("sequenceTimer");
  const resultEl = document.getElementById("sequenceResult");
  const startOverlayEl = document.getElementById("sequenceStartOverlay");
  const startButtonEl = document.getElementById("sequenceStartButton");
  const difficultyButtons = Array.from(
    document.querySelectorAll(".difficulty-button[data-difficulty]"),
  );

  const DIFFICULTY_STORAGE_KEY = "sequenceDifficulty";
  const DIFFICULTY_CONFIG = {
    easy: {
      label: "簡單",
      totalNumbers: 9,
      columns: 3,
      scoreBase: 120,
      timePenalty: 2.5,
      errorPenalty: 5,
    },
    medium: {
      label: "中等",
      totalNumbers: 12,
      columns: 4,
      scoreBase: 132,
      timePenalty: 2.25,
      errorPenalty: 5.4,
    },
    hard: {
      label: "困難",
      totalNumbers: 16,
      columns: 4,
      scoreBase: 145,
      timePenalty: 2,
      errorPenalty: 5.9,
    },
  };

  let selectedDifficulty = "easy";
  let redirectTimer = null;
  let timerInterval = null;
  let running = false;
  let order = [];
  let nextNumber = 1;
  let clicks = 0;
  let errors = 0;
  let startAtMs = 0;
  let startedAtIso = null;
  let clickLog = [];

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

  function rangeText(totalNumbers) {
    return Array.from({ length: totalNumbers }, (_, index) => String(index + 1)).join(" → ");
  }

  function renderDifficulty() {
    const config = getDifficultyConfig();
    difficultyButtons.forEach((button) => {
      const isActive = button.dataset.difficulty === selectedDifficulty;
      button.classList.toggle("is-active", isActive);
      button.disabled = running;
    });
    if (rangeEl) {
      rangeEl.textContent = rangeText(config.totalNumbers);
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

  function buildNumbers(totalNumbers) {
    return Array.from({ length: totalNumbers }, (_, index) => index + 1);
  }

  function updateMeta() {
    const config = getDifficultyConfig();
    if (nextEl) {
      nextEl.textContent =
        nextNumber <= config.totalNumbers ? String(nextNumber) : "完成";
    }
    if (clicksEl) {
      clicksEl.textContent = String(clicks);
    }
    if (errorsEl) {
      errorsEl.textContent = String(errors);
    }
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

  function paintTileState(value, state) {
    if (!boardEl) {
      return;
    }
    const button = boardEl.querySelector(`[data-value="${value}"]`);
    if (!button) {
      return;
    }
    button.classList.remove("is-correct", "is-wrong");
    if (state === "correct") {
      button.classList.add("is-correct");
      button.disabled = true;
    }
    if (state === "wrong") {
      button.classList.add("is-wrong");
      window.setTimeout(() => {
        button.classList.remove("is-wrong");
      }, 240);
    }
  }

  function applyBoardLayout() {
    if (!boardEl) {
      return;
    }
    const config = getDifficultyConfig();
    boardEl.style.setProperty("--sequence-columns", String(config.columns));
  }

  function renderBoard() {
    if (!boardEl) {
      return;
    }
    boardEl.innerHTML = "";
    order.forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sequence-tile";
      button.dataset.value = String(value);
      button.textContent = String(value);
      button.addEventListener("click", () => onTileClick(value));
      boardEl.appendChild(button);
    });
  }

  function prepareRoundBoard() {
    const config = getDifficultyConfig();
    nextNumber = 1;
    clicks = 0;
    errors = 0;
    clickLog = [];
    startAtMs = 0;
    startedAtIso = null;
    order = shuffle(buildNumbers(config.totalNumbers));
    applyBoardLayout();
    renderBoard();
    updateMeta();
    updateTimer();
  }

  function stopTimer() {
    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function onComplete(payload) {
    if (!sessionId) {
      return;
    }
    flow.saveSessionGameResult(sessionId, "sequence", payload);
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
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          config.scoreBase -
            elapsed * config.timePenalty -
            errors * config.errorPenalty,
        ),
      ),
    );
    const endedAt = new Date();

    if (resultEl) {
      resultEl.textContent = `完成順序點擊，用時 ${elapsed.toFixed(1)} 秒，錯誤 ${errors} 次，得分 ${score}。`;
    }

    onComplete({
      difficulty: selectedDifficulty,
      total_numbers: config.totalNumbers,
      completed_count: config.totalNumbers,
      clicks,
      errors,
      score,
      duration_sec: Number(elapsed.toFixed(1)),
      completed_at: endedAt.toISOString(),
      details: {
        started_at: startedAtIso,
        ended_at: endedAt.toISOString(),
        columns: config.columns,
        click_log: [...clickLog],
      },
    });
  }

  function onTileClick(value) {
    if (!running) {
      return;
    }

    const config = getDifficultyConfig();
    clicks += 1;

    if (value === nextNumber) {
      clickLog.push({
        at: new Date().toISOString(),
        value,
        expected: nextNumber,
        is_correct: true,
      });
      paintTileState(value, "correct");
      nextNumber += 1;
      updateMeta();
      if (nextNumber > config.totalNumbers) {
        finishGame();
      } else {
        setStatus(`正確，下一個是 ${nextNumber}。`);
      }
      return;
    }

    errors += 1;
    clickLog.push({
      at: new Date().toISOString(),
      value,
      expected: nextNumber,
      is_correct: false,
    });
    paintTileState(value, "wrong");
    updateMeta();
    setStatus(`錯誤，請點 ${nextNumber}。`);
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
    setStatus("遊戲進行中，請依序點擊。");
    if (resultEl) {
      resultEl.textContent = "遊戲進行中...";
    }
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.sequence || !resultEl) {
      return;
    }
    const difficultyLabel =
      DIFFICULTY_CONFIG[entry.sequence.difficulty || ""]?.label || "--";
    resultEl.textContent = `上次結果：難度 ${difficultyLabel}，錯誤 ${entry.sequence.errors} 次，得分 ${entry.sequence.score}。`;
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
