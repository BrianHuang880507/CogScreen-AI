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

  const LEGACY_MOLE_IMAGE = "/static/images/games/whack-a-mole/mole.png";
  const LEGACY_MOLE_WHACKED_IMAGE = "/static/images/games/whack-a-mole/mole-whacked.png";
  const LEGACY_HAMMER_IMAGE = "/static/images/games/whack-a-mole/hammer.png";
  const FRAME_MS = 45;

  const padFrameNumber = (value) => String(value).padStart(4, "0");
  const buildFramePath = (prefix, frameNumber) =>
    `/static/images/games/whack-a-mole/${prefix}_${padFrameNumber(frameNumber)}.png`;
  const buildFrameRange = (prefix, start, end) => {
    const frames = [];
    for (let value = start; value <= end; value += 1) {
      frames.push(buildFramePath(prefix, value));
    }
    return frames;
  };

  let moleEmergeFrames = buildFrameRange("mole", 1, 6);
  let moleWhackedFrames = buildFrameRange("mole", 37, 44);
  let hammerFrames = buildFrameRange("hammer", 1, 4);
  let moleHoleImage = moleEmergeFrames[0];
  const DIFFICULTY_CONFIG = {
    easy: { label: "Easy", intervalMs: 1700, speedText: "slow" },
    medium: { label: "Medium", intervalMs: 1400, speedText: "normal" },
    hard: { label: "Hard", intervalMs: 1100, speedText: "fast" },
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
  let hammerResetTimer = null;
  const animationState = new WeakMap();

  function getState(node) {
    if (!animationState.has(node)) {
      animationState.set(node, {});
    }
    return animationState.get(node);
  }

  function clearTimer(timerId) {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  }

  function preloadFrameCandidates(candidates, fallbackFrame) {
    const pending = candidates.map(
      (path) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(path);
          img.onerror = () => resolve(null);
          img.src = path;
        })
    );
    return Promise.all(pending).then((loaded) => {
      const available = loaded.filter(Boolean);
      if (available.length > 0) {
        return available;
      }
      return fallbackFrame ? [fallbackFrame] : [];
    });
  }

  function preloadAnimationAssets() {
    return Promise.all([
      preloadFrameCandidates(moleEmergeFrames, LEGACY_MOLE_IMAGE),
      preloadFrameCandidates(moleWhackedFrames, LEGACY_MOLE_WHACKED_IMAGE),
      preloadFrameCandidates(hammerFrames, LEGACY_HAMMER_IMAGE),
    ]).then(([loadedEmerge, loadedWhacked, loadedHammer]) => {
      moleEmergeFrames = loadedEmerge;
      moleWhackedFrames = loadedWhacked;
      hammerFrames = loadedHammer;
      moleHoleImage = moleEmergeFrames[0] || LEGACY_MOLE_IMAGE;
      if (hammerEl && hammerFrames[0]) {
        hammerEl.src = hammerFrames[0];
      }
    });
  }

  function playFrameSequence(imageEl, frames, frameMs = FRAME_MS) {
    if (!imageEl || !frames.length) {
      return () => {};
    }
    let timerId = null;
    let canceled = false;
    const tick = (index) => {
      if (canceled) {
        return;
      }
      imageEl.src = frames[index];
      if (index < frames.length - 1) {
        timerId = window.setTimeout(() => tick(index + 1), frameMs);
      }
    };
    tick(0);
    return () => {
      canceled = true;
      clearTimer(timerId);
    };
  }

  function getHoleElements(hole) {
    return {
      baseEl: hole.querySelector(".mole-base"),
      whackedEl: hole.querySelector(".mole-whacked"),
    };
  }

  function setHoleBaseFrame(hole, framePath) {
    const { baseEl } = getHoleElements(hole);
    if (baseEl && framePath) {
      baseEl.src = framePath;
    }
  }

  function setHoleWhackedFrame(hole, framePath) {
    const { whackedEl } = getHoleElements(hole);
    if (whackedEl && framePath) {
      whackedEl.src = framePath;
    }
  }

  function stopHoleAnimations(hole) {
    const state = getState(hole);
    if (state.cancelEmerge) {
      state.cancelEmerge();
      state.cancelEmerge = null;
    }
    if (state.cancelWhacked) {
      state.cancelWhacked();
      state.cancelWhacked = null;
    }
    clearTimer(state.whackedResetTimer);
    state.whackedResetTimer = null;
  }

  function runEmergeAnimation(hole) {
    stopHoleAnimations(hole);
    setHoleBaseFrame(hole, moleEmergeFrames[0]);
    const { baseEl } = getHoleElements(hole);
    const state = getState(hole);
    state.cancelEmerge = playFrameSequence(baseEl, moleEmergeFrames);
  }

  function runWhackedAnimation(hole) {
    stopHoleAnimations(hole);
    setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    const { whackedEl } = getHoleElements(hole);
    const state = getState(hole);
    state.cancelWhacked = playFrameSequence(whackedEl, moleWhackedFrames);
    const duration = Math.max(FRAME_MS * moleWhackedFrames.length + 24, 120);
    state.whackedResetTimer = window.setTimeout(() => {
      hole.classList.remove("is-whacked");
      stopHoleAnimations(hole);
      setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    }, duration);
  }

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
      speedHintEl.textContent = `Speed: ${config.speedText}`;
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
      setStatus("All mini-games completed. Redirecting to report...");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1500);
      return;
    }
    setStatus("Reaction game completed. Returning to game hub...");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1500);
  }

  function setActiveHole(index) {
    activeHole = index;
    holes.forEach((hole, holeIndex) => {
      const isActive = holeIndex === index;
      hole.classList.toggle("is-active", isActive);
      if (isActive) {
        hole.classList.remove("is-whacked");
        setHoleWhackedFrame(hole, moleWhackedFrames[0]);
        runEmergeAnimation(hole);
      } else if (!hole.classList.contains("is-whacked")) {
        stopHoleAnimations(hole);
        setHoleBaseFrame(hole, moleEmergeFrames[0]);
      }
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
    if (!running || !holes.length) {
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
    holes.forEach((hole) => {
      stopHoleAnimations(hole);
      hole.classList.remove("is-active", "is-whacked", "is-missed");
      setHoleBaseFrame(hole, moleEmergeFrames[0]);
      setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    });
    clearTimer(hammerResetTimer);
    hammerResetTimer = null;
    if (hammerEl) {
      const hammerState = getState(hammerEl);
      if (hammerState.cancelSwing) {
        hammerState.cancelSwing();
        hammerState.cancelSwing = null;
      }
      hammerEl.classList.remove("is-smashing");
      hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
    }
    deadline = Date.now();
    renderStats();
    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = "Play Again";
    }
    const score = Math.max(0, hits * 10 - misses * 2);
    const config = getDifficultyConfig();
    if (resultEl) {
      resultEl.textContent = `Finished (${config.label}) - Hits ${hits}, Misses ${misses}, Score ${score}`;
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
    if (running || !holes.length) {
      return;
    }
    clearRedirect();
    running = true;
    hits = 0;
    misses = 0;
    deadline = Date.now() + 20000;
    if (resultEl) {
      resultEl.textContent = "Game running...";
    }
    if (startButton) {
      startButton.disabled = true;
      startButton.textContent = "Running";
    }
    holes.forEach((hole) => {
      stopHoleAnimations(hole);
      hole.classList.remove("is-active", "is-whacked", "is-missed");
      setHoleBaseFrame(hole, moleEmergeFrames[0]);
      setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    });
    const config = getDifficultyConfig();
    setStatus(`Difficulty: ${config.label}. Whack as many moles as you can in 20 seconds.`);
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
      : "Unknown";
    resultEl.textContent = `Last result - Hits ${entry.reaction.hits}, Misses ${entry.reaction.misses}, Score ${entry.reaction.score} (${difficultyText})`;
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
        <img class="hole-mouth" src="${moleHoleImage}" alt="" aria-hidden="true" />
        <img class="mole-sprite mole-base" src="${moleEmergeFrames[0] || LEGACY_MOLE_IMAGE}" alt="" aria-hidden="true" />
        <img class="mole-sprite mole-whacked" src="${moleWhackedFrames[0] || LEGACY_MOLE_WHACKED_IMAGE}" alt="" aria-hidden="true" />
      `;
      hole.setAttribute("aria-label", `Whack-a-mole hole ${i + 1}`);
      hole.addEventListener("click", () => {
        if (!running) {
          return;
        }
        triggerHammerSmash();
        if (i === activeHole) {
          hits += 1;
          playSmashSound();
          setActiveHole(-1);
          hole.classList.add("is-whacked");
          runWhackedAnimation(hole);
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

  function triggerHammerSmash() {
    if (!hammerEl || !hammerFrames.length) {
      return;
    }
    const state = getState(hammerEl);
    if (state.cancelSwing) {
      state.cancelSwing();
      state.cancelSwing = null;
    }
    clearTimer(hammerResetTimer);
    hammerEl.classList.add("is-smashing");
    state.cancelSwing = playFrameSequence(hammerEl, hammerFrames);
    hammerResetTimer = window.setTimeout(() => {
      if (state.cancelSwing) {
        state.cancelSwing();
        state.cancelSwing = null;
      }
      hammerEl.classList.remove("is-smashing");
      hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
      hammerResetTimer = null;
    }, FRAME_MS * hammerFrames.length + 28);
  }

  function setupHammerMotion() {
    if (!arenaEl || !hammerEl) {
      return;
    }
    hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
    const moveHammer = (event) => {
      const rect = arenaEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      hammerEl.style.setProperty("--hammer-x", `${x}px`);
      hammerEl.style.setProperty("--hammer-y", `${y}px`);
    };
    arenaEl.addEventListener("pointermove", moveHammer);
    arenaEl.addEventListener("pointerdown", () => {
      triggerHammerSmash();
    });
    arenaEl.addEventListener("pointerleave", () => {
      const state = getState(hammerEl);
      if (state.cancelSwing) {
        state.cancelSwing();
        state.cancelSwing = null;
      }
      clearTimer(hammerResetTimer);
      hammerResetTimer = null;
      hammerEl.classList.remove("is-smashing");
      hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
    });
  }

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }
  if (backToGames) {
    backToGames.href = flow.buildGameHubUrl(sessionId);
  }

  if (!sessionId) {
    setStatus("Missing Session ID. Please return and start a new session.");
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

  if (startButton) {
    startButton.addEventListener("click", () => {
      startGame();
    });
  }

  preloadAnimationAssets()
    .catch(() => {
      moleEmergeFrames = [LEGACY_MOLE_IMAGE];
      moleWhackedFrames = [LEGACY_MOLE_WHACKED_IMAGE];
      hammerFrames = [LEGACY_HAMMER_IMAGE];
      moleHoleImage = LEGACY_MOLE_IMAGE;
      if (hammerEl) {
        hammerEl.src = LEGACY_HAMMER_IMAGE;
      }
    })
    .finally(() => {
      setupGrid();
      setupHammerMotion();
      renderProgress();
      hydrate();
      renderStats();
      renderDifficulty();
    });
})();
