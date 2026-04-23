(function () {
  const flow = window.GameFlow;
  if (!flow || !flow.ensureAuthenticated()) {
    return;
  }

  const sessionId = flow.resolveSessionId();
  const sessionIdEl = document.getElementById("gameSessionId");
  const doneEl = document.getElementById("gamesDone");
  const statusEl = document.getElementById("gameStatus");
  const backToGames = document.getElementById("backToGames");
  const startButton = document.getElementById("reactionStartButton");
  const startOverlayEl = document.getElementById("reactionStartOverlay");
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

  // Tunable senior-friendly rhythm. One round is rest -> cue -> visible.
  const WHACK_TIMING = {
    durationSec: 120,
    frameMs: 80,
    difficulty: {
      easy: {
        label: "慢速",
        cueMs: 1800,
        visibleMs: 2600,
        restMs: 1400,
        hint: "洞口會先亮 1.8 秒，再慢慢出現。",
      },
      medium: {
        label: "一般",
        cueMs: 1500,
        visibleMs: 2300,
        restMs: 1200,
        hint: "洞口會先亮 1.5 秒，再慢慢出現。",
      },
      hard: {
        label: "稍快",
        cueMs: 1200,
        visibleMs: 2000,
        restMs: 1000,
        hint: "仍保留提示，只是出現節奏稍快。",
      },
    },
  };

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
  let holes = [];
  let cueHole = -1;
  let activeHole = -1;
  let hits = 0;
  let misses = 0;
  let running = false;
  let deadline = 0;
  let countdownTimer = null;
  let redirectTimer = null;
  let selectedDifficulty = "easy";
  let hammerResetTimer = null;
  let eventLog = [];
  let startedAtIso = null;
  let pendingTimers = [];
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

  function queueTimer(callback, delay) {
    const id = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((timerId) => timerId !== id);
      callback();
    }, delay);
    pendingTimers.push(id);
    return id;
  }

  function clearPendingTimers() {
    pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
    pendingTimers = [];
  }

  function preloadFrameCandidates(candidates, fallbackFrame) {
    const pending = candidates.map(
      (path) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(path);
          img.onerror = () => resolve(null);
          img.src = path;
        }),
    );
    return Promise.all(pending).then((loaded) => {
      const available = loaded.filter(Boolean);
      return available.length > 0 ? available : fallbackFrame ? [fallbackFrame] : [];
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

  function playFrameSequence(imageEl, frames, frameMs = WHACK_TIMING.frameMs) {
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
    const duration = Math.max(WHACK_TIMING.frameMs * moleWhackedFrames.length + 80, 300);
    state.whackedResetTimer = window.setTimeout(() => {
      hole.classList.remove("is-whacked");
      stopHoleAnimations(hole);
      setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    }, duration);
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  function requiredCount() {
    return Array.isArray(flow.REQUIRED_CATEGORIES)
      ? flow.REQUIRED_CATEGORIES.length
      : flow.GAME_KEYS.length;
  }

  function renderProgress() {
    const entry = flow.getSessionGameResults(sessionId);
    if (doneEl) {
      doneEl.textContent = `${flow.countCompletedGames(entry)}/${requiredCount()}`;
    }
  }

  function renderStats() {
    if (timerEl) {
      const leftMs = running ? Math.max(0, deadline - Date.now()) : WHACK_TIMING.durationSec * 1000;
      timerEl.textContent = flow.formatDuration(leftMs / 1000);
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
    return WHACK_TIMING.difficulty[selectedDifficulty] || WHACK_TIMING.difficulty.easy;
  }

  function renderDifficulty() {
    const config = getDifficultyConfig();
    difficultyButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.difficulty === selectedDifficulty);
      button.disabled = running;
    });
    if (speedHintEl) {
      speedHintEl.textContent = config.hint;
    }
  }

  function setStartOverlayVisible(visible) {
    if (startOverlayEl) {
      startOverlayEl.classList.toggle("hidden", !visible);
    }
  }

  function setDifficulty(nextDifficulty) {
    if (running || !WHACK_TIMING.difficulty[nextDifficulty]) {
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
      setStatus("四類遊戲都完成了，正在前往結果分析。");
      redirectTimer = window.setTimeout(() => {
        window.location.href = flow.buildResultsUrl(sessionId);
      }, 1800);
      return;
    }
    setStatus("打地鼠完成，正在回到遊戲選單。");
    redirectTimer = window.setTimeout(() => {
      window.location.href = flow.buildGameHubUrl(sessionId);
    }, 1800);
  }

  function resetHoleVisuals() {
    cueHole = -1;
    activeHole = -1;
    holes.forEach((hole) => {
      stopHoleAnimations(hole);
      hole.classList.remove("is-cue", "is-active", "is-whacked", "is-missed");
      setHoleBaseFrame(hole, moleEmergeFrames[0]);
      setHoleWhackedFrame(hole, moleWhackedFrames[0]);
    });
  }

  function setCueHole(index) {
    cueHole = index;
    activeHole = -1;
    holes.forEach((hole, holeIndex) => {
      const isCue = holeIndex === index;
      hole.classList.toggle("is-cue", isCue);
      hole.classList.remove("is-active");
      if (!isCue && !hole.classList.contains("is-whacked")) {
        stopHoleAnimations(hole);
        setHoleBaseFrame(hole, moleEmergeFrames[0]);
      }
    });
  }

  function setActiveHole(index) {
    activeHole = index;
    cueHole = -1;
    holes.forEach((hole, holeIndex) => {
      const isActive = holeIndex === index;
      hole.classList.toggle("is-active", isActive);
      hole.classList.remove("is-cue");
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

  function chooseNextHole() {
    if (!holes.length) {
      return -1;
    }
    let next = Math.floor(Math.random() * holes.length);
    if (next === activeHole || next === cueHole) {
      next = (next + 1) % holes.length;
    }
    return next;
  }

  function scheduleNextMole(delayMs = getDifficultyConfig().restMs) {
    if (!running) {
      return;
    }
    const config = getDifficultyConfig();
    queueTimer(() => {
      if (!running || Date.now() >= deadline) {
        finishGame();
        return;
      }
      const next = chooseNextHole();
      setCueHole(next);
      setStatus("亮起來的洞口等一下會出現地鼠。");
      eventLog.push({
        type: "cue",
        hole_index: next,
        at: new Date().toISOString(),
        remaining_ms: Math.max(0, deadline - Date.now()),
      });
      queueTimer(() => {
        if (!running || Date.now() >= deadline) {
          finishGame();
          return;
        }
        setActiveHole(next);
        setStatus("地鼠出現了，可以點它。");
        eventLog.push({
          type: "spawn",
          hole_index: next,
          at: new Date().toISOString(),
          remaining_ms: Math.max(0, deadline - Date.now()),
        });
        queueTimer(() => {
          if (!running) {
            return;
          }
          if (activeHole === next) {
            setActiveHole(-1);
          }
          scheduleNextMole(config.restMs);
        }, config.visibleMs);
      }, config.cueMs);
    }, delayMs);
  }

  function finishGame() {
    if (!running && deadline !== 0) {
      return;
    }
    running = false;
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    clearPendingTimers();
    resetHoleVisuals();
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
    setStartOverlayVisible(true);
    const score = Math.max(0, hits * 10 - misses * 2);
    const endedAt = new Date();
    const config = getDifficultyConfig();
    const payload = {
      hits,
      misses,
      score,
      difficulty: selectedDifficulty,
      cue_ms: config.cueMs,
      visible_ms: config.visibleMs,
      rest_ms: config.restMs,
      duration_sec: WHACK_TIMING.durationSec,
      completed_at: endedAt.toISOString(),
      details: {
        started_at: startedAtIso,
        ended_at: endedAt.toISOString(),
        total_events: eventLog.length,
        events: [...eventLog],
      },
    };
    const pointAward = flow.awardGamePoints(sessionId, "reaction", payload);
    if (resultEl) {
      resultEl.textContent = `完成 ${config.label} 模式，命中 ${hits} 次、誤點 ${misses} 次，原遊戲分數 ${score}，本次獲得 ${pointAward.points} 點。`;
    }
    onComplete(payload);
    renderDifficulty();
  }

  function startGame() {
    if (running || !holes.length) {
      return;
    }
    clearRedirect();
    clearPendingTimers();
    running = true;
    hits = 0;
    misses = 0;
    eventLog = [];
    startedAtIso = new Date().toISOString();
    deadline = Date.now() + WHACK_TIMING.durationSec * 1000;
    resetHoleVisuals();
    setStartOverlayVisible(false);
    renderStats();
    renderDifficulty();
    const config = getDifficultyConfig();
    setStatus(`${config.label}模式開始，總時間 ${flow.formatDuration(WHACK_TIMING.durationSec)}。先看提示光圈，再點出現的地鼠。`);
    if (resultEl) {
      resultEl.textContent = "遊戲進行中。";
    }
    countdownTimer = window.setInterval(() => {
      renderStats();
      if (Date.now() >= deadline) {
        finishGame();
      }
    }, 250);
    scheduleNextMole(600);
  }

  function hydrate() {
    const entry = flow.getSessionGameResults(sessionId);
    if (!entry.reaction || !resultEl) {
      return;
    }
    const difficultyText = WHACK_TIMING.difficulty[entry.reaction.difficulty || ""]?.label || "--";
    resultEl.textContent = `上次結果：${difficultyText}，命中 ${entry.reaction.hits} 次，誤點 ${entry.reaction.misses} 次，原遊戲分數 ${entry.reaction.score}。`;
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
      hole.setAttribute("aria-label", `第 ${i + 1} 個洞口`);
      hole.addEventListener("click", () => {
        if (!running) {
          return;
        }
        triggerHammerSmash();
        const nowIso = new Date().toISOString();
        const remainingMs = Math.max(0, deadline - Date.now());
        if (i === activeHole) {
          hits += 1;
          eventLog.push({
            type: "hit",
            hole_index: i,
            at: nowIso,
            remaining_ms: remainingMs,
          });
          playSmashSound();
          setActiveHole(-1);
          hole.classList.add("is-whacked");
          runWhackedAnimation(hole);
          setStatus("打中了。請等下一個提示光圈。");
          clearPendingTimers();
          scheduleNextMole(getDifficultyConfig().restMs);
        } else if (i !== cueHole) {
          misses += 1;
          eventLog.push({
            type: "miss",
            hole_index: i,
            target_hole_index: activeHole,
            cue_hole_index: cueHole,
            at: nowIso,
            remaining_ms: remainingMs,
          });
          hole.classList.add("is-missed");
          setStatus("先看亮起來的洞口，再點地鼠。");
          window.setTimeout(() => {
            hole.classList.remove("is-missed");
          }, 280);
        } else {
          setStatus("提示洞口亮起中，請等地鼠探出來再點。");
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
    }, WHACK_TIMING.frameMs * hammerFrames.length + 80);
  }

  function setupHammerMotion() {
    if (!arenaEl || !hammerEl) {
      return;
    }
    hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
    let activePointerId = null;

    const moveHammer = (event) => {
      if (!event) {
        return;
      }
      const rect = arenaEl.getBoundingClientRect();
      hammerEl.style.setProperty("--hammer-x", `${event.clientX - rect.left}px`);
      hammerEl.style.setProperty("--hammer-y", `${event.clientY - rect.top}px`);
    };

    const resetHammerState = () => {
      const state = getState(hammerEl);
      if (state.cancelSwing) {
        state.cancelSwing();
        state.cancelSwing = null;
      }
      clearTimer(hammerResetTimer);
      hammerResetTimer = null;
      hammerEl.classList.remove("is-smashing");
      hammerEl.src = hammerFrames[0] || LEGACY_HAMMER_IMAGE;
      arenaEl.classList.remove("is-pointer-active");
      activePointerId = null;
    };

    const handlePointerMove = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      moveHammer(event);
      arenaEl.classList.add("is-pointer-active");
    };

    const handlePointerEnd = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      resetHammerState();
    };

    arenaEl.addEventListener("pointermove", handlePointerMove);
    arenaEl.addEventListener("pointerdown", (event) => {
      if (!running) {
        return;
      }
      activePointerId = event.pointerId;
      handlePointerMove(event);
      triggerHammerSmash();
    });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerEnd, { passive: true });
    window.addEventListener("pointercancel", handlePointerEnd, { passive: true });
    arenaEl.addEventListener("pointerleave", () => {
      if (activePointerId === null) {
        arenaEl.classList.remove("is-pointer-active");
      }
    });
  }

  if (sessionIdEl) {
    sessionIdEl.textContent = sessionId || "--";
  }
  if (backToGames) {
    backToGames.href = flow.buildGameHubUrl(sessionId);
  }
  if (!sessionId) {
    setStatus("缺少 Session ID，請回到遊戲選單重新進入。");
  }
  if (difficultyPickerEl) {
    difficultyPickerEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-difficulty]");
      if (button) {
        setDifficulty(button.dataset.difficulty || "");
      }
    });
  }
  if (startButton) {
    startButton.addEventListener("click", startGame);
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
      setStartOverlayVisible(true);
      if (resultEl && !resultEl.textContent) {
        resultEl.textContent = "按下開始後，先看洞口提示，再點出現的地鼠。";
      }
      if (statusEl && !statusEl.textContent) {
        setStatus("請選擇速度後按開始。");
      }
    });
})();
