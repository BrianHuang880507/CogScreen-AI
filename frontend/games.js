(function () {
  const flow = window.GameFlow;
  if (!flow || !flow.ensureAuthenticated()) {
    return;
  }

  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const goResultsButton = document.getElementById("goResultsButton");
  const gameCards = Array.from(document.querySelectorAll(".game-select-card"));
  const chips = Array.from(document.querySelectorAll("[data-game-chip]"));

  const sessionId = flow.resolveSessionId();
  let autoRedirectTimer = null;

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }

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

  function isCardCompleted(entry, gameKey) {
    if (!entry || !gameKey) {
      return false;
    }
    if (gameKey === "logic" || gameKey === "sequence") {
      return flow.isCategoryCompleted(entry, "logic");
    }
    return Boolean(entry[gameKey]);
  }

  function render() {
    const entry = flow.getSessionGameResults(sessionId);
    const done = flow.countCompletedGames(entry);
    const allDone = flow.allGamesCompleted(entry);

    if (doneEl) {
      doneEl.textContent = `${done}/${requiredCount()}`;
    }

    chips.forEach((chip) => {
      const gameKey = chip.dataset.gameChip;
      const isDone = isCardCompleted(entry, gameKey);
      chip.textContent = isDone ? "已完成" : "未完成";
      chip.classList.toggle("is-done", isDone);
    });

    gameCards.forEach((card) => {
      const gameKey = card.dataset.game;
      card.classList.toggle("is-done", isCardCompleted(entry, gameKey));
      card.disabled = !sessionId;
    });

    if (goResultsButton) {
      goResultsButton.disabled = !sessionId || !allDone;
    }

    if (!sessionId) {
      setStatus("缺少 Session ID，請重新進入遊戲流程。");
      return;
    }

    if (allDone) {
      setStatus("四類遊戲都完成了，正在前往結果分析。");
      if (autoRedirectTimer) {
        window.clearTimeout(autoRedirectTimer);
      }
      autoRedirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 2200);
    } else {
      setStatus("請選擇一個遊戲開始。完成遊戲可累積獨立點數。");
      if (autoRedirectTimer) {
        window.clearTimeout(autoRedirectTimer);
        autoRedirectTimer = null;
      }
    }

    flow.renderPointsWidgets();
  }

  gameCards.forEach((card) => {
    card.addEventListener("click", () => {
      const gameKey = card.dataset.game;
      if (!gameKey || !sessionId) {
        return;
      }
      window.location.href = flow.buildGameUrl(gameKey, sessionId);
    });
  });

  if (goResultsButton) {
    goResultsButton.addEventListener("click", () => {
      if (!sessionId) {
        return;
      }
      window.location.href = flow.buildResultsUrl(sessionId);
    });
  }

  render();
})();
