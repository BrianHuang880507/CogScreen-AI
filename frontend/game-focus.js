(function () {
  const flow = window.GameFlow;
  if (!flow) {
    return;
  }
  if (!flow.ensureAuthenticated()) {
    return;
  }

  const sessionId = flow.resolveSessionId();
  const levels = Array.isArray(window.FOCUS_LEVELS) ? window.FOCUS_LEVELS : [];

  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const backToGames = document.getElementById("backToGames");
  const startButton = document.getElementById("focusStartButton");
  const progressEl = document.getElementById("focusProgress");
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
    medium: "中等",
    hard: "困難",
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

  function setStatus(text) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text;
  }

  function isPlayableLevel(level) {
    if (!level) {
      return false;
    }
    if (level.enabled === false) {
      return false;
    }
    if (!level.image) {
      return false;
    }
    return Array.isArray(level.differences) && level.differences.length > 0;
  }

  function getLevelByDifficulty(difficulty) {
    return (
      levels.find(
        (level) => level.difficulty === difficulty && isPlayableLevel(level),
      ) || null
    );
  }

  function hasPlayableDifficulty(difficulty) {
    return levels.some(
      (level) => level.difficulty === difficulty && isPlayableLevel(level),
    );
  }

  function getTotalDiffCount() {
    if (!currentLevel || !Array.isArray(currentLevel.differences)) {
      return 0;
    }
    return currentLevel.differences.length;
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${flow.GAME_KEYS.length}`;
    }
  }

  function renderFound() {
    if (!progressEl) {
      return;
    }
    progressEl.textContent = `已找到 ${found.size} / ${getTotalDiffCount()}。`;
  }

  function clearRedirect() {
    if (redirectTimer) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
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
      setStatus("三個遊戲已完成，將前往結果分析。");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1500);
      return;
    }
    setStatus("本遊戲已完成，將返回遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1500);
  }

  function clearMarkers() {
    if (!markersEl) {
      return;
    }
    markersEl.innerHTML = "";
  }

  function showFlash(displayX, displayY, type) {
    if (!clickFlashEl || !boardEl) {
      return;
    }
    clickFlashEl.classList.remove("is-hit", "is-miss", "is-invalid", "show");
    clickFlashEl.style.left = `${displayX}px`;
    clickFlashEl.style.top = `${displayY}px`;
    clickFlashEl.classList.add(`is-${type}`);
    // Force restart animation for repeated clicks.
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
    found = new Set();
    currentDifficulty = difficulty;
    currentLevel = level;
    naturalWidth = 0;
    naturalHeight = 0;
    clearMarkers();
    setDifficultyButtonState();
    renderFound();

    if (resultEl) {
      resultEl.textContent = `已選擇「${difficultyLabel[difficulty]}」難度，按「開始找不同」後作答。`;
    }
    setStatus(`已載入 ${difficultyLabel[difficulty]} 題目。`);

    if (imageEl) {
      imageEl.dataset.fallbackApplied = "false";
      imageEl.src = level.image;
      imageEl.alt = `找不同題目：${level.id}`;
    }
  }

  function startGame() {
    if (!currentLevel) {
      setStatus("目前沒有可用題目。");
      return;
    }
    if (!isPlayableLevel(currentLevel)) {
      setStatus("此難度尚未開放。");
      return;
    }
    clearRedirect();
    active = true;
    startAt = performance.now();
    found = new Set();
    clearMarkers();
    renderFound();
    if (resultEl) {
      resultEl.textContent = `請在右半邊圖片中找出 ${getTotalDiffCount()} 個不同處。`;
    }
    setStatus("遊戲進行中。");
  }

  function finish() {
    active = false;
    const elapsed = (performance.now() - startAt) / 1000;
    const total = getTotalDiffCount();
    const score = Math.max(0, Math.round(140 - elapsed * 8));
    if (resultEl) {
      resultEl.textContent = `完成 ${difficultyLabel[currentDifficulty]} 難度，用時 ${elapsed.toFixed(1)} 秒，得分 ${score} 分。`;
    }
    onComplete({
      level_id: currentLevel ? currentLevel.id : null,
      difficulty: currentDifficulty,
      found: total,
      total,
      elapsed_sec: Number(elapsed.toFixed(1)),
      score,
      completed_at: new Date().toISOString(),
    });
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.focus || !resultEl) {
      return;
    }
    const difficulty = entry.focus.difficulty
      ? ` (${difficultyLabel[entry.focus.difficulty] || entry.focus.difficulty})`
      : "";
    resultEl.textContent = `上次結果${difficulty}：用時 ${entry.focus.elapsed_sec} 秒，得分 ${entry.focus.score} 分。`;
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
        if (
          x >= diff.x &&
          x <= diff.x + diff.w &&
          y >= diff.y &&
          y <= diff.y + diff.h
        ) {
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
    if (
      displayX < 0 ||
      displayY < 0 ||
      displayX > rect.width ||
      displayY > rect.height
    ) {
      return;
    }

    if (!active) {
      showFlash(displayX, displayY, "invalid");
      setStatus("請先按「開始找不同」。");
      return;
    }

    const x = (displayX / rect.width) * naturalWidth;
    const y = (displayY / rect.height) * naturalHeight;
    if (x < naturalWidth / 2) {
      showFlash(displayX, displayY, "invalid");
      setStatus("請點擊右半邊圖片。");
      return;
    }

    const hit = detectHit(x, y);
    if (!hit) {
      showFlash(displayX, displayY, "miss");
      return;
    }

    found.add(hit.id);
    renderFound();
    renderMarkers();
    showFlash(displayX, displayY, "hit");
    if (found.size >= getTotalDiffCount()) {
      finish();
    }
  }

  function pickDefaultDifficulty() {
    const best = difficultyOrder.find((difficulty) =>
      hasPlayableDifficulty(difficulty),
    );
    return best || null;
  }

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }
  if (backToGames) {
    backToGames.href = flow.buildGameHubUrl(sessionId);
  }

  if (!sessionId) {
    setStatus("找不到 Session ID，請回測試流程。");
  }
  if (!levels.length) {
    setStatus("找不同題庫未載入。");
  }

  renderProgress();
  hydrate();

  if (startButton) {
    startButton.addEventListener("click", startGame);
  }

  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextDifficulty = button.dataset.focusDifficulty;
      if (
        !nextDifficulty ||
        nextDifficulty === currentDifficulty ||
        button.disabled
      ) {
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
      setStatus("題目圖片載入失敗，已改用預設備援圖。");
    });

    imageEl.addEventListener("click", handleBoardClick);
  }

  const defaultDifficulty = pickDefaultDifficulty();
  if (defaultDifficulty) {
    selectDifficulty(defaultDifficulty);
  } else {
    currentLevel = null;
    setDifficultyButtonState();
    renderFound();
    setStatus("目前沒有可用題目。");
  }
})();
