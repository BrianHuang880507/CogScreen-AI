(function () {
  const flow = window.GameFlow;
  if (!flow || !flow.ensureAuthenticated()) {
    return;
  }

  const sessionId = flow.resolveSessionId();
  const levels = Array.isArray(window.FOCUS_LEVELS) ? window.FOCUS_LEVELS : [];

  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const backToGames = document.getElementById("backToGames");
  const startButton = document.getElementById("focusStartButton");
  const startOverlayEl = document.getElementById("focusStartOverlay");
  const progressEl = document.getElementById("focusProgress");
  const hudFoundEl = document.getElementById("focusHudFound");
  const resultEl = document.getElementById("focusResult");
  const imageEl = document.getElementById("focusImage");
  const boardEl = document.getElementById("focusBoard");
  const markersEl = document.getElementById("focusMarkers");
  const clickFlashEl = document.getElementById("focusClickFlash");
  const difficultyButtons = Array.from(
    document.querySelectorAll("[data-focus-difficulty]"),
  );

  const difficultyOrder = ["easy", "medium", "hard"];
  const difficultyLabel = {
    easy: "簡單",
    medium: "一般",
    hard: "挑戰",
  };
  const FOCUS_TIME_TARGETS = {
    easy: { targetSec: 180, limitSec: 420 },
    medium: { targetSec: 240, limitSec: 540 },
    hard: { targetSec: 300, limitSec: 660 },
  };
  const fallbackImage = "/static/images/games/spot-the-diff/img_0001.jpg";

  let currentDifficulty = "easy";
  let currentLevel = null;
  let found = new Set();
  let active = false;
  let startAt = 0;
  let redirectTimer = null;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let clickLog = [];
  let startedAtIso = null;

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  function isPlayableLevel(level) {
    return Boolean(
      level &&
        level.enabled !== false &&
        level.image &&
        Array.isArray(level.differences) &&
        level.differences.length > 0,
    );
  }

  function getLevelByDifficulty(difficulty) {
    return levels.find((level) => level.difficulty === difficulty && isPlayableLevel(level)) || null;
  }

  function hasPlayableDifficulty(difficulty) {
    return levels.some((level) => level.difficulty === difficulty && isPlayableLevel(level));
  }

  function getTotalDiffCount() {
    return currentLevel && Array.isArray(currentLevel.differences)
      ? currentLevel.differences.length
      : 0;
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      const required = Array.isArray(flow.REQUIRED_CATEGORIES)
        ? flow.REQUIRED_CATEGORIES.length
        : flow.GAME_KEYS.length;
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${required}`;
    }
  }

  function renderFound() {
    const text = `已找到：${found.size} / ${getTotalDiffCount()}`;
    if (hudFoundEl) {
      hudFoundEl.textContent = text;
    }
    if (progressEl) {
      progressEl.textContent = text;
    }
  }

  function clearRedirect() {
    if (redirectTimer) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
    }
  }

  function setStartOverlayVisible(visible) {
    if (startOverlayEl) {
      startOverlayEl.classList.toggle("hidden", !visible);
    }
  }

  function onComplete(payload) {
    if (!sessionId) {
      return;
    }
    flow.saveSessionGameResult(sessionId, "focus", payload);
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
    setStatus("找不同完成，正在回到遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1800);
  }

  function clearMarkers() {
    if (markersEl) {
      markersEl.innerHTML = "";
    }
  }

  function recordClick(type, displayX, displayY, extra = {}) {
    clickLog.push({
      type,
      display_x: Number(displayX.toFixed(1)),
      display_y: Number(displayY.toFixed(1)),
      at: new Date().toISOString(),
      ...extra,
    });
  }

  function showFlash(displayX, displayY, type) {
    if (!clickFlashEl || !boardEl) {
      return;
    }
    clickFlashEl.classList.remove("is-hit", "is-miss", "is-invalid", "show");
    clickFlashEl.style.left = `${displayX}px`;
    clickFlashEl.style.top = `${displayY}px`;
    clickFlashEl.classList.add(`is-${type}`);
    void clickFlashEl.offsetWidth;
    clickFlashEl.classList.add("show");
  }

  function buildMarker(diff) {
    if (!naturalWidth || !naturalHeight) {
      return null;
    }
    const marker = document.createElement("span");
    marker.className = "focus-marker";
    marker.dataset.diffId = diff.id;

    if (diff.shape === "circle") {
      marker.classList.add("is-circle");
      marker.style.left = `${((diff.x - diff.r) / naturalWidth) * 100}%`;
      marker.style.top = `${((diff.y - diff.r) / naturalHeight) * 100}%`;
      marker.style.width = `${((diff.r * 2) / naturalWidth) * 100}%`;
      marker.style.height = `${((diff.r * 2) / naturalHeight) * 100}%`;
      return marker;
    }

    if (diff.shape === "rect") {
      marker.classList.add("is-rect");
      marker.style.left = `${(diff.x / naturalWidth) * 100}%`;
      marker.style.top = `${(diff.y / naturalHeight) * 100}%`;
      marker.style.width = `${(diff.w / naturalWidth) * 100}%`;
      marker.style.height = `${(diff.h / naturalHeight) * 100}%`;
      return marker;
    }

    return null;
  }

  function renderMarkers() {
    clearMarkers();
    if (!markersEl || !currentLevel) {
      return;
    }
    currentLevel.differences.forEach((diff) => {
      if (!found.has(diff.id)) {
        return;
      }
      const marker = buildMarker(diff);
      if (marker) {
        markersEl.appendChild(marker);
      }
    });
  }

  function setDifficultyButtonState() {
    difficultyButtons.forEach((button) => {
      const difficulty = button.dataset.focusDifficulty;
      const isCurrent = difficulty === currentDifficulty;
      const isAvailable = hasPlayableDifficulty(difficulty);
      button.classList.toggle("is-active", isCurrent);
      button.disabled = !isAvailable;
      button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    });
  }

  function selectDifficulty(difficulty) {
    const level = getLevelByDifficulty(difficulty);
    if (!level) {
      return;
    }
    clearRedirect();
    active = false;
    setStartOverlayVisible(true);
    found = new Set();
    clickLog = [];
    startedAtIso = null;
    currentDifficulty = difficulty;
    currentLevel = level;
    naturalWidth = 0;
    naturalHeight = 0;
    clearMarkers();
    setDifficultyButtonState();
    renderFound();

    if (resultEl) {
      resultEl.textContent = `已選擇 ${difficultyLabel[difficulty]}，按開始後找出右半邊不同處。`;
    }
    setStatus(`目前難度：${difficultyLabel[difficulty]}。`);

    if (imageEl) {
      imageEl.dataset.fallbackApplied = "false";
      imageEl.src = level.image;
      imageEl.alt = `找不同題目 ${level.id}`;
    }
  }

  function startGame() {
    if (!currentLevel) {
      setStatus("目前沒有可用題目。");
      return;
    }
    if (!isPlayableLevel(currentLevel)) {
      setStatus("這個難度暫時不能遊玩。");
      return;
    }
    clearRedirect();
    active = true;
    setStartOverlayVisible(false);
    startAt = performance.now();
    startedAtIso = new Date().toISOString();
    clickLog = [];
    found = new Set();
    clearMarkers();
    renderFound();
    if (resultEl) {
      resultEl.textContent = `請在右半邊圖片中找出 ${getTotalDiffCount()} 個差異。`;
    }
    setStatus("遊戲開始，慢慢觀察右半邊圖片。");
  }

  function calculateFocusScore(elapsedSec, difficulty) {
    const config = FOCUS_TIME_TARGETS[difficulty] || FOCUS_TIME_TARGETS.easy;
    const safeElapsed = Math.max(0, Number(elapsedSec) || 0);
    const overTarget = Math.max(0, safeElapsed - config.targetSec);
    const windowSec = Math.max(1, config.limitSec - config.targetSec);
    return Math.max(0, Math.round((1 - Math.min(overTarget / windowSec, 1)) * 100));
  }

  function finish() {
    active = false;
    setStartOverlayVisible(true);
    const elapsed = (performance.now() - startAt) / 1000;
    const total = getTotalDiffCount();
    const score = calculateFocusScore(elapsed, currentDifficulty);
    const endedAt = new Date();
    const timeConfig = FOCUS_TIME_TARGETS[currentDifficulty] || FOCUS_TIME_TARGETS.easy;
    const payload = {
      level_id: currentLevel ? currentLevel.id : null,
      difficulty: currentDifficulty,
      found: total,
      total,
      elapsed_sec: Number(elapsed.toFixed(1)),
      score,
      completed_at: endedAt.toISOString(),
      details: {
        started_at: startedAtIso,
        ended_at: endedAt.toISOString(),
        time_target_sec: timeConfig.targetSec,
        time_limit_sec: timeConfig.limitSec,
        total_clicks: clickLog.length,
        clicks: [...clickLog],
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "focus", payload);
    if (resultEl) {
      resultEl.textContent = `完成 ${difficultyLabel[currentDifficulty]}，用時 ${flow.formatDuration(elapsed)}，原遊戲分數 ${score}，本次獲得 ${pointAward.points} 點。`;
    }
    onComplete(payload);
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.focus || !resultEl) {
      return;
    }
    const difficulty = entry.focus.difficulty
      ? `（${difficultyLabel[entry.focus.difficulty] || entry.focus.difficulty}）`
      : "";
    resultEl.textContent = `上次結果${difficulty}：用時 ${flow.formatDuration(entry.focus.elapsed_sec)}，原遊戲分數 ${entry.focus.score}。`;
  }

  function detectHit(x, y) {
    if (!currentLevel) {
      return null;
    }
    for (const diff of currentLevel.differences) {
      if (found.has(diff.id)) {
        continue;
      }
      if (diff.shape === "circle") {
        const dx = x - diff.x;
        const dy = y - diff.y;
        if (dx * dx + dy * dy <= diff.r * diff.r) {
          return diff;
        }
      }
      if (diff.shape === "rect") {
        if (x >= diff.x && x <= diff.x + diff.w && y >= diff.y && y <= diff.y + diff.h) {
          return diff;
        }
      }
    }
    return null;
  }

  function handleBoardClick(event) {
    if (!imageEl || !currentLevel || !naturalWidth || !naturalHeight) {
      return;
    }
    const rect = imageEl.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    if (displayX < 0 || displayY < 0 || displayX > rect.width || displayY > rect.height) {
      return;
    }

    if (!active) {
      recordClick("invalid_not_started", displayX, displayY);
      showFlash(displayX, displayY, "invalid");
      setStatus("請先按開始。");
      return;
    }

    const x = (displayX / rect.width) * naturalWidth;
    const y = (displayY / rect.height) * naturalHeight;
    if (x < naturalWidth / 2) {
      recordClick("invalid_left", displayX, displayY, {
        image_x: Number(x.toFixed(1)),
        image_y: Number(y.toFixed(1)),
      });
      showFlash(displayX, displayY, "invalid");
      setStatus("請點右半邊圖片中的不同處。");
      return;
    }

    const hit = detectHit(x, y);
    if (!hit) {
      recordClick("miss", displayX, displayY, {
        image_x: Number(x.toFixed(1)),
        image_y: Number(y.toFixed(1)),
      });
      showFlash(displayX, displayY, "miss");
      setStatus("這裡不是差異點，請再慢慢看。");
      return;
    }

    recordClick("hit", displayX, displayY, {
      image_x: Number(x.toFixed(1)),
      image_y: Number(y.toFixed(1)),
      diff_id: hit.id,
    });
    found.add(hit.id);
    renderFound();
    renderMarkers();
    showFlash(displayX, displayY, "hit");
    setStatus("找到了，繼續找下一個差異。");
    if (found.size >= getTotalDiffCount()) {
      finish();
    }
  }

  function pickDefaultDifficulty() {
    return difficultyOrder.find((difficulty) => hasPlayableDifficulty(difficulty)) || null;
  }

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }
  if (backToGames) {
    backToGames.href = flow.buildGameHubUrl(sessionId);
  }
  if (!sessionId) {
    setStatus("缺少 Session ID，請回到遊戲選單重新進入。");
  }
  if (!levels.length) {
    setStatus("沒有載入找不同題目。");
  }

  renderProgress();
  hydrate();

  if (startButton) {
    startButton.addEventListener("click", startGame);
  }

  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextDifficulty = button.dataset.focusDifficulty;
      if (!nextDifficulty || nextDifficulty === currentDifficulty || button.disabled) {
        return;
      }
      selectDifficulty(nextDifficulty);
    });
  });

  if (imageEl) {
    imageEl.addEventListener("load", () => {
      naturalWidth = imageEl.naturalWidth || 0;
      naturalHeight = imageEl.naturalHeight || 0;
      renderMarkers();
    });

    imageEl.addEventListener("error", () => {
      if (imageEl.dataset.fallbackApplied === "true") {
        return;
      }
      imageEl.dataset.fallbackApplied = "true";
      imageEl.src = fallbackImage;
      setStatus("題目圖片載入失敗，已改用備用圖片。");
    });

    imageEl.addEventListener("click", handleBoardClick);
  }

  const defaultDifficulty = hasPlayableDifficulty("easy") ? "easy" : pickDefaultDifficulty();
  if (defaultDifficulty) {
    selectDifficulty(defaultDifficulty);
    setStatus("請選擇難度，按開始後找不同。");
  } else {
    currentLevel = null;
    setDifficultyButtonState();
    renderFound();
    setStatus("目前沒有可用的找不同題目。");
  }
})();
