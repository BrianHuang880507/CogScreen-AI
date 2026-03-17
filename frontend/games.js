(function () {
  const flow = window.GameFlow;
  if (!flow) {
    return;
  }
  if (!flow.ensureAuthenticated()) {
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

  function setStatus(text) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text;
  }

  function render() {
    const entry = flow.getSessionGameResults(sessionId);
    const done = flow.countCompletedGames(entry);
    const allDone = flow.allGamesCompleted(entry);

    if (doneEl) {
      doneEl.textContent = `${done}/${flow.GAME_KEYS.length}`;
    }

    chips.forEach((chip) => {
      const gameKey = chip.dataset.gameChip;
      const isDone = Boolean(entry[gameKey]);
      chip.textContent = isDone ? "已完成" : "未完成";
      chip.classList.toggle("is-done", isDone);
    });

    gameCards.forEach((card) => {
      const gameKey = card.dataset.game;
      card.classList.toggle("is-done", Boolean(entry[gameKey]));
      card.disabled = !sessionId;
    });

    if (goResultsButton) {
      goResultsButton.disabled = !sessionId || !allDone;
    }

    if (!sessionId) {
      setStatus("找不到 Session ID，請先完成測驗流程。");
      return;
    }

    if (allDone) {
      setStatus("三個遊戲均已完成，將自動前往結果分析。");
      if (autoRedirectTimer) {
        window.clearTimeout(autoRedirectTimer);
      }
      autoRedirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 2200);
    } else {
      setStatus("請點選卡片進入遊戲。");
      if (autoRedirectTimer) {
        window.clearTimeout(autoRedirectTimer);
        autoRedirectTimer = null;
      }
    }
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
