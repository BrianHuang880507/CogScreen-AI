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

  // Completion-time scoring is tuned in minutes, not short seconds.
  const DIFFICULTY_CONFIG = {
    easy: {
      label: "簡單",
      totalNumbers: 9,
      columns: 3,
      timeTargetSec: 90,
      timeLimitSec: 240,
      errorPenalty: 4,
    },
    medium: {
      label: "一般",
      totalNumbers: 12,
      columns: 4,
      timeTargetSec: 150,
      timeLimitSec: 360,
      errorPenalty: 5,
    },
    hard: {
      label: "挑戰",
      totalNumbers: 16,
      columns: 4,
      timeTargetSec: 210,
      timeLimitSec: 480,
      errorPenalty: 6,
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
    return Array.from({ length: totalNumbers }, (_, index) => String(index + 1)).join("、");
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

  function buildNumbers(totalNumbers) {
    return Array.from({ length: totalNumbers }, (_, index) => index + 1);
  }

  function updateMeta() {
    const config = getDifficultyConfig();
    if (nextEl) {
      nextEl.textContent = nextNumber <= config.totalNumbers ? String(nextNumber) : "完成";
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
      timerEl.textContent = "00:00";
      return;
    }
    timerEl.textContent = flow.formatDuration((Date.now() - startAtMs) / 1000);
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
      }, 420);
    }
  }

  function applyBoardLayout() {
    if (boardEl) {
      boardEl.style.setProperty("--sequence-columns", String(getDifficultyConfig().columns));
    }
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

  function calculateSequenceScore(elapsedSec, errorCount, config) {
    const safeElapsed = Math.max(0, Number(elapsedSec) || 0);
    const target = Math.max(1, Number(config.timeTargetSec) || 1);
    const limit = Math.max(target + 1, Number(config.timeLimitSec) || target + 1);
    const overTarget = Math.max(0, safeElapsed - target);
    const timeScore = Math.round((1 - Math.min(overTarget / (limit - target), 1)) * 100);
    return Math.max(0, Math.min(100, timeScore - errorCount * config.errorPenalty));
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
      setStatus("四類遊戲都完成了，正在前往結果分析。");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1800);
      return;
    }
    setStatus("數字順序完成，正在回到遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1800);
  }

  function finishGame() {
    const config = getDifficultyConfig();
    running = false;
    stopTimer();
    updateTimer();

    const elapsed = startAtMs ? (Date.now() - startAtMs) / 1000 : 0;
    const score = calculateSequenceScore(elapsed, errors, config);
    const endedAt = new Date();
    const payload = {
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
        time_target_sec: config.timeTargetSec,
        time_limit_sec: config.timeLimitSec,
        click_log: [...clickLog],
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "sequence", payload);

    if (resultEl) {
      resultEl.textContent = `完成數字順序，用時 ${flow.formatDuration(elapsed)}，誤點 ${errors} 次，原遊戲分數 ${score}，本次獲得 ${pointAward.points} 點。`;
    }

    onComplete(payload);
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
        setStatus(`很好，下一個請點 ${nextNumber}。`);
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
    setStatus(`請先找 ${nextNumber}，慢慢來沒有關係。`);
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
      resultEl.textContent = "按開始後，依照數字順序點擊。";
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
    setStatus("請從 1 開始，依序點到最後一個數字。");
    if (resultEl) {
      resultEl.textContent = "遊戲進行中。";
    }
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.sequence || !resultEl) {
      return;
    }
    const difficultyLabel = DIFFICULTY_CONFIG[entry.sequence.difficulty || ""]?.label || "--";
    resultEl.textContent = `上次結果：${difficultyLabel}，誤點 ${entry.sequence.errors} 次，原遊戲分數 ${entry.sequence.score}。`;
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
  setStatus("請選擇難度，按開始後依序點擊數字。");
})();
