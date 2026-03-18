(function () {
  const flow = window.GameFlow;
  if (!flow) {
    return;
  }
  if (!flow.ensureAuthenticated()) {
    return;
  }

  const LEVELS = window.CLASSIFICATION_LEVELS || {};
  const LEVEL_ORDER = ["easy", "medium", "hard"];
  const DIFFICULTY_STORAGE_KEY = "logicDifficulty";
  const ITEMS_PER_CATEGORY = 4;
  const DIFFICULTY_LABELS = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
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
  let draggedItemId = null;
  let completed = false;
  let roundStarted = false;
  let placedItemIds = new Set();
  let itemMap = new Map();
  let itemNodes = new Map();
  let zoneBodyMap = new Map();

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
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${flow.GAME_KEYS.length}`;
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
      setStatus("三個遊戲已完成，將前往結果分析。");
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

  function pickRoundItems(sourceLevel) {
    const picked = [];
    sourceLevel.categories.forEach((category) => {
      const candidates = sourceLevel.items.filter((item) => item.category === category);
      const sampled = shuffle(candidates).slice(0, ITEMS_PER_CATEGORY);
      picked.push(...sampled.map((item) => ({ ...item })));
    });

    if (!picked.length) {
      return shuffle(sourceLevel.items)
        .slice(0, Math.min(sourceLevel.items.length, ITEMS_PER_CATEGORY))
        .map((item) => ({ ...item }));
    }

    return shuffle(picked);
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

  function clearZoneStateClasses() {
    if (!zoneGridEl) {
      return;
    }
    const zones = Array.from(zoneGridEl.querySelectorAll(".classification-zone"));
    zones.forEach((zone) => {
      zone.classList.remove(
        "is-valid-target",
        "is-drop-hover",
        "is-drop-valid",
        "is-drop-invalid",
      );
    });
  }

  function markValidTargetZone(expectedCategory) {
    if (!zoneGridEl) {
      return;
    }
    clearZoneStateClasses();
    if (!expectedCategory) {
      return;
    }
    const zones = Array.from(zoneGridEl.querySelectorAll(".classification-zone"));
    zones.forEach((zone) => {
      if (zone.dataset.category === expectedCategory) {
        zone.classList.add("is-valid-target");
      }
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
      logicProgressMetaEl.textContent = `已完成 ${completedCount}/${total}，得分 ${score} 分。`;
    }
    return score;
  }

  function showZoneHoverState(zone) {
    const activeId = draggedItemId || selectedItemId;
    const activeItem = activeId ? getItemById(activeId) : null;
    if (!activeItem) {
      return;
    }
    zone.classList.add("is-drop-hover");
    if (zone.dataset.category === activeItem.category) {
      zone.classList.add("is-drop-valid");
      zone.classList.remove("is-drop-invalid");
    } else {
      zone.classList.add("is-drop-invalid");
      zone.classList.remove("is-drop-valid");
    }
  }

  function resetZoneHoverState(zone) {
    zone.classList.remove("is-drop-hover", "is-drop-valid", "is-drop-invalid");
  }

  function returnToPool(itemId) {
    if (!itemPoolEl) {
      return;
    }
    const node = itemNodes.get(itemId);
    if (!node || node.classList.contains("is-locked")) {
      return;
    }
    itemPoolEl.appendChild(node);
  }

  function finishGame(score) {
    if (!currentLevel || completed) {
      return;
    }
    completed = true;
    const total = currentLevel.items.length;
    if (logicResultEl) {
      logicResultEl.textContent = `完成「${currentLevel.title}」，正確 ${total}/${total}，得分 ${score} 分。`;
    }
    setFeedback("分類全部正確，已完成本關。", "success");
    onComplete({
      difficulty: currentDifficulty,
      level_title: currentLevel.title,
      correct: total,
      total,
      score,
      completed_at: new Date().toISOString(),
    });
  }

  function tryPlaceItem(itemId, targetCategory) {
    if (completed || !roundStarted) {
      return;
    }
    const item = getItemById(itemId);
    const node = itemNodes.get(itemId);
    if (!item || !node || node.classList.contains("is-locked")) {
      return;
    }

    if (item.category === targetCategory) {
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
      setFeedback(`正確：${item.label} 屬於「${targetCategory}」。`, "success");
      if (logicResultEl && placedItemIds.size < currentLevel.items.length) {
        logicResultEl.textContent = `目前已完成 ${placedItemIds.size}/${currentLevel.items.length}。`;
      }
      setStatus("請繼續完成分類。");
      if (placedItemIds.size === currentLevel.items.length) {
        finishGame(score);
      }
      return;
    }

    returnToPool(itemId);
    clearSelection();
    markValidTargetZone(null);
    setFeedback(`分類錯誤：「${item.label}」不屬於「${targetCategory}」。`, "error");
    if (logicResultEl) {
      logicResultEl.textContent = "尚未完成。";
    }
    setStatus("分類錯誤，請再試一次。");
  }

  function handleItemClick(itemId) {
    if (completed) {
      return;
    }
    if (!roundStarted) {
      setStatus("請先按下藍色三角形開始。");
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
    setFeedback(`已選取「${item.label}」，請點選「${item.category}」分類區。`, "info");
  }

  function handleDragStart(event, itemId) {
    if (!roundStarted) {
      event.preventDefault();
      setStatus("請先按下藍色三角形開始。");
      return;
    }
    const node = itemNodes.get(itemId);
    const item = getItemById(itemId);
    if (!node || !item || node.classList.contains("is-locked")) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", itemId);
      event.dataTransfer.effectAllowed = "move";
    }
    clearSelection();
    draggedItemId = itemId;
    node.classList.add("is-dragging");
    markValidTargetZone(item.category);
    setFeedback(`拖曳「${item.label}」到「${item.category}」分類區。`, "info");
  }

  function handleDragEnd(itemId) {
    const node = itemNodes.get(itemId);
    if (node) {
      node.classList.remove("is-dragging");
    }
    draggedItemId = null;
    markValidTargetZone(null);
  }

  function createItemNode(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "classification-item";
    button.draggable = true;
    button.dataset.itemId = item.id;
    button.dataset.category = item.category;
    button.title = `${item.label}（${item.category}）`;
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
    button.addEventListener("dragstart", (event) => handleDragStart(event, item.id));
    button.addEventListener("dragend", () => handleDragEnd(item.id));
    return button;
  }

  function buildItemMap(level) {
    itemMap = new Map();
    level.items.forEach((item) => {
      itemMap.set(item.id, item);
    });
  }

  function setupPoolDropSupport() {
    if (!itemPoolEl) {
      return;
    }
    itemPoolEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      itemPoolEl.classList.add("is-drop-target");
    });
    itemPoolEl.addEventListener("dragleave", () => {
      itemPoolEl.classList.remove("is-drop-target");
    });
    itemPoolEl.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!roundStarted) {
        itemPoolEl.classList.remove("is-drop-target");
        return;
      }
      itemPoolEl.classList.remove("is-drop-target");
      const itemId = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
      returnToPool(itemId);
    });
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
      if (!selectedItemId) {
        return;
      }
      tryPlaceItem(selectedItemId, category);
    });

    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      showZoneHoverState(zone);
    });

    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      showZoneHoverState(zone);
    });

    zone.addEventListener("dragleave", () => {
      resetZoneHoverState(zone);
    });

    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      resetZoneHoverState(zone);
      const itemId = event.dataTransfer
        ? event.dataTransfer.getData("text/plain")
        : draggedItemId;
      if (!itemId) {
        return;
      }
      tryPlaceItem(itemId, category);
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
      button.addEventListener("click", () => {
        setDifficulty(key);
      });
      difficultyPickerEl.appendChild(button);
    });
  }

  function syncDifficultyButtonState() {
    if (!difficultyPickerEl) {
      return;
    }
    const buttons = Array.from(difficultyPickerEl.querySelectorAll(".classification-difficulty-button"));
    buttons.forEach((button) => {
      const key = button.dataset.difficulty;
      button.classList.toggle("is-active", key === currentDifficulty);
    });
  }

  function renderCurrentLevel() {
    if (!currentLevel || !itemPoolEl || !zoneGridEl) {
      return;
    }
    itemNodes = new Map();
    zoneBodyMap = new Map();
    placedItemIds = new Set();
    selectedItemId = null;
    draggedItemId = null;
    completed = false;
    setRoundStarted(false);
    clearRedirect();
    clearZoneStateClasses();

    if (levelTitleEl) {
      levelTitleEl.textContent = currentLevel.title;
    }
    if (levelDescriptionEl) {
      levelDescriptionEl.textContent = `難度：${DIFFICULTY_LABELS[currentDifficulty] || currentDifficulty}，每類隨機 ${ITEMS_PER_CATEGORY} 張，請將物件分類到下方區域。`;
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
      logicResultEl.textContent = "尚未完成。";
    }
    updateProgressMeta();
    setFeedback("按下中央藍色三角形後開始分類。", "info");
    setStatus("按下藍色三角形開始。");
  }

  function setDifficulty(levelKey) {
    if (!levelExists(levelKey)) {
      return;
    }
    const source = LEVELS[levelKey];
    const roundItems = pickRoundItems(source);
    currentDifficulty = levelKey;
    currentLevel = {
      title: source.title,
      categories: [...source.categories],
      items: roundItems,
    };
    buildItemMap(currentLevel);
    saveStoredDifficulty(levelKey);
    syncDifficultyButtonState();
    renderCurrentLevel();
  }

  function resetCurrentLevel() {
    if (!currentDifficulty) {
      return;
    }
    setDifficulty(currentDifficulty);
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

  renderProgress();
  setupPoolDropSupport();
  renderDifficultyPicker();

  const storedDifficulty = loadStoredDifficulty();
  const initialDifficulty = levelExists(storedDifficulty)
    ? storedDifficulty
    : findFirstAvailableDifficulty();

  if (!initialDifficulty) {
    setFeedback("找不到可用關卡資料，請檢查分類設定。", "error");
    if (logicResultEl) {
      logicResultEl.textContent = "遊戲初始化失敗。";
    }
    return;
  }

  setDifficulty(initialDifficulty);

  if (logicResetButton) {
    logicResetButton.addEventListener("click", () => {
      resetCurrentLevel();
    });
  }

  if (logicStartButtonEl) {
    logicStartButtonEl.addEventListener("click", () => {
      if (completed) {
        return;
      }
      setRoundStarted(true);
      setFeedback("遊戲開始，請進行分類。", "info");
      setStatus("遊戲進行中。");
    });
  }
})();
