(function () {
  const IMAGE_URL_PREFIX = "/static/images/games/spot-the-diff/";
  const DEFAULT_RADIUS = 40;

  const levelSelect = document.getElementById("levelSelect");
  const imagePathInput = document.getElementById("imagePathInput");
  const imageFileInput = document.getElementById("imageFileInput");
  const imageDropZone = document.getElementById("imageDropZone");
  const loadImageButton = document.getElementById("loadImageButton");
  const levelIdInput = document.getElementById("levelIdInput");
  const annotationModeSelect = document.getElementById("annotationModeSelect");
  const shapeModeSelect = document.getElementById("shapeModeSelect");
  const circleRadiusInput = document.getElementById("circleRadiusInput");
  const saveCurrentLevelButton = document.getElementById("saveCurrentLevelButton");
  const saveNewLevelButton = document.getElementById("saveNewLevelButton");
  const clearRegionsButton = document.getElementById("clearRegionsButton");
  const naturalSizeText = document.getElementById("naturalSizeText");
  const lastClickText = document.getElementById("lastClickText");
  const annotatorStatusText = document.getElementById("annotatorStatusText");
  const saveStatusText = document.getElementById("saveStatusText");
  const imageEl = document.getElementById("annotatorImage");
  const overlayEl = document.getElementById("annotatorOverlay");
  const regionListEl = document.getElementById("regionList");
  const exportButton = document.getElementById("exportButton");
  const copyButton = document.getElementById("copyButton");
  const exportOutput = document.getElementById("exportOutput");

  let levelsState = [];
  let activeLevelId = "";
  let naturalWidth = 0;
  let naturalHeight = 0;
  let currentImagePath = "";
  let previewObjectUrl = "";
  let differences = [];
  let nextDiffNumber = 1;
  let dragState = null;
  let dirty = false;

  function setStatus(text) {
    if (annotatorStatusText) {
      annotatorStatusText.textContent = text;
    }
  }

  function setSaveStatus(text) {
    if (saveStatusText) {
      saveStatusText.textContent = text;
    }
  }

  function updateNaturalSize() {
    if (!naturalSizeText) {
      return;
    }
    naturalSizeText.textContent =
      naturalWidth && naturalHeight ? `${naturalWidth} x ${naturalHeight}` : "--";
  }

  function roundCoord(value) {
    return Math.round(value);
  }

  function halfWidth() {
    return naturalWidth / 2;
  }

  function annotationMode() {
    return annotationModeSelect ? annotationModeSelect.value : "right";
  }

  function isStaticImagePath(path) {
    return typeof path === "string" && path.startsWith(IMAGE_URL_PREFIX);
  }

  function jsString(value) {
    return JSON.stringify(String(value));
  }

  function normalizeDifference(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const id = String(item.id || "").trim();
    const shape = item.shape === "rect" ? "rect" : item.shape === "circle" ? "circle" : "";
    const x = Number.parseInt(item.x, 10);
    const y = Number.parseInt(item.y, 10);
    if (!id || !shape || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      return null;
    }
    if (shape === "circle") {
      const r = Number.parseInt(item.r, 10);
      if (!Number.isFinite(r) || r < 1) {
        return null;
      }
      return { id, shape, x, y, r };
    }
    const w = Number.parseInt(item.w, 10);
    const h = Number.parseInt(item.h, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      return null;
    }
    return { id, shape, x, y, w, h };
  }

  function normalizeLevel(item, fallbackId) {
    const id = String(item && item.id ? item.id : fallbackId).trim() || fallbackId;
    const difficulty =
      item && ["easy", "medium", "hard"].includes(item.difficulty) ? item.difficulty : "easy";
    const image = typeof (item && item.image) === "string" ? item.image.trim() : "";
    const normalizedDifferences = Array.isArray(item && item.differences)
      ? item.differences.map(normalizeDifference).filter(Boolean)
      : [];
    return {
      id,
      difficulty,
      enabled: item && item.enabled === false ? false : true,
      image,
      differences: normalizedDifferences,
    };
  }

  function cloneLevel(level) {
    return {
      id: level.id,
      difficulty: level.difficulty || "easy",
      enabled: level.enabled !== false,
      image: level.image || "",
      differences: level.differences.map((item) => ({ ...item })),
    };
  }

  function resetDifferences() {
    differences = [];
    nextDiffNumber = 1;
    dragState = null;
  }

  function syncNextDiffNumber() {
    nextDiffNumber = 1;
    differences.forEach((item) => {
      const match = /^diff-(\d+)$/.exec(item.id);
      if (match) {
        nextDiffNumber = Math.max(nextDiffNumber, Number.parseInt(match[1], 10) + 1);
      }
    });
  }

  function nextDiffId() {
    while (differences.some((item) => item.id === `diff-${nextDiffNumber}`)) {
      nextDiffNumber += 1;
    }
    const id = `diff-${nextDiffNumber}`;
    nextDiffNumber += 1;
    return id;
  }

  function nextSpotId() {
    let maxNumber = 0;
    levelsState.forEach((level) => {
      const match = /^spot-(\d+)$/.exec(level.id);
      if (match) {
        maxNumber = Math.max(maxNumber, Number.parseInt(match[1], 10));
      }
    });
    return `spot-${String(maxNumber + 1).padStart(3, "0")}`;
  }

  function markDirty(message) {
    dirty = true;
    renderExport();
    if (message) {
      setStatus(message);
    }
    setSaveStatus("尚未寫入");
  }

  function currentDraftLevel(idOverride) {
    const id = (idOverride || (levelIdInput ? levelIdInput.value : "") || activeLevelId || nextSpotId()).trim();
    return {
      id: id || nextSpotId(),
      difficulty: "easy",
      enabled: true,
      image: currentImagePath || (imagePathInput ? imagePathInput.value.trim() : ""),
      differences: differences.map((item) => ({ ...item })),
    };
  }

  function regionToText(item) {
    if (item.shape === "circle") {
      return `{ id: ${jsString(item.id)}, shape: "circle", x: ${item.x}, y: ${item.y}, r: ${item.r} }`;
    }
    return `{ id: ${jsString(item.id)}, shape: "rect", x: ${item.x}, y: ${item.y}, w: ${item.w}, h: ${item.h} }`;
  }

  function levelToText(level) {
    const lines = level.differences.map((item) => `                ${regionToText(item)},`);
    return [
      "        {",
      `            id: ${jsString(level.id)},`,
      `            difficulty: ${jsString(level.difficulty || "easy")},`,
      `            enabled: ${level.enabled === false ? "false" : "true"},`,
      `            image: ${jsString(level.image || "")},`,
      "            differences: [",
      ...lines,
      "            ],",
      "        },",
    ].join("\n");
  }

  function buildFocusLevelsText(levels) {
    return [
      "(function () {",
      "    const FOCUS_LEVELS = [",
      ...levels.map(levelToText),
      "    ];",
      "",
      "    window.FOCUS_LEVELS = FOCUS_LEVELS;",
      "})();",
    ].join("\n");
  }

  function buildPreviewLevelsForUpdate() {
    const draft = currentDraftLevel();
    const nextLevels = levelsState.map(cloneLevel);
    const activeIndex = nextLevels.findIndex((level) => level.id === activeLevelId);
    if (activeIndex >= 0) {
      nextLevels[activeIndex] = draft;
      return nextLevels;
    }
    return [draft, ...nextLevels];
  }

  function renderExport() {
    if (exportOutput) {
      exportOutput.value = buildFocusLevelsText(buildPreviewLevelsForUpdate());
    }
  }

  function renderLevelSelect() {
    if (!levelSelect) {
      return;
    }
    levelSelect.innerHTML = "";
    levelsState.forEach((level) => {
      const option = document.createElement("option");
      option.value = level.id;
      option.textContent = `${level.id} (${level.differences.length})`;
      option.selected = level.id === activeLevelId;
      levelSelect.appendChild(option);
    });
    if (!levelsState.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "尚未有題目";
      levelSelect.appendChild(option);
    }
  }

  function clearDynamicOverlay() {
    if (!overlayEl) {
      return;
    }
    Array.from(overlayEl.querySelectorAll(".annot-region")).forEach((node) => node.remove());
  }

  function shouldShowLeftReference() {
    return annotationMode() === "left-to-right" && naturalWidth > 0;
  }

  function mirrorRegionToLeft(region) {
    if (!shouldShowLeftReference() || !region) {
      return null;
    }
    const splitX = halfWidth();
    const x = roundCoord(region.x - splitX);
    if (x < 0 || x > splitX) {
      return null;
    }
    return { ...region, x };
  }

  function appendRegion(region, options = {}) {
    if (!overlayEl || !naturalWidth || !naturalHeight || !region) {
      return;
    }
    const marker = document.createElement("div");
    marker.className = [
      "annot-region",
      region.shape,
      options.preview ? "preview" : "",
      options.reference ? "reference" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const label = document.createElement("span");
    label.className = "annot-region-label";
    label.textContent = options.label || region.id;
    marker.appendChild(label);

    if (region.shape === "circle") {
      marker.style.left = `${((region.x - region.r) / naturalWidth) * 100}%`;
      marker.style.top = `${((region.y - region.r) / naturalHeight) * 100}%`;
      marker.style.width = `${((region.r * 2) / naturalWidth) * 100}%`;
      marker.style.height = `${((region.r * 2) / naturalHeight) * 100}%`;
    } else {
      marker.style.left = `${(region.x / naturalWidth) * 100}%`;
      marker.style.top = `${(region.y / naturalHeight) * 100}%`;
      marker.style.width = `${(region.w / naturalWidth) * 100}%`;
      marker.style.height = `${(region.h / naturalHeight) * 100}%`;
    }
    overlayEl.appendChild(marker);
  }

  function renderOverlay() {
    clearDynamicOverlay();
    differences.forEach((region) => {
      const leftReference = mirrorRegionToLeft(region);
      if (leftReference) {
        appendRegion(leftReference, { reference: true, label: `${region.id} left` });
      }
      appendRegion(region);
    });
    if (dragState && dragState.preview) {
      if (dragState.sourcePreview) {
        appendRegion(dragState.sourcePreview, {
          preview: true,
          reference: true,
          label: "preview left",
        });
      }
      appendRegion(dragState.preview, { preview: true, label: "preview" });
    }
  }

  function renderRegionList() {
    if (!regionListEl) {
      return;
    }
    if (!differences.length) {
      regionListEl.innerHTML = '<p class="muted-empty">尚未標註任何差異。</p>';
      return;
    }
    regionListEl.innerHTML = "";
    differences.forEach((item) => {
      const row = document.createElement("div");
      row.className = "region-item";
      const text = document.createElement("code");
      text.textContent = regionToText(item);
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "刪除";
      delBtn.addEventListener("click", () => {
        differences = differences.filter((x) => x.id !== item.id);
        renderAll();
        markDirty(`已刪除 ${item.id}`);
      });
      row.appendChild(text);
      row.appendChild(delBtn);
      regionListEl.appendChild(row);
    });
  }

  function renderAll() {
    renderLevelSelect();
    renderRegionList();
    renderOverlay();
    renderExport();
  }

  function sourcePointFromEvent(event) {
    if (!imageEl || !naturalWidth || !naturalHeight) {
      return null;
    }
    const rect = imageEl.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    if (displayX < 0 || displayY < 0 || displayX > rect.width || displayY > rect.height) {
      return null;
    }
    return {
      x: roundCoord((displayX / rect.width) * naturalWidth),
      y: roundCoord((displayY / rect.height) * naturalHeight),
    };
  }

  function transformPoint(point) {
    if (!point || !naturalWidth) {
      return null;
    }
    const mode = annotationMode();
    const splitX = halfWidth();
    if (mode === "right") {
      return point.x >= splitX ? point : null;
    }
    if (mode === "left-to-right") {
      if (point.x > splitX) {
        return null;
      }
      return {
        x: Math.min(naturalWidth, roundCoord(point.x + splitX)),
        y: point.y,
      };
    }
    return point;
  }

  function buildSourceRectFromPoints(first, second) {
    if (annotationMode() !== "left-to-right" || !first || !second) {
      return null;
    }
    const splitX = halfWidth();
    if (first.x > splitX || second.x > splitX) {
      return null;
    }
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const w = Math.abs(second.x - first.x);
    const h = Math.abs(second.y - first.y);
    if (w < 1 || h < 1) {
      return null;
    }
    return {
      id: "preview-left",
      shape: "rect",
      x,
      y,
      w,
      h,
    };
  }

  function buildRectFromPoints(first, second) {
    const start = transformPoint(first);
    const end = transformPoint(second);
    if (!start || !end) {
      return null;
    }
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 1 || h < 1) {
      return null;
    }
    return {
      id: "preview",
      shape: "rect",
      x,
      y,
      w,
      h,
    };
  }

  function currentRadius() {
    const parsedRadius = Number.parseInt(circleRadiusInput.value, 10);
    return Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : DEFAULT_RADIUS;
  }

  function addCircle(sourcePoint) {
    const point = transformPoint(sourcePoint);
    if (!point) {
      setStatus("這個標註模式不接受目前點選的位置。");
      return;
    }
    const region = {
      id: nextDiffId(),
      shape: "circle",
      x: point.x,
      y: point.y,
      r: currentRadius(),
    };
    differences.push(region);
    if (lastClickText) {
      lastClickText.textContent = `x=${region.x}, y=${region.y}`;
    }
    renderAll();
    markDirty(`已新增 ${region.id} (circle)`);
  }

  function addRect(first, second) {
    const rect = buildRectFromPoints(first, second);
    if (!rect) {
      setStatus("rect 框選無效，請確認拖曳起點與終點在目前標註半邊內。");
      return;
    }
    rect.id = nextDiffId();
    differences.push(rect);
    if (lastClickText) {
      lastClickText.textContent = `x=${rect.x}, y=${rect.y}, w=${rect.w}, h=${rect.h}`;
    }
    renderAll();
    markDirty(`已新增 ${rect.id} (rect)`);
  }

  function loadImage(path, options = {}) {
    if (!imageEl) {
      return;
    }
    const safePath = (path || "").trim();
    if (!safePath) {
      setStatus("請先輸入圖片路徑或拖放圖片。");
      return;
    }
    currentImagePath = isStaticImagePath(safePath) ? safePath : "";
    if (imagePathInput) {
      imagePathInput.value = safePath;
    }
    if (options.resetRegions) {
      resetDifferences();
      markDirty("已載入新圖片草稿，尚未寫入 focus-levels.js。");
    }
    setStatus("正在載入圖片...");
    imageEl.src = safePath;
    renderAll();
  }

  function onImageLoaded() {
    naturalWidth = imageEl.naturalWidth || 0;
    naturalHeight = imageEl.naturalHeight || 0;
    updateNaturalSize();
    renderAll();
    setStatus("圖片已載入，可以開始標註。");
  }

  function onImageError() {
    naturalWidth = 0;
    naturalHeight = 0;
    updateNaturalSize();
    setStatus("圖片載入失敗，請確認路徑或重新拖放圖片。");
  }

  async function uploadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("請拖放圖片檔。");
      return;
    }
    const formData = new FormData();
    formData.append("image", file);
    setStatus("正在上傳圖片...");
    try {
      const response = await fetch("/api/focus-level-image", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      loadImage(payload.image, { resetRegions: true });
      setSaveStatus("圖片已上傳，請標註後再更新或另存");
    } catch (error) {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
      previewObjectUrl = URL.createObjectURL(file);
      currentImagePath = "";
      loadImage(previewObjectUrl, { resetRegions: true });
      setStatus("已用暫存預覽載入；若要寫入 focus-levels.js，請用 FastAPI server 開啟此頁。");
      setSaveStatus("無法寫入：圖片未上傳到 static");
    }
  }

  function loadLevel(levelId) {
    const level = levelsState.find((item) => item.id === levelId);
    if (!level) {
      return;
    }
    activeLevelId = level.id;
    if (levelIdInput) {
      levelIdInput.value = level.id;
    }
    currentImagePath = level.image;
    differences = level.differences.map((item) => ({ ...item }));
    syncNextDiffNumber();
    dirty = false;
    if (level.image) {
      loadImage(level.image);
    } else {
      renderAll();
      updateNaturalSize();
    }
    setSaveStatus(`已載入 ${level.id}，目前有 ${differences.length} 個座標`);
  }

  function validateDraftForSave(level, options = {}) {
    if (!level.id) {
      setStatus("題目 ID 不可空白。");
      return false;
    }
    if (!isStaticImagePath(level.image)) {
      setStatus("圖片路徑必須位於 /static/images/games/spot-the-diff/。");
      setSaveStatus("未寫入");
      return false;
    }
    if (options.requireDifferences && !level.differences.length) {
      setStatus("另存新題目前，請至少標註一個座標。");
      return false;
    }
    return true;
  }

  async function writeLevels(nextLevels, activeId, options = {}) {
    try {
      setSaveStatus("寫入中...");
      const response = await fetch("/api/focus-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          levels: nextLevels,
          active_id: activeId,
          allow_empty_update: Boolean(options.allowEmptyUpdate),
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = await response.json();
      levelsState = nextLevels.map(normalizeLevel);
      activeLevelId = activeId;
      if (levelIdInput) {
        levelIdInput.value = activeId;
      }
      dirty = false;
      renderAll();
      setSaveStatus(`已寫入 ${result.level_count} 題，備份已建立`);
      setStatus(`focus-levels.js 已更新。${result.backup_path ? "已先備份舊檔。" : ""}`);
      return true;
    } catch (error) {
      setSaveStatus("寫入失敗");
      setStatus(`focus-levels.js 寫入失敗：${error.message || error}`);
      return false;
    }
  }

  async function saveCurrentLevel() {
    const draft = currentDraftLevel();
    if (!validateDraftForSave(draft)) {
      return;
    }
    const existingIndex = levelsState.findIndex((level) => level.id === activeLevelId);
    const duplicateIndex = levelsState.findIndex(
      (level, index) => level.id === draft.id && index !== existingIndex,
    );
    if (duplicateIndex >= 0) {
      setStatus(`題目 ID ${draft.id} 已存在，請改用其他 ID 或選擇該題目。`);
      return;
    }
    const existingLevel = existingIndex >= 0 ? levelsState[existingIndex] : null;
    let allowEmptyUpdate = false;
    if (existingLevel && existingLevel.differences.length > 0 && draft.differences.length === 0) {
      allowEmptyUpdate = window.confirm(
        `目前題目 ${existingLevel.id} 原本有 ${existingLevel.differences.length} 個座標。確定要更新成空座標嗎？`,
      );
      if (!allowEmptyUpdate) {
        setStatus("已取消清空座標寫入。");
        return;
      }
    }
    const nextLevels = levelsState.map(cloneLevel);
    if (existingIndex >= 0) {
      nextLevels[existingIndex] = draft;
    } else {
      nextLevels.unshift(draft);
    }
    await writeLevels(nextLevels, draft.id, { allowEmptyUpdate });
  }

  async function saveAsNewLevel() {
    const newId = nextSpotId();
    const draft = currentDraftLevel(newId);
    if (!validateDraftForSave(draft, { requireDifferences: true })) {
      return;
    }
    draft.id = newId;
    const nextLevels = [draft, ...levelsState.map(cloneLevel)];
    if (levelIdInput) {
      levelIdInput.value = draft.id;
    }
    await writeLevels(nextLevels, draft.id);
  }

  function copyExport() {
    const text = exportOutput.value || "";
    if (!text) {
      setStatus("沒有內容可複製。");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setStatus("已複製 focus-levels.js 預覽內容。"))
        .catch(() => setStatus("複製失敗，請手動選取文字。"));
      return;
    }
    exportOutput.focus();
    exportOutput.select();
    const ok = document.execCommand("copy");
    setStatus(ok ? "已複製 focus-levels.js 預覽內容。" : "複製失敗，請手動選取文字。");
  }

  function initializeLevels() {
    const rawLevels = Array.isArray(window.FOCUS_LEVELS) ? window.FOCUS_LEVELS : [];
    levelsState = rawLevels.map((item, index) => normalizeLevel(item, `spot-${String(index + 1).padStart(3, "0")}`));
    if (!levelsState.length) {
      levelsState = [
        {
          id: "spot-001",
          difficulty: "easy",
          enabled: true,
          image: "",
          differences: [],
        },
      ];
    }
    renderLevelSelect();
    loadLevel(levelsState[0].id);
  }

  if (levelSelect) {
    levelSelect.addEventListener("change", () => {
      if (dirty) {
        const ok = window.confirm("目前畫面有尚未寫入的修改，切換題目會放棄這些修改。要繼續嗎？");
        if (!ok) {
          renderLevelSelect();
          return;
        }
      }
      loadLevel(levelSelect.value);
    });
  }

  if (loadImageButton) {
    loadImageButton.addEventListener("click", () => {
      loadImage(imagePathInput.value, { resetRegions: true });
    });
  }

  if (imageFileInput) {
    imageFileInput.addEventListener("change", () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      uploadImageFile(file);
    });
  }

  if (imageDropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      imageDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        imageDropZone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      imageDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        imageDropZone.classList.remove("drag-over");
      });
    });
    imageDropZone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      uploadImageFile(file);
    });
  }

  if (shapeModeSelect) {
    shapeModeSelect.addEventListener("change", () => {
      dragState = null;
      renderOverlay();
      setStatus(
        shapeModeSelect.value === "rect"
          ? "rect 模式請按住滑鼠拖曳框選。"
          : "circle 模式請點選差異中心。",
      );
    });
  }

  if (annotationModeSelect) {
    annotationModeSelect.addEventListener("change", () => {
      dragState = null;
      renderOverlay();
      setStatus("標註位置模式已更新。");
    });
  }

  if (levelIdInput) {
    levelIdInput.addEventListener("input", () => {
      markDirty("題目 ID 已修改，尚未寫入。");
    });
  }

  if (saveCurrentLevelButton) {
    saveCurrentLevelButton.addEventListener("click", saveCurrentLevel);
  }

  if (saveNewLevelButton) {
    saveNewLevelButton.addEventListener("click", saveAsNewLevel);
  }

  if (clearRegionsButton) {
    clearRegionsButton.addEventListener("click", () => {
      resetDifferences();
      renderAll();
      markDirty("已清除畫面座標。必須按更新目前題目才會寫入空座標。");
    });
  }

  if (imageEl) {
    imageEl.addEventListener("load", onImageLoaded);
    imageEl.addEventListener("error", onImageError);
    imageEl.addEventListener("pointerdown", (event) => {
      if (!naturalWidth || !naturalHeight) {
        return;
      }
      const point = sourcePointFromEvent(event);
      if (!point) {
        return;
      }
      imageEl.setPointerCapture(event.pointerId);
      dragState = { start: point, preview: null, sourcePreview: null };
      event.preventDefault();
    });
    imageEl.addEventListener("pointermove", (event) => {
      if (!dragState || !naturalWidth || !naturalHeight) {
        return;
      }
      if (!shapeModeSelect || shapeModeSelect.value !== "rect") {
        return;
      }
      const point = sourcePointFromEvent(event);
      dragState.preview = buildRectFromPoints(dragState.start, point);
      dragState.sourcePreview = buildSourceRectFromPoints(dragState.start, point);
      renderOverlay();
      event.preventDefault();
    });
    imageEl.addEventListener("pointerup", (event) => {
      if (!dragState || !naturalWidth || !naturalHeight) {
        return;
      }
      const endPoint = sourcePointFromEvent(event);
      const startPoint = dragState.start;
      dragState = null;
      if (!endPoint) {
        renderOverlay();
        return;
      }
      if (!shapeModeSelect || shapeModeSelect.value === "circle") {
        addCircle(endPoint);
      } else {
        addRect(startPoint, endPoint);
      }
      event.preventDefault();
    });
    imageEl.addEventListener("pointercancel", () => {
      dragState = null;
      renderOverlay();
    });
  }

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      renderExport();
      setStatus("已重新產生預覽。");
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", copyExport);
  }

  initializeLevels();
})();
