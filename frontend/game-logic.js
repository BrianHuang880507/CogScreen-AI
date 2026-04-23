(function () {
  const flow = window.GameFlow;
  if (!flow || !flow.ensureAuthenticated()) {
    return;
  }

  const LEVELS = window.CLASSIFICATION_LEVELS || {};
  const LEVEL_ORDER = ["easy", "medium", "hard"];
  const DIFFICULTY_STORAGE_KEY = "logicDifficulty";
  const ITEMS_PER_CATEGORY = 4;
  const DIFFICULTY_LABELS = {
    easy: "簡單",
    medium: "一般",
    hard: "挑戰",
  };

  const sessionId = flow.resolveSessionId();
  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const backToGames = document.getElementById("backToGames");
  const logicResetButton = document.getElementById("logicResetButton");
  const logicResultEl = document.getElementById("logicResult");
  const logicFeedbackEl = document.getElementById("logicFeedback");
  const logicProgressMetaEl = document.getElementById("logicProgressMeta");
  const levelTitleEl = document.getElementById("classificationLevelTitle");
  const levelDescriptionEl = document.getElementById("classificationLevelDescription");
  const difficultyPickerEl = document.getElementById("classificationDifficultyPicker");
  const itemPoolEl = document.getElementById("classificationItemPool");
  const zoneGridEl = document.getElementById("classificationZoneGrid");
  const logicStartOverlayEl = document.getElementById("logicStartOverlay");
  const logicStartButtonEl = document.getElementById("logicStartButton");

  let redirectTimer = null;
  let currentDifficulty = null;
  let currentLevel = null;
  let selectedItemId = null;
  let completed = false;
  let roundStarted = false;
  let placedItemIds = new Set();
  let itemMap = new Map();
  let itemNodes = new Map();
  let zoneBodyMap = new Map();
  let attemptLog = [];
  let roundStartedAt = 0;

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  function setFeedback(message, tone) {
    if (!logicFeedbackEl) {
      return;
    }
    logicFeedbackEl.textContent = message || "";
    logicFeedbackEl.classList.remove("is-info", "is-success", "is-error");
    if (tone) {
      logicFeedbackEl.classList.add(`is-${tone}`);
    }
  }

  function clearRedirect() {
    if (redirectTimer) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
    }
  }

  function requiredCount() {
    return Array.isArray(flow.REQUIRED_CATEGORIES)
      ? flow.REQUIRED_CATEGORIES.length
      : flow.GAME_KEYS.length;
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${requiredCount()}`;
    }
  }

  function onComplete(payload) {
    if (!sessionId) {
      return;
    }
    flow.saveSessionGameResult(sessionId, "logic", payload);
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
    setStatus("分類遊戲完成，正在回到遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1800);
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

  function levelExists(key) {
    return Boolean(LEVELS[key] && Array.isArray(LEVELS[key].items) && LEVELS[key].items.length);
  }

  function findFirstAvailableDifficulty() {
    return LEVEL_ORDER.find((key) => levelExists(key)) || null;
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

  function pickRoundItems(sourceLevel) {
    const picked = [];
    sourceLevel.categories.forEach((category) => {
      const candidates = sourceLevel.items.filter((item) => item.category === category);
      picked.push(...shuffle(candidates).slice(0, ITEMS_PER_CATEGORY).map((item) => ({ ...item })));
    });
    return shuffle(picked.length ? picked : sourceLevel.items.map((item) => ({ ...item })));
  }

  function buildItemMap(level) {
    itemMap = new Map();
    level.items.forEach((item) => {
      itemMap.set(item.id, item);
    });
  }

  function getItemById(itemId) {
    return itemMap.get(itemId) || null;
  }

  function clearSelection() {
    if (!selectedItemId) {
      return;
    }
    const node = itemNodes.get(selectedItemId);
    if (node) {
      node.classList.remove("is-selected");
    }
    selectedItemId = null;
  }

  function markValidTargetZone(expectedCategory) {
    if (!zoneGridEl) {
      return;
    }
    Array.from(zoneGridEl.querySelectorAll(".classification-zone")).forEach((zone) => {
      zone.classList.toggle("is-valid-target", Boolean(expectedCategory && zone.dataset.category === expectedCategory));
    });
  }

  function updateProgressMeta() {
    if (!currentLevel) {
      return 0;
    }
    const total = currentLevel.items.length;
    const completedCount = placedItemIds.size;
    const score = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    if (logicProgressMetaEl) {
      logicProgressMetaEl.textContent = `完成：${completedCount} / ${total}`;
    }
    return score;
  }

  function finishGame(score) {
    if (!currentLevel || completed) {
      return;
    }
    completed = true;
    const total = currentLevel.items.length;
    const endedAt = new Date();
    const durationSec = roundStartedAt
      ? Number(((endedAt.getTime() - roundStartedAt) / 1000).toFixed(1))
      : null;
    const payload = {
      difficulty: currentDifficulty,
      level_title: currentLevel.title,
      correct: total,
      total,
      score,
      completed_at: endedAt.toISOString(),
      details: {
        presented_categories: [...currentLevel.categories],
        presented_items: currentLevel.items.map((item) => ({
          id: item.id,
          label: item.label,
          category: item.category,
          image: item.image,
        })),
        attempts: [...attemptLog],
        total_attempts: attemptLog.length,
        wrong_attempts: attemptLog.filter((entry) => !entry.is_correct).length,
        started_at: roundStartedAt ? new Date(roundStartedAt).toISOString() : null,
        ended_at: endedAt.toISOString(),
        duration_sec: durationSec,
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "logic", payload);
    if (logicResultEl) {
      logicResultEl.textContent = `完成「${currentLevel.title}」，全部 ${total} 個都已放對，原遊戲分數 ${score}，本次獲得 ${pointAward.points} 點。`;
    }
    setFeedback("分類完成。", "success");
    onComplete(payload);
  }

  function tryPlaceItem(itemId, targetCategory) {
    if (completed || !roundStarted) {
      setStatus("請先按開始。");
      return;
    }
    const item = getItemById(itemId);
    const node = itemNodes.get(itemId);
    if (!item || !node || node.classList.contains("is-locked")) {
      return;
    }

    const isCorrect = item.category === targetCategory;
    attemptLog.push({
      item_id: item.id,
      item_label: item.label,
      expected_category: item.category,
      target_category: targetCategory,
      is_correct: isCorrect,
      at: new Date().toISOString(),
    });

    if (!isCorrect) {
      clearSelection();
      markValidTargetZone(null);
      setFeedback(`再想一下，「${item.label}」不屬於「${targetCategory}」。`, "error");
      setStatus("放錯了，物件會留在待分類區，可以再試一次。");
      return;
    }

    const zoneBody = zoneBodyMap.get(targetCategory);
    if (!zoneBody) {
      return;
    }
    zoneBody.appendChild(node);
    node.classList.add("is-locked");
    node.classList.remove("is-selected", "is-dragging");
    node.draggable = false;
    node.setAttribute("aria-disabled", "true");
    placedItemIds.add(itemId);
    clearSelection();
    markValidTargetZone(null);
    const score = updateProgressMeta();
    setFeedback(`放對了：「${item.label}」屬於「${targetCategory}」。`, "success");
    setStatus("很好，請繼續分類下一個。");
    if (logicResultEl && placedItemIds.size < currentLevel.items.length) {
      logicResultEl.textContent = `目前已完成 ${placedItemIds.size}/${currentLevel.items.length}。`;
    }
    if (placedItemIds.size === currentLevel.items.length) {
      finishGame(score);
    }
  }

  function handleItemClick(itemId) {
    if (completed) {
      return;
    }
    if (!roundStarted) {
      setStatus("請先按開始。");
      return;
    }
    const item = getItemById(itemId);
    const node = itemNodes.get(itemId);
    if (!item || !node || node.classList.contains("is-locked")) {
      return;
    }
    if (selectedItemId === itemId) {
      clearSelection();
      markValidTargetZone(null);
      setFeedback("已取消選取。", "info");
      return;
    }
    clearSelection();
    selectedItemId = itemId;
    node.classList.add("is-selected");
    markValidTargetZone(item.category);
    setFeedback(`已選取「${item.label}」，請點選它應該放入的分類。`, "info");
  }

  function createItemNode(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "classification-item";
    button.draggable = true;
    button.dataset.itemId = item.id;
    button.dataset.category = item.category;
    button.title = `${item.label}，${item.category}`;
    button.setAttribute("aria-label", item.label);

    const mediaWrap = document.createElement("span");
    mediaWrap.className = "classification-item-media";

    const image = document.createElement("img");
    image.className = "classification-item-image";
    image.src = item.image;
    image.alt = item.label;
    image.loading = "lazy";
    mediaWrap.appendChild(image);

    const fallback = document.createElement("span");
    fallback.className = "classification-item-fallback";
    fallback.hidden = true;
    fallback.textContent = item.label.slice(0, 2);
    mediaWrap.appendChild(fallback);

    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
      button.classList.add("is-image-missing");
    });

    button.appendChild(mediaWrap);
    button.addEventListener("click", () => handleItemClick(item.id));
    button.addEventListener("dragstart", (event) => {
      if (!roundStarted) {
        event.preventDefault();
        setStatus("請先按開始。");
        return;
      }
      event.dataTransfer.setData("text/plain", item.id);
      button.classList.add("is-dragging");
      markValidTargetZone(item.category);
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      markValidTargetZone(null);
    });
    return button;
  }

  function createZoneNode(category) {
    const zone = document.createElement("section");
    zone.className = "classification-zone";
    zone.dataset.category = category;

    const labelCard = document.createElement("h3");
    labelCard.className = "classification-zone-label";
    labelCard.textContent = category;

    const body = document.createElement("div");
    body.className = "classification-zone-body";

    zone.appendChild(labelCard);
    zone.appendChild(body);

    zone.addEventListener("click", () => {
      if (selectedItemId) {
        tryPlaceItem(selectedItemId, category);
      }
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-drop-hover");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("is-drop-hover", "is-drop-valid", "is-drop-invalid");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-drop-hover", "is-drop-valid", "is-drop-invalid");
      const itemId = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
      if (itemId) {
        tryPlaceItem(itemId, category);
      }
    });

    zoneBodyMap.set(category, body);
    return zone;
  }

  function renderDifficultyPicker() {
    if (!difficultyPickerEl) {
      return;
    }
    difficultyPickerEl.innerHTML = "";
    LEVEL_ORDER.forEach((key) => {
      if (!levelExists(key)) {
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "difficulty-button classification-difficulty-button";
      button.dataset.difficulty = key;
      button.textContent = DIFFICULTY_LABELS[key] || key;
      button.addEventListener("click", () => setDifficulty(key));
      difficultyPickerEl.appendChild(button);
    });
  }

  function syncDifficultyButtonState() {
    if (!difficultyPickerEl) {
      return;
    }
    Array.from(difficultyPickerEl.querySelectorAll(".classification-difficulty-button")).forEach((button) => {
      const key = button.dataset.difficulty;
      button.classList.toggle("is-active", key === currentDifficulty);
      button.disabled = roundStarted && !completed;
    });
  }

  function setRoundStarted(value) {
    roundStarted = value;
    if (logicStartOverlayEl) {
      logicStartOverlayEl.classList.toggle("hidden", value);
    }
    if (itemPoolEl) {
      itemPoolEl.classList.toggle("is-waiting-start", !value);
    }
    if (zoneGridEl) {
      zoneGridEl.classList.toggle("is-waiting-start", !value);
    }
    syncDifficultyButtonState();
  }

  function renderCurrentLevel() {
    if (!currentLevel || !itemPoolEl || !zoneGridEl) {
      return;
    }
    itemNodes = new Map();
    zoneBodyMap = new Map();
    placedItemIds = new Set();
    attemptLog = [];
    roundStartedAt = 0;
    selectedItemId = null;
    completed = false;
    clearRedirect();
    setRoundStarted(false);

    if (levelTitleEl) {
      levelTitleEl.textContent = currentLevel.title;
    }
    if (levelDescriptionEl) {
      levelDescriptionEl.textContent = `難度：${DIFFICULTY_LABELS[currentDifficulty] || currentDifficulty}。請把每張圖片放到正確分類。`;
    }

    zoneGridEl.innerHTML = "";
    currentLevel.categories.forEach((category) => {
      zoneGridEl.appendChild(createZoneNode(category));
    });

    itemPoolEl.innerHTML = "";
    currentLevel.items.forEach((item) => {
      const node = createItemNode(item);
      itemNodes.set(item.id, node);
      itemPoolEl.appendChild(node);
    });

    if (logicResultEl) {
      logicResultEl.textContent = "按開始後，可以拖曳圖片，也可以先點圖片再點分類。";
    }
    updateProgressMeta();
    setFeedback("請先按開始。", "info");
    setStatus("請選擇難度，按開始後進行分類。");
  }

  function setDifficulty(levelKey) {
    if (!levelExists(levelKey)) {
      return;
    }
    const source = LEVELS[levelKey];
    currentDifficulty = levelKey;
    currentLevel = {
      title: source.title,
      categories: [...source.categories],
      items: pickRoundItems(source),
    };
    buildItemMap(currentLevel);
    saveStoredDifficulty(levelKey);
    renderCurrentLevel();
    syncDifficultyButtonState();
  }

  function resetCurrentLevel() {
    if (currentDifficulty) {
      setDifficulty(currentDifficulty);
    }
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

  renderProgress();
  renderDifficultyPicker();

  const initialDifficulty = levelExists("easy") ? "easy" : findFirstAvailableDifficulty();

  if (!initialDifficulty) {
    setFeedback("目前沒有可用分類資料。", "error");
    if (logicResultEl) {
      logicResultEl.textContent = "遊戲資料尚未載入。";
    }
    return;
  }

  setDifficulty(initialDifficulty);

  if (logicResetButton) {
    logicResetButton.addEventListener("click", resetCurrentLevel);
  }

  if (logicStartButtonEl) {
    logicStartButtonEl.addEventListener("click", () => {
      if (completed) {
        return;
      }
      setRoundStarted(true);
      if (!roundStartedAt) {
        roundStartedAt = Date.now();
      }
      setFeedback("遊戲開始。請把圖片放到正確分類。", "info");
      setStatus("可以拖曳圖片，也可以點圖片後再點分類。");
    });
  }
})();
