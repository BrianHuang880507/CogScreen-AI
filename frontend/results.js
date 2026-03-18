(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";
  const REPORT_CACHE_KEY = "reportCacheBySession";
  const API_ROOT = "/api";

  const DIMENSION_KEYS = ["cognitive", "logic", "reaction", "focus"];
  const DIMENSION_LABELS = {
    cognitive: "認知",
    logic: "邏輯",
    reaction: "反應",
    focus: "專注",
  };

  const sessionIdEl = document.getElementById("resultSessionId");
  const riskBadgeEl = document.getElementById("riskBadge");
  const summaryMessageEl = document.getElementById("summaryMessage");
  const statusEl = document.getElementById("resultsStatus");
  const needsFollowupEl = document.getElementById("needsFollowup");
  const avgVadEl = document.getElementById("avgVad");
  const avgWhisperEl = document.getElementById("avgWhisper");
  const accuracyRateEl = document.getElementById("accuracyRate");
  const instrumentCardsEl = document.getElementById("instrumentCards");
  const responsesBodyEl = document.getElementById("responsesBody");
  const disclaimerEl = document.getElementById("reportDisclaimer");
  const gamePanelEl = document.getElementById("gameScoresPanel");
  const gameScoresEl = document.getElementById("gameScores");
  const dailyRadarListEl = document.getElementById("dailyRadarList");

  const riskTextMap = {
    none: "低風險",
    mild: "輕度風險",
    moderate: "中度風險",
    severe: "高度風險",
  };
  const riskLevelMap = {
    none: 0,
    mild: 1,
    moderate: 2,
    severe: 3,
  };

  const severityTextMap = {
    none: "無",
    mild: "輕度",
    moderate: "中度",
    severe: "重度",
  };

  const logicDifficultyTextMap = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
  };

  function ensureAuthenticated() {
    if (sessionStorage.getItem(LOGIN_KEY) !== "true") {
      window.location.href = "/";
      return false;
    }
    return true;
  }

  function resolveSessionId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("session_id");
    if (fromQuery) {
      sessionStorage.setItem(REPORT_SESSION_KEY, fromQuery);
      return fromQuery;
    }
    return sessionStorage.getItem(REPORT_SESSION_KEY);
  }

  function setStatus(message) {
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  function average(values) {
    if (!values.length) {
      return null;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
  }

  function clampScore(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function formatMs(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "--";
    }
    return `${Math.round(value)} ms`;
  }

  function formatBandText(band) {
    if (!band) {
      return "--";
    }
    return riskTextMap[band] || band;
  }

  function formatSeverityText(band) {
    if (!band) {
      return "--";
    }
    return severityTextMap[band] || band;
  }

  function normalizeRiskBand(band) {
    if (!band) {
      return null;
    }
    const key = String(band).toLowerCase();
    return key in riskLevelMap ? key : null;
  }

  function mergeRiskBand(currentBand, nextBand) {
    const current = normalizeRiskBand(currentBand);
    const next = normalizeRiskBand(nextBand);
    if (!current) {
      return next;
    }
    if (!next) {
      return current;
    }
    return riskLevelMap[next] > riskLevelMap[current] ? next : current;
  }

  function inferRiskBandFromCognitive(score) {
    if (typeof score !== "number") {
      return null;
    }
    if (score >= 80) {
      return "none";
    }
    if (score >= 60) {
      return "mild";
    }
    if (score >= 40) {
      return "moderate";
    }
    return "severe";
  }

  function formatLogicDifficulty(value) {
    if (!value) {
      return "--";
    }
    return logicDifficultyTextMap[value] || value;
  }

  function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateLabel(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseDate(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  function loadJsonMap(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function saveJsonMap(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      return;
    }
  }

  function loadGameResultsMap() {
    return loadJsonMap(GAME_RESULTS_KEY);
  }

  function loadReportCacheMap() {
    return loadJsonMap(REPORT_CACHE_KEY);
  }

  function saveReportCacheMap(cache) {
    saveJsonMap(REPORT_CACHE_KEY, cache);
  }

  function applyRiskStyle(band) {
    if (!riskBadgeEl) {
      return;
    }
    riskBadgeEl.classList.remove(
      "risk-none",
      "risk-mild",
      "risk-moderate",
      "risk-severe",
    );
    riskBadgeEl.classList.add(`risk-${band || "none"}`);
  }

  function createInstrumentCard(title, rows) {
    const card = document.createElement("article");
    card.className = "instrument-card";
    const cardTitle = document.createElement("h3");
    cardTitle.textContent = title;
    card.appendChild(cardTitle);

    rows.forEach((row) => {
      const rowEl = document.createElement("p");
      rowEl.className = "instrument-row";
      rowEl.textContent = `${row.label}：${row.value}`;
      card.appendChild(rowEl);
    });
    return card;
  }

  function renderInstrumentScores(scores) {
    if (!instrumentCardsEl) {
      return;
    }
    instrumentCardsEl.innerHTML = "";

    const spmsq = scores.SPMSQ || {};
    instrumentCardsEl.appendChild(
      createInstrumentCard("SPMSQ", [
        {
          label: "錯誤數",
          value:
            spmsq.errors !== null && spmsq.errors !== undefined
              ? String(spmsq.errors)
              : "--",
        },
        { label: "風險分級", value: formatSeverityText(spmsq.severity_band) },
      ]),
    );
  }

  function textFromCorrectValue(value) {
    if (value === true) {
      return "是";
    }
    if (value === false) {
      return "否";
    }
    return "--";
  }

  function renderResponses(responses) {
    if (!responsesBodyEl) {
      return;
    }
    responsesBodyEl.innerHTML = "";
    if (!responses.length) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.textContent = "尚無作答資料。";
      emptyRow.appendChild(cell);
      responsesBodyEl.appendChild(emptyRow);
      return;
    }

    responses.forEach((item, index) => {
      const row = document.createElement("tr");
      const columns = [
        String(index + 1),
        item.instrument || "--",
        item.transcript || "--",
        formatMs(item.reaction_time_ms ? item.reaction_time_ms.vad : null),
        formatMs(item.reaction_time_ms ? item.reaction_time_ms.whisper : null),
        textFromCorrectValue(item.is_correct),
      ];
      columns.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      responsesBodyEl.appendChild(row);
    });
  }

  function createGameCard(title, lineOne, lineTwo, score) {
    const card = document.createElement("article");
    card.className = "game-score-card";

    const heading = document.createElement("h3");
    heading.textContent = title;
    card.appendChild(heading);

    const details = document.createElement("p");
    details.textContent = lineOne;
    card.appendChild(details);

    const details2 = document.createElement("p");
    details2.textContent = lineTwo;
    card.appendChild(details2);

    const scoreEl = document.createElement("strong");
    scoreEl.textContent = `得分 ${score}`;
    card.appendChild(scoreEl);

    return card;
  }

  function renderGameScores(sessionId) {
    if (!gameScoresEl || !gamePanelEl) {
      return;
    }
    gameScoresEl.innerHTML = "";
    const map = loadGameResultsMap();
    const entry = sessionId ? map[sessionId] : null;
    if (!entry || (!entry.logic && !entry.reaction && !entry.focus)) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "尚無遊戲記錄。";
      gameScoresEl.appendChild(empty);
      return;
    }

    if (entry.logic) {
      const levelTitle = entry.logic.level_title || "物件分類";
      const difficultyText = formatLogicDifficulty(entry.logic.difficulty);
      gameScoresEl.appendChild(
        createGameCard(
          "邏輯：物件分類",
          `正確數 ${entry.logic.correct}/${entry.logic.total}`,
          `難度 ${difficultyText}｜${levelTitle}`,
          entry.logic.score,
        ),
      );
    }
    if (entry.reaction) {
      gameScoresEl.appendChild(
        createGameCard(
          "反應：打地鼠",
          `命中 ${entry.reaction.hits} 次`,
          `失誤 ${entry.reaction.misses} 次`,
          entry.reaction.score,
        ),
      );
    }
    if (entry.focus) {
      gameScoresEl.appendChild(
        createGameCard(
          "專注：找不同",
          `找到 ${entry.focus.found}/${entry.focus.total}`,
          `耗時 ${entry.focus.elapsed_sec} 秒`,
          entry.focus.score,
        ),
      );
    }
  }

  function updateSummaryMetrics(report) {
    const responses = Array.isArray(report.responses) ? report.responses : [];
    const vadValues = [];
    const whisperValues = [];
    const judged = [];

    responses.forEach((item) => {
      const reaction = item.reaction_time_ms || {};
      if (typeof reaction.vad === "number") {
        vadValues.push(reaction.vad);
      }
      if (typeof reaction.whisper === "number") {
        whisperValues.push(reaction.whisper);
      }
      if (typeof item.is_correct === "boolean") {
        judged.push(item.is_correct);
      }
    });

    const avgVad = average(vadValues);
    const avgWhisper = average(whisperValues);
    const correct = judged.filter((value) => value).length;

    if (avgVadEl) {
      avgVadEl.textContent = avgVad === null ? "--" : formatMs(avgVad);
    }
    if (avgWhisperEl) {
      avgWhisperEl.textContent =
        avgWhisper === null ? "--" : formatMs(avgWhisper);
    }
    if (accuracyRateEl) {
      if (!judged.length) {
        accuracyRateEl.textContent = "--";
      } else {
        const rate = Math.round((correct / judged.length) * 100);
        accuracyRateEl.textContent = `${rate}% (${correct}/${judged.length})`;
      }
    }
  }

  function calculateCognitiveScore(report) {
    if (!report) {
      return null;
    }
    const spmsq = report.instrument_scores ? report.instrument_scores.SPMSQ : null;
    if (spmsq && typeof spmsq.errors === "number") {
      const score = 100 - spmsq.errors * 10;
      return Math.max(20, Math.min(100, Math.round(score)));
    }
    const band = report.summary ? report.summary.screening_risk_band : null;
    const riskScore = {
      none: 85,
      mild: 65,
      moderate: 45,
      severe: 25,
    };
    if (band && band in riskScore) {
      return riskScore[band];
    }
    return null;
  }

  function resolveSessionTimestamp(report, gameEntry) {
    const candidates = [];
    if (report && report.created_at) {
      candidates.push(report.created_at);
    }
    if (gameEntry && gameEntry.updated_at) {
      candidates.push(gameEntry.updated_at);
    }
    if (gameEntry && gameEntry.logic && gameEntry.logic.completed_at) {
      candidates.push(gameEntry.logic.completed_at);
    }
    if (gameEntry && gameEntry.reaction && gameEntry.reaction.completed_at) {
      candidates.push(gameEntry.reaction.completed_at);
    }
    if (gameEntry && gameEntry.focus && gameEntry.focus.completed_at) {
      candidates.push(gameEntry.focus.completed_at);
    }

    const dates = candidates
      .map((value) => parseDate(value))
      .filter((date) => date instanceof Date);
    if (!dates.length) {
      return null;
    }
    return dates.reduce((latest, date) => {
      if (!latest) {
        return date;
      }
      return date.getTime() > latest.getTime() ? date : latest;
    }, null);
  }

  function buildRadarRecord(sessionId, report, gameEntry) {
    const metrics = {
      cognitive: calculateCognitiveScore(report),
      logic: clampScore(gameEntry && gameEntry.logic ? gameEntry.logic.score : null),
      reaction: clampScore(gameEntry && gameEntry.reaction ? gameEntry.reaction.score : null),
      focus: clampScore(gameEntry && gameEntry.focus ? gameEntry.focus.score : null),
    };
    const hasAny = DIMENSION_KEYS.some(
      (key) => typeof metrics[key] === "number",
    );
    if (!hasAny) {
      return null;
    }
    const reportRiskBand = report && report.summary
      ? normalizeRiskBand(report.summary.screening_risk_band)
      : null;
    const inferredRiskBand = inferRiskBandFromCognitive(metrics.cognitive);
    const timestamp = resolveSessionTimestamp(report, gameEntry) || new Date();
    return {
      sessionId,
      timestamp,
      dateKey: formatDateKey(timestamp),
      dateLabel: formatDateLabel(timestamp),
      riskBand: reportRiskBand || inferredRiskBand,
      metrics,
    };
  }

  function groupRadarByDate(records) {
    const grouped = new Map();
    records.forEach((record) => {
      if (!grouped.has(record.dateKey)) {
        grouped.set(record.dateKey, {
          dateKey: record.dateKey,
          dateLabel: record.dateLabel,
          sessions: [],
        });
      }
      grouped.get(record.dateKey).sessions.push(record);
    });

    const output = Array.from(grouped.values()).map((group) => {
      const metrics = {};
      DIMENSION_KEYS.forEach((key) => {
        const values = group.sessions
          .map((session) => session.metrics[key])
          .filter((value) => typeof value === "number");
        metrics[key] =
          values.length > 0 ? Math.round(average(values) || 0) : null;
      });
      const latest = group.sessions.reduce((acc, item) => {
        if (!acc) {
          return item.timestamp;
        }
        return item.timestamp.getTime() > acc.getTime() ? item.timestamp : acc;
      }, null);
      const dateRiskBand = group.sessions.reduce((acc, session) => {
        return mergeRiskBand(acc, session.riskBand);
      }, null);
      return {
        dateKey: group.dateKey,
        dateLabel: group.dateLabel,
        sessionCount: group.sessions.length,
        riskBand: dateRiskBand,
        metrics,
        latestTimestamp: latest || new Date(),
      };
    });

    output.sort(
      (a, b) => b.latestTimestamp.getTime() - a.latestTimestamp.getTime(),
    );
    return output;
  }

  function polygonPoint(centerX, centerY, radius, index, total) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  }

  function drawRadar(canvas, metrics) {
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(260, Math.round(rect.width || 320));
    const height = Math.max(220, Math.round(rect.height || 260));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const labels = DIMENSION_KEYS.map((key) => DIMENSION_LABELS[key]);
    const total = labels.length;
    const centerX = width / 2;
    const centerY = height / 2 + 8;
    const radius = Math.min(width, height) * 0.34;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#d6deea";
    for (let ring = 1; ring <= 5; ring += 1) {
      const ringRadius = (radius * ring) / 5;
      ctx.beginPath();
      for (let i = 0; i < total; i += 1) {
        const point = polygonPoint(centerX, centerY, ringRadius, i, total);
        if (i === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.strokeStyle = "#c5cedf";
    for (let i = 0; i < total; i += 1) {
      const edge = polygonPoint(centerX, centerY, radius, i, total);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(edge.x, edge.y);
      ctx.stroke();
    }

    ctx.fillStyle = "#334155";
    ctx.font = "600 16px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    labels.forEach((label, index) => {
      const textPoint = polygonPoint(centerX, centerY, radius + 24, index, total);
      ctx.fillText(label, textPoint.x, textPoint.y + 6);
    });

    const values = DIMENSION_KEYS.map((key) => metrics[key]);
    const hasAnyValue = values.some((value) => typeof value === "number");
    if (!hasAnyValue) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 15px 'Noto Sans TC', sans-serif";
      ctx.fillText("此日期無可用資料", centerX, centerY + 6);
      return;
    }

    ctx.beginPath();
    values.forEach((value, index) => {
      const numericValue = typeof value === "number" ? value : 0;
      const point = polygonPoint(
        centerX,
        centerY,
        (radius * numericValue) / 100,
        index,
        total,
      );
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(37, 99, 235, 0.2)";
    ctx.fill();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#1d4ed8";
    values.forEach((value, index) => {
      if (typeof value !== "number") {
        return;
      }
      const point = polygonPoint(
        centerX,
        centerY,
        (radius * value) / 100,
        index,
        total,
      );
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function createValueCell(label, value) {
    const cell = document.createElement("div");
    cell.className = "date-radar-value";
    const labelEl = document.createElement("p");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = typeof value === "number" ? String(value) : "--";
    cell.appendChild(labelEl);
    cell.appendChild(valueEl);
    return cell;
  }

  function formatJudgementText(riskBand) {
    const normalized = normalizeRiskBand(riskBand);
    if (!normalized) {
      return "失智前兆初步判斷：資料不足";
    }
    return `失智前兆初步判斷：${formatBandText(normalized)}`;
  }

  function renderDateRadar(groups) {
    if (!dailyRadarListEl) {
      return;
    }
    dailyRadarListEl.innerHTML = "";
    if (!groups.length) {
      const empty = document.createElement("p");
      empty.className = "date-radar-empty";
      empty.textContent = "尚無可分析資料。請先完成測驗或遊戲。";
      dailyRadarListEl.appendChild(empty);
      return;
    }

    groups.forEach((group) => {
      const card = document.createElement("details");
      card.className = "date-radar-card";
      const summary = document.createElement("summary");
      summary.className = "date-radar-toggle";
      const summaryInfo = document.createElement("div");
      const dateEl = document.createElement("p");
      dateEl.className = "date-radar-date";
      dateEl.textContent = group.dateLabel;
      const judgement = document.createElement("p");
      judgement.className = "date-radar-judgement";
      judgement.textContent = formatJudgementText(group.riskBand);
      summaryInfo.appendChild(dateEl);
      summaryInfo.appendChild(judgement);
      summary.appendChild(summaryInfo);

      const body = document.createElement("div");
      body.className = "date-radar-body";
      const left = document.createElement("div");
      const head = document.createElement("div");
      head.className = "date-radar-head";
      const title = document.createElement("h3");
      title.className = "date-radar-title";
      title.textContent = "能力雷達圖";
      const meta = document.createElement("p");
      meta.className = "date-radar-meta";
      meta.textContent = `Sessions: ${group.sessionCount}`;
      head.appendChild(title);
      head.appendChild(meta);

      const radarWrap = document.createElement("div");
      radarWrap.className = "radar-wrap";
      const canvas = document.createElement("canvas");
      canvas.className = "date-radar-canvas";
      radarWrap.appendChild(canvas);

      left.appendChild(head);
      left.appendChild(radarWrap);

      const valuesGrid = document.createElement("div");
      valuesGrid.className = "date-radar-values";
      DIMENSION_KEYS.forEach((key) => {
        valuesGrid.appendChild(
          createValueCell(DIMENSION_LABELS[key], group.metrics[key]),
        );
      });

      body.appendChild(left);
      body.appendChild(valuesGrid);
      card.appendChild(summary);
      card.appendChild(body);
      dailyRadarListEl.appendChild(card);
      card.addEventListener("toggle", () => {
        if (card.open) {
          drawRadar(canvas, group.metrics);
        }
      });
    });
  }

  function getSessionIdsForTimeline(currentSessionId, gameResults, reportCache) {
    const ids = new Set();
    if (currentSessionId) {
      ids.add(currentSessionId);
    }
    Object.keys(gameResults).forEach((id) => {
      if (id) {
        ids.add(id);
      }
    });
    Object.keys(reportCache).forEach((id) => {
      if (id) {
        ids.add(id);
      }
    });
    return Array.from(ids);
  }

  async function fetchReport(sessionId) {
    const response = await fetch(`${API_ROOT}/sessions/${sessionId}/report`);
    if (!response.ok) {
      throw new Error(`Report API failed: ${response.status}`);
    }
    return response.json();
  }

  async function buildTimelineGroups(currentSessionId, currentReport) {
    const gameResults = loadGameResultsMap();
    const reportCache = loadReportCacheMap();

    if (currentSessionId && currentReport) {
      reportCache[currentSessionId] = currentReport;
      saveReportCacheMap(reportCache);
    }

    const sessionIds = getSessionIdsForTimeline(
      currentSessionId,
      gameResults,
      reportCache,
    );
    if (!sessionIds.length) {
      return [];
    }

    const records = [];
    let cacheUpdated = false;

    for (const sessionId of sessionIds) {
      const gameEntry = gameResults[sessionId] || null;
      let report = null;

      if (sessionId === currentSessionId && currentReport) {
        report = currentReport;
      } else if (reportCache[sessionId]) {
        report = reportCache[sessionId];
      } else {
        try {
          report = await fetchReport(sessionId);
          reportCache[sessionId] = report;
          cacheUpdated = true;
        } catch (error) {
          report = null;
        }
      }

      const record = buildRadarRecord(sessionId, report, gameEntry);
      if (record) {
        records.push(record);
      }
    }

    if (cacheUpdated) {
      saveReportCacheMap(reportCache);
    }
    return groupRadarByDate(records);
  }

  function applyReportToSummary(report) {
    const summary = report.summary || {};
    const riskBand = summary.screening_risk_band || "none";
    applyRiskStyle(riskBand);

    if (riskBadgeEl) {
      riskBadgeEl.textContent = formatBandText(riskBand);
    }
    if (summaryMessageEl) {
      summaryMessageEl.textContent = summary.message || "已完成報表分析。";
    }
    if (needsFollowupEl) {
      needsFollowupEl.textContent = summary.needs_followup ? "建議追蹤" : "暫無";
    }
    if (disclaimerEl) {
      disclaimerEl.textContent = report.disclaimer || disclaimerEl.textContent;
    }

    renderInstrumentScores(report.instrument_scores || {});
    renderResponses(Array.isArray(report.responses) ? report.responses : []);
    updateSummaryMetrics(report);
  }

  async function init() {
    if (!ensureAuthenticated()) {
      return;
    }

    const sessionId = resolveSessionId();
    if (sessionIdEl) {
      sessionIdEl.textContent = sessionId || "--";
    }
    renderGameScores(sessionId);

    let currentReport = null;
    if (!sessionId) {
      setStatus("找不到 Session ID，已顯示歷史日期分析。");
    } else {
      try {
        currentReport = await fetchReport(sessionId);
        applyReportToSummary(currentReport);
        setStatus("報表載入完成。");
      } catch (error) {
        setStatus("報表載入失敗，已顯示可用的歷史資料。");
      }
    }

    const timelineGroups = await buildTimelineGroups(sessionId, currentReport);
    renderDateRadar(timelineGroups);
  }

  window.addEventListener("resize", () => {
    if (!dailyRadarListEl) {
      return;
    }
    const cards = Array.from(dailyRadarListEl.querySelectorAll(".date-radar-card"));
    cards.forEach((card) => {
      const canvas = card.querySelector(".date-radar-canvas");
      if (!canvas) {
        return;
      }
      const values = {};
      const cells = Array.from(card.querySelectorAll(".date-radar-value strong"));
      DIMENSION_KEYS.forEach((key, index) => {
        const text = cells[index] ? cells[index].textContent : "";
        const parsed = Number.parseInt(text || "", 10);
        values[key] = Number.isFinite(parsed) ? parsed : null;
      });
      drawRadar(canvas, values);
    });
  });

  init();
})();
