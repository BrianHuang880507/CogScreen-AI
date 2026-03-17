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
  const startButton = document.getElementById("reactionStartButton");
  const timerEl = document.getElementById("reactionTimer");
  const hitsEl = document.getElementById("reactionHits");
  const missesEl = document.getElementById("reactionMisses");
  const gridEl = document.getElementById("reactionGrid");
  const resultEl = document.getElementById("reactionResult");

  let holes = [];
  let activeHole = -1;
  let hits = 0;
  let misses = 0;
  let running = false;
  let deadline = 0;
  let countdownTimer = null;
  let moleTimer = null;
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

  function renderStats() {
    if (timerEl) {
      let leftMs = 0;
      if (running) {
        leftMs = Math.max(0, deadline - Date.now());
      } else if (deadline === 0) {
        leftMs = 20000;
      }
      timerEl.textContent = (leftMs / 1000).toFixed(1);
    }
    if (hitsEl) {
      hitsEl.textContent = String(hits);
    }
    if (missesEl) {
      missesEl.textContent = String(misses);
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
    flow.saveSessionGameResult(sessionId, "reaction", payload);
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

  function setActiveHole(index) {
    activeHole = index;
    holes.forEach((hole, holeIndex) => {
      hole.classList.toggle("is-active", holeIndex === index);
    });
  }

  function chooseHole() {
    if (!running) {
      return;
    }
    let next = Math.floor(Math.random() * holes.length);
    if (next === activeHole) {
      next = (next + 1) % holes.length;
    }
    setActiveHole(next);
  }

  function stopGame() {
    running = false;
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (moleTimer) {
      window.clearInterval(moleTimer);
      moleTimer = null;
    }
    setActiveHole(-1);
    deadline = Date.now();
    renderStats();
    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = "再玩一次";
    }
    const score = Math.max(0, hits * 10 - misses * 2);
    if (resultEl) {
      resultEl.textContent = `時間到，命中 ${hits} 次、失誤 ${misses} 次，得分 ${score} 分。`;
    }
    onComplete({
      hits,
      misses,
      score,
      duration_sec: 20,
      completed_at: new Date().toISOString(),
    });
  }

  function startGame() {
    if (running) {
      return;
    }
    clearRedirect();
    running = true;
    hits = 0;
    misses = 0;
    deadline = Date.now() + 20000;
    if (resultEl) {
      resultEl.textContent = "遊戲進行中...";
    }
    if (startButton) {
      startButton.disabled = true;
      startButton.textContent = "進行中";
    }
    setStatus("請盡快點擊目標。");
    renderStats();
    chooseHole();
    countdownTimer = window.setInterval(() => {
      renderStats();
      if (Date.now() >= deadline) {
        stopGame();
      }
    }, 100);
    moleTimer = window.setInterval(() => {
      chooseHole();
    }, 650);
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.reaction || !resultEl) {
      return;
    }
    resultEl.textContent = `上次結果：命中 ${entry.reaction.hits} 次、失誤 ${entry.reaction.misses} 次，得分 ${entry.reaction.score} 分。`;
  }

  function setupGrid() {
    if (!gridEl) {
      return;
    }
    gridEl.innerHTML = "";
    holes = [];
    for (let i = 0; i < 9; i += 1) {
      const hole = document.createElement("button");
      hole.type = "button";
      hole.className = "whack-hole";
      hole.textContent = "洞";
      hole.addEventListener("click", () => {
        if (!running) {
          return;
        }
        if (i === activeHole) {
          hits += 1;
          setActiveHole(-1);
        } else {
          misses += 1;
        }
        renderStats();
      });
      gridEl.appendChild(hole);
      holes.push(hole);
    }
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

  setupGrid();
  renderProgress();
  hydrate();
  renderStats();
  if (startButton) {
    startButton.addEventListener("click", () => {
      startGame();
    });
  }
})();
