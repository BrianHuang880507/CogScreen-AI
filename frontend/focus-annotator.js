(function () {
  const DEFAULT_IMAGE = "/static/images/games/spot-the-diff/img_0001.jpg";
  const DEFAULT_RADIUS = 40;

  const imagePathInput = document.getElementById("imagePathInput");
  const loadImageButton = document.getElementById("loadImageButton");
  const shapeModeSelect = document.getElementById("shapeModeSelect");
  const circleRadiusInput = document.getElementById("circleRadiusInput");
  const clearRegionsButton = document.getElementById("clearRegionsButton");
  const naturalSizeText = document.getElementById("naturalSizeText");
  const lastClickText = document.getElementById("lastClickText");
  const annotatorStatusText = document.getElementById("annotatorStatusText");
  const imageEl = document.getElementById("annotatorImage");
  const overlayEl = document.getElementById("annotatorOverlay");
  const regionListEl = document.getElementById("regionList");
  const exportButton = document.getElementById("exportButton");
  const copyButton = document.getElementById("copyButton");
  const exportOutput = document.getElementById("exportOutput");

  let naturalWidth = 0;
  let naturalHeight = 0;
  let differences = [];
  let pendingRectStart = null;
  let nextDiffNumber = 1;

  function setStatus(text) {
    if (annotatorStatusText) {
      annotatorStatusText.textContent = text;
    }
  }

  function updateNaturalSize() {
    if (!naturalSizeText) {
      return;
    }
    if (!naturalWidth || !naturalHeight) {
      naturalSizeText.textContent = "--";
      return;
    }
    naturalSizeText.textContent = `${naturalWidth} x ${naturalHeight}`;
  }

  function roundCoord(value) {
    return Math.round(value);
  }

  function nextDiffId() {
    while (differences.some((item) => item.id === `diff-${nextDiffNumber}`)) {
      nextDiffNumber += 1;
    }
    const id = `diff-${nextDiffNumber}`;
    nextDiffNumber += 1;
    return id;
  }

  function regionToText(item) {
    if (item.shape === "circle") {
      return `{ id: "${item.id}", shape: "circle", x: ${item.x}, y: ${item.y}, r: ${item.r} }`;
    }
    return `{ id: "${item.id}", shape: "rect", x: ${item.x}, y: ${item.y}, w: ${item.w}, h: ${item.h} }`;
  }

  function buildExportText() {
    if (!differences.length) {
      return "differences: []";
    }
    const lines = differences.map((item) => `  ${regionToText(item)}`);
    return ["differences: [", `${lines.join(",\n")}`, "]"].join("\n");
  }

  function renderExport() {
    if (!exportOutput) {
      return;
    }
    exportOutput.value = buildExportText();
  }

  function clearDynamicOverlay() {
    if (!overlayEl) {
      return;
    }
    Array.from(overlayEl.querySelectorAll(".annot-region,.annot-pending-point")).forEach(
      (node) => node.remove(),
    );
  }

  function appendPendingPoint() {
    if (!overlayEl || !pendingRectStart || !naturalWidth || !naturalHeight) {
      return;
    }
    const point = document.createElement("div");
    point.className = "annot-pending-point";
    point.style.left = `${(pendingRectStart.x / naturalWidth) * 100}%`;
    point.style.top = `${(pendingRectStart.y / naturalHeight) * 100}%`;
    overlayEl.appendChild(point);
  }

  function appendRegion(region) {
    if (!overlayEl || !naturalWidth || !naturalHeight) {
      return;
    }
    const marker = document.createElement("div");
    marker.className = `annot-region ${region.shape}`;
    const label = document.createElement("span");
    label.className = "annot-region-label";
    label.textContent = region.id;
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
    differences.forEach((region) => appendRegion(region));
    appendPendingPoint();
  }

  function renderRegionList() {
    if (!regionListEl) {
      return;
    }
    if (!differences.length) {
      regionListEl.innerHTML = '<p class="muted-empty">尚未建立任何區域。</p>';
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
        renderRegionList();
        renderOverlay();
        renderExport();
        setStatus(`已刪除 ${item.id}`);
      });
      row.appendChild(text);
      row.appendChild(delBtn);
      regionListEl.appendChild(row);
    });
  }

  function addCircle(x, y) {
    const parsedRadius = Number.parseInt(circleRadiusInput.value, 10);
    const radius =
      Number.isFinite(parsedRadius) && parsedRadius > 0
        ? parsedRadius
        : DEFAULT_RADIUS;
    const region = {
      id: nextDiffId(),
      shape: "circle",
      x,
      y,
      r: radius,
    };
    differences.push(region);
    renderRegionList();
    renderOverlay();
    renderExport();
    setStatus(`已新增 ${region.id} (circle)`);
  }

  function addRectFromPoints(first, second) {
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const w = Math.abs(second.x - first.x);
    const h = Math.abs(second.y - first.y);
    if (w < 1 || h < 1) {
      setStatus("矩形寬高不可為 0，請重新點選。");
      return;
    }
    const region = {
      id: nextDiffId(),
      shape: "rect",
      x,
      y,
      w,
      h,
    };
    differences.push(region);
    renderRegionList();
    renderOverlay();
    renderExport();
    setStatus(`已新增 ${region.id} (rect)`);
  }

  function toOriginalCoords(event) {
    if (!imageEl || !naturalWidth || !naturalHeight) {
      return null;
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
      return null;
    }
    const x = roundCoord((displayX / rect.width) * naturalWidth);
    const y = roundCoord((displayY / rect.height) * naturalHeight);
    return { x, y };
  }

  function resetRectPending() {
    pendingRectStart = null;
    renderOverlay();
  }

  function handleImageClick(event) {
    const point = toOriginalCoords(event);
    if (!point) {
      return;
    }
    if (lastClickText) {
      lastClickText.textContent = `x=${point.x}, y=${point.y}`;
    }

    if (point.x < naturalWidth / 2) {
      setStatus("左半邊不計分，請在右半邊點擊。");
      return;
    }

    const mode = shapeModeSelect.value;
    if (mode === "circle") {
      resetRectPending();
      addCircle(point.x, point.y);
      return;
    }

    if (!pendingRectStart) {
      pendingRectStart = point;
      renderOverlay();
      setStatus("矩形模式：已記錄第一點，請點第二點。");
      return;
    }

    addRectFromPoints(pendingRectStart, point);
    pendingRectStart = null;
    renderOverlay();
  }

  function loadImage(path) {
    if (!imageEl) {
      return;
    }
    const safePath = (path || "").trim() || DEFAULT_IMAGE;
    resetRectPending();
    setStatus("載入圖片中...");
    imageEl.src = safePath;
  }

  function onImageLoaded() {
    naturalWidth = imageEl.naturalWidth || 0;
    naturalHeight = imageEl.naturalHeight || 0;
    updateNaturalSize();
    renderOverlay();
    setStatus("圖片已載入，可開始標註。");
  }

  function onImageError() {
    naturalWidth = 0;
    naturalHeight = 0;
    updateNaturalSize();
    setStatus("圖片載入失敗，請確認路徑。");
  }

  function copyExport() {
    const text = exportOutput.value || "";
    if (!text) {
      setStatus("沒有可複製內容。");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setStatus("已複製匯出內容。"))
        .catch(() => setStatus("複製失敗，請手動複製。"));
      return;
    }
    exportOutput.focus();
    exportOutput.select();
    const ok = document.execCommand("copy");
    setStatus(ok ? "已複製匯出內容。" : "複製失敗，請手動複製。");
  }

  if (loadImageButton) {
    loadImageButton.addEventListener("click", () => {
      loadImage(imagePathInput.value);
    });
  }

  if (shapeModeSelect) {
    shapeModeSelect.addEventListener("change", () => {
      if (shapeModeSelect.value === "circle") {
        resetRectPending();
      } else {
        setStatus("矩形模式：請在右半邊依序點兩下。");
      }
    });
  }

  if (clearRegionsButton) {
    clearRegionsButton.addEventListener("click", () => {
      differences = [];
      pendingRectStart = null;
      nextDiffNumber = 1;
      renderRegionList();
      renderOverlay();
      renderExport();
      setStatus("已清空全部區域。");
    });
  }

  if (imageEl) {
    imageEl.addEventListener("load", onImageLoaded);
    imageEl.addEventListener("error", onImageError);
    imageEl.addEventListener("click", handleImageClick);
    if (imageEl.complete && imageEl.naturalWidth > 0) {
      onImageLoaded();
    }
  }

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      renderExport();
      setStatus("已更新匯出文字。");
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", copyExport);
  }

  if (imagePathInput) {
    imagePathInput.value = DEFAULT_IMAGE;
  }

  renderRegionList();
  renderExport();
  updateNaturalSize();
})();
