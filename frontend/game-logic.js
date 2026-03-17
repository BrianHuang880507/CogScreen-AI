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
  const logicTokenBank = document.getElementById("logicTokenBank");
  const logicBins = Array.from(document.querySelectorAll(".shape-bin"));
  const logicResetButton = document.getElementById("logicResetButton");
  const logicResultEl = document.getElementById("logicResult");

  const SHAPES = [
    { key: "circle", label: "圓形", symbol: "●" },
    { key: "triangle", label: "三角形", symbol: "▲" },
    { key: "square", label: "方形", symbol: "■" },
  ];

  let redirectTimer = null;

  function setStatus(text) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text;
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${flow.GAME_KEYS.length}`;
    }
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
    flow.saveSessionGameResult(sessionId, "logic", payload);
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

  function createToken(shapeKey, index) {
    const shape = SHAPES.find((item) => item.key === shapeKey);
    const token = document.createElement("div");
    token.className = `shape-token shape-${shapeKey}`;
    token.draggable = true;
    token.dataset.shape = shapeKey;
    token.dataset.tokenId = `logic-${index}-${Date.now()}`;
    token.textContent = shape ? shape.symbol : "?";
    token.title = shape ? shape.label : shapeKey;
    token.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      event.dataTransfer.setData("text/plain", token.dataset.tokenId || "");
    });
    return token;
  }

  function findToken(tokenId) {
    if (!tokenId) {
      return null;
    }
    return document.querySelector(`.shape-token[data-token-id="${tokenId}"]`);
  }

  function shuffle(list) {
    const next = [...list];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
    }
    return next;
  }

  function evaluate() {
    const tokens = Array.from(document.querySelectorAll(".shape-token"));
    if (!tokens.length) {
      return;
    }
    const inBins = tokens.filter((token) => token.parentElement && token.parentElement.classList.contains("shape-bin"));
    if (inBins.length !== tokens.length) {
      return;
    }
    let correct = 0;
    inBins.forEach((token) => {
      const parent = token.parentElement;
      if (parent && parent.dataset.accept === token.dataset.shape) {
        correct += 1;
      }
    });
    const total = inBins.length;
    const score = Math.round((correct / total) * 100);
    if (logicResultEl) {
      logicResultEl.textContent = `完成分類，正確 ${correct}/${total}，得分 ${score} 分。`;
    }
    onComplete({
      correct,
      total,
      score,
      completed_at: new Date().toISOString(),
    });
  }

  function setupDropZone(zone) {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-drop-target");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("is-drop-target");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-drop-target");
      const tokenId = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
      const token = findToken(tokenId);
      if (!token) {
        return;
      }
      zone.appendChild(token);
      evaluate();
    });
  }

  function resetGame() {
    if (!logicTokenBank) {
      return;
    }
    clearRedirect();
    logicTokenBank.innerHTML = "";
    logicBins.forEach((bin) => {
      const oldTokens = Array.from(bin.querySelectorAll(".shape-token"));
      oldTokens.forEach((token) => token.remove());
    });
    const seed = [];
    for (let i = 0; i < 9; i += 1) {
      seed.push(SHAPES[i % SHAPES.length].key);
    }
    shuffle(seed).forEach((shapeKey, index) => {
      logicTokenBank.appendChild(createToken(shapeKey, index));
    });
    if (logicResultEl) {
      logicResultEl.textContent = "尚未完成。";
    }
    setStatus("請完成本遊戲。");
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

  setupDropZone(logicTokenBank);
  logicBins.forEach((bin) => setupDropZone(bin));
  if (logicResetButton) {
    logicResetButton.addEventListener("click", () => {
      resetGame();
    });
  }

  renderProgress();
  resetGame();
})();
