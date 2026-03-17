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
  const startButton = document.getElementById("focusStartButton");
  const progressEl = document.getElementById("focusProgress");
  const resultEl = document.getElementById("focusResult");
  const diffButtons = Array.from(document.querySelectorAll(".diff-hit"));

  let found = new Set();
  let active = false;
  let startAt = 0;
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

  function renderFound() {
    if (!progressEl) {
      return;
    }
    progressEl.textContent = `已找到 ${found.size} / 3。`;
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

  function finish() {
    active = false;
    const elapsed = (performance.now() - startAt) / 1000;
    const score = Math.max(0, Math.round(120 - elapsed * 10));
    if (resultEl) {
      resultEl.textContent = `完成找不同，用時 ${elapsed.toFixed(1)} 秒，得分 ${score} 分。`;
    }
    onComplete({
      found: 3,
      total: 3,
      elapsed_sec: Number(elapsed.toFixed(1)),
      score,
      completed_at: new Date().toISOString(),
    });
  }

  function startGame() {
    clearRedirect();
    active = true;
    startAt = performance.now();
    found = new Set();
    diffButtons.forEach((button) => {
      button.classList.remove("is-found");
    });
    renderFound();
    if (resultEl) {
      resultEl.textContent = "請在右側圖中找出 3 個不同處。";
    }
    setStatus("遊戲進行中。");
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.focus || !resultEl) {
      return;
    }
    resultEl.textContent = `上次結果：用時 ${entry.focus.elapsed_sec} 秒，得分 ${entry.focus.score} 分。`;
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
  hydrate();
  renderFound();
  if (startButton) {
    startButton.addEventListener("click", () => {
      startGame();
    });
  }
  diffButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!active) {
        return;
      }
      const diffKey = button.dataset.diff || "";
      if (!diffKey || found.has(diffKey)) {
        return;
      }
      found.add(diffKey);
      button.classList.add("is-found");
      renderFound();
      if (found.size >= 3) {
        finish();
      }
    });
  });
})();
