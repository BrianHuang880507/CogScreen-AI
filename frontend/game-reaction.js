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
  const difficultyPickerEl = document.getElementById("reactionDifficultyPicker");
  const difficultyButtons = Array.from(document.querySelectorAll("[data-difficulty]"));
  const speedHintEl = document.getElementById("reactionSpeedHint");
  const arenaEl = document.getElementById("reactionArena");
  const hammerEl = document.getElementById("reactionHammer");
  const smashAudioEl = document.getElementById("reactionSmashAudio");
  const resultEl = document.getElementById("reactionResult");

  const MOLE_IMAGE = "/static/images/games/whack-a-mole/mole.png";
  const MOLE_WHACKED_IMAGE = "/static/images/games/whack-a-mole/mole-whacked.png";
  const DIFFICULTY_CONFIG = {
    easy: { label: "簡單", intervalMs: 1700, speedText: "慢" },
    medium: { label: "中等", intervalMs: 1400, speedText: "中慢" },
    hard: { label: "困難", intervalMs: 1100, speedText: "中" },
  };

  let holes = [];
  let activeHole = -1;
  let hits = 0;
  let misses = 0;
  let running = false;
  let deadline = 0;
  let countdownTimer = null;
  let moleTimer = null;
  let redirectTimer = null;
  let selectedDifficulty = "easy";

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

  function getDifficultyConfig() {
    return DIFFICULTY_CONFIG[selectedDifficulty] || DIFFICULTY_CONFIG.easy;
  }

  function renderDifficulty() {
    const config = getDifficultyConfig();
    difficultyButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.difficulty === selectedDifficulty);
      button.disabled = running;
    });
    if (speedHintEl) {
      speedHintEl.textContent = `速度：${config.speedText}`;
    }
  }

  function setDifficulty(nextDifficulty) {
    if (running || !DIFFICULTY_CONFIG[nextDifficulty]) {
      return;
    }
    selectedDifficulty = nextDifficulty;
    renderDifficulty();
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

  function playSmashSound() {
    if (!smashAudioEl) {
      return;
    }
    smashAudioEl.currentTime = 0;
    smashAudioEl.play().catch(() => {});
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
    const config = getDifficultyConfig();
    if (resultEl) {
      resultEl.textContent = `時間到（${config.label}），命中 ${hits} 次、失誤 ${misses} 次，得分 ${score} 分。`;
    }
    onComplete({
      hits,
      misses,
      score,
      difficulty: selectedDifficulty,
      speed_ms: config.intervalMs,
      duration_sec: 20,
      completed_at: new Date().toISOString(),
    });
    renderDifficulty();
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
    holes.forEach((hole) => {
      hole.classList.remove("is-whacked", "is-missed");
    });
    const config = getDifficultyConfig();
    setStatus(`目前難度：${config.label}，請盡快點擊目標。`);
    renderStats();
    renderDifficulty();
    chooseHole();
    countdownTimer = window.setInterval(() => {
      renderStats();
      if (Date.now() >= deadline) {
        stopGame();
      }
    }, 100);
    moleTimer = window.setInterval(() => {
      chooseHole();
    }, config.intervalMs);
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.reaction || !resultEl) {
      return;
    }
    const difficultyText = entry.reaction.difficulty
      ? (DIFFICULTY_CONFIG[entry.reaction.difficulty]?.label || entry.reaction.difficulty)
      : "未記錄";
    resultEl.textContent = `上次結果：命中 ${entry.reaction.hits} 次、失誤 ${entry.reaction.misses} 次，得分 ${entry.reaction.score} 分（${difficultyText}）。`;
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
      hole.innerHTML = `
        <span class="hole-shadow" aria-hidden="true"></span>
        <img class="mole-sprite mole-base" src="${MOLE_IMAGE}" alt="" aria-hidden="true" />
        <img class="mole-sprite mole-whacked" src="${MOLE_WHACKED_IMAGE}" alt="" aria-hidden="true" />
      `;
      hole.setAttribute("aria-label", `打地鼠洞口 ${i + 1}`);
      hole.addEventListener("click", () => {
        if (!running) {
          return;
        }
        if (i === activeHole) {
          hits += 1;
          playSmashSound();
          hole.classList.add("is-whacked");
          window.setTimeout(() => {
            hole.classList.remove("is-whacked");
          }, 180);
          setActiveHole(-1);
        } else {
          misses += 1;
          hole.classList.add("is-missed");
          window.setTimeout(() => {
            hole.classList.remove("is-missed");
          }, 120);
        }
        renderStats();
      });
      gridEl.appendChild(hole);
      holes.push(hole);
    }
  }

  function setupHammerMotion() {
    if (!arenaEl || !hammerEl) {
      return;
    }
    const moveHammer = (event) => {
      const rect = arenaEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      hammerEl.style.setProperty("--hammer-x", `${x}px`);
      hammerEl.style.setProperty("--hammer-y", `${y}px`);
    };
    arenaEl.addEventListener("pointermove", moveHammer);
    arenaEl.addEventListener("pointerdown", () => {
      hammerEl.classList.add("is-smashing");
      window.setTimeout(() => {
        hammerEl.classList.remove("is-smashing");
      }, 100);
    });
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

  if (difficultyPickerEl) {
    difficultyPickerEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-difficulty]");
      if (!button) {
        return;
      }
      setDifficulty(button.dataset.difficulty || "");
    });
  }

  setupGrid();
  setupHammerMotion();
  renderProgress();
  hydrate();
  renderStats();
  renderDifficulty();
  if (startButton) {
    startButton.addEventListener("click", () => {
      startGame();
    });
  }
})();
