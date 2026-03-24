(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";
  const REPORT_CACHE_KEY = "reportCacheBySession";
  const API_ROOT = "/api";

  const DIMENSION_KEYS = ["cognitive", "logic", "reaction", "focus", "memory"];
  const DIMENSION_LABELS = {
    cognitive: "認知",
    logic: "邏輯",
    reaction: "反應",
    focus: "專注",
    memory: "記憶",
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
  const csvExportHintEl = document.getElementById("csvExportHint");
  const spmsqIncompleteListEl = document.getElementById("spmsqIncompleteList");

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

  let currentExportSessionId = null;
  let currentExportReport = null;

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


  function resolveViewerContext() {
    return {
      viewerPatientId: sessionStorage.getItem("userSessionId") || "",
      isGlobalViewer: sessionStorage.getItem("isGlobalViewer") === "true",
    };
  }

  async function fetchSessionDirectory(viewerContext) {
    const params = new URLSearchParams();
    if (!viewerContext.isGlobalViewer && viewerContext.viewerPatientId) {
      params.set("patient_id", viewerContext.viewerPatientId);
    }
    params.set("limit", "400");
    const query = params.toString();
    const url = `${API_ROOT}/sessions${query ? `?${query}` : ""}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        return [];
      }
      return data
        .filter((item) => item && item.session_id)
        .map((item) => ({
          session_id: String(item.session_id),
          patient_id: item.patient_id ? String(item.patient_id) : "",
          patient_name: item.patient_name ? String(item.patient_name) : "",
          patient_gender: item.patient_gender ? String(item.patient_gender) : "",
          created_at: item.created_at || "",
        }));
    } catch (error) {
      return [];
    }
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

  function resolveGameScore(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (typeof payload.score !== "number" || !Number.isFinite(payload.score)) {
      return null;
    }
    return payload.score;
  }

  function resolveLogicMetric(gameEntry) {
    if (!gameEntry || typeof gameEntry !== "object") {
      return null;
    }
    const candidates = [
      resolveGameScore(gameEntry.logic),
      resolveGameScore(gameEntry.sequence),
    ].filter((value) => typeof value === "number");
    if (!candidates.length) {
      return null;
    }
    return Math.max(...candidates);
  }

  function resolveMemoryMetric(gameEntry) {
    if (!gameEntry || typeof gameEntry !== "object") {
      return null;
    }
    const score = resolveGameScore(gameEntry.memory);
    return typeof score === "number" ? score : null;
  }

  function hasAnyGameResult(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    return Boolean(entry.logic || entry.sequence || entry.reaction || entry.focus || entry.memory);
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

  function shouldSeedDemoSession(sessionId) {
    if (!sessionId) {
      return false;
    }
    return /^demo[-_]/i.test(String(sessionId));
  }

  function buildDemoResponses(baseDate) {
    const sections = [
      {
        instrument: "AD8",
        prefix: "AD8_Q",
        total: 8,
        wrongSet: new Set([2, 6]),
        vadBase: 860,
        whisperOffset: 340,
      },
      {
        instrument: "SPMSQ",
        prefix: "SPMSQ_Q",
        total: 10,
        wrongSet: new Set([4, 10, 11]),
        vadBase: 980,
        whisperOffset: 410,
      },
      {
        instrument: "MMSE",
        prefix: "MMSE_Q",
        total: 20,
        wrongSet: new Set([2, 8, 12, 17]),
        vadBase: 1040,
        whisperOffset: 450,
      },
      {
        instrument: "MoCA",
        prefix: "MOCA_Q",
        total: 30,
        wrongSet: new Set([3, 7, 11, 16, 21, 29]),
        vadBase: 1110,
        whisperOffset: 480,
      },
    ];

    const responses = [];
    let order = 0;

    sections.forEach((section) => {
      for (let index = 1; index <= section.total; index += 1) {
        const createdAt = new Date(baseDate.getTime() + order * 29000);
        const isCorrect = !section.wrongSet.has(index);
        const expected = `${section.instrument} 參考答案 ${index}`;
        const answer = isCorrect
          ? expected
          : `${section.instrument} 回覆 ${index}（偏差）`;
        const vadMs = section.vadBase + index * 34;
        const whisperMs = vadMs + section.whisperOffset + (index % 3) * 41;

        responses.push({
          instrument: section.instrument,
          question_id: `${section.prefix}${index}`,
          question_text: `${section.instrument} 題目 ${index}`,
          transcript: answer,
          is_correct: isCorrect,
          reaction_time_ms: {
            vad: vadMs,
            whisper: whisperMs,
          },
          rule_score: {
            score: isCorrect ? 1 : 0,
            details: `預期答案：${expected}`,
          },
          llm_judge: {
            matched_expected: [expected],
            confidence: isCorrect ? 0.93 : 0.63,
          },
          manual_confirmed: true,
          created_at: createdAt.toISOString(),
        });

        order += 1;
      }
    });

    return responses;
  }

  function buildDemoReport(sessionId) {
    const createdAt = new Date("2026-03-20T09:35:00+08:00");
    const responses = buildDemoResponses(createdAt);
    return {
      session_id: sessionId,
      created_at: createdAt.toISOString(),
      summary: {
        screening_risk_band: "mild",
        message: "輕度認知風險（僅供篩檢參考，非診斷）",
        needs_followup: true,
      },
      instrument_scores: {
        AD8: {
          score: 2,
          max_score: 8,
          screen_positive: true,
        },
        SPMSQ: {
          errors: 3,
          severity_band: "mild",
        },
        MMSE: {
          score: 26,
          max_score: 30,
          severity_band: "mild",
        },
        MoCA: {
          score: 24,
          max_score: 30,
          severity_band: "mild",
        },
      },
      responses,
      disclaimer: "本結果為研究/輔助篩檢用途，不可作為臨床診斷依據。",
    };
  }

  function buildDemoGameEntry(createdAtIso) {
    const base = parseDate(createdAtIso) || new Date();
    const at = (offsetMinutes) => new Date(base.getTime() + offsetMinutes * 60000).toISOString();
    return {
      session_id: "demo",
      updated_at: at(52),
      logic: {
        difficulty: "easy",
        level_title: "分類推理",
        correct: 11,
        total: 12,
        score: 88,
        duration_sec: 42.6,
        completed_at: at(18),
      },
      sequence: {
        difficulty: "medium",
        total_numbers: 12,
        completed_count: 12,
        clicks: 14,
        errors: 2,
        score: 84,
        duration_sec: 21.4,
        completed_at: at(24),
      },
      memory: {
        difficulty: "easy",
        pairs_total: 8,
        pairs_matched: 8,
        moves: 12,
        score: 86,
        duration_sec: 39.2,
        completed_at: at(30),
      },
      reaction: {
        difficulty: "medium",
        hits: 14,
        misses: 3,
        score: 82,
        duration_sec: 20,
        completed_at: at(38),
      },
      focus: {
        difficulty: "easy",
        found: 5,
        total: 6,
        score: 83,
        elapsed_sec: 58.7,
        duration_sec: 58.7,
        completed_at: at(46),
      },
    };
  }

  function seedDemoData(sessionId, options = {}) {
    const { force = false, allowAnySession = false } = options;
    if (!sessionId) {
      return null;
    }
    if (!force && !allowAnySession && !shouldSeedDemoSession(sessionId)) {
      return null;
    }

    const reportCache = loadReportCacheMap();
    const existing = reportCache[sessionId] || null;
    const shouldRefresh =
      !existing ||
      !Array.isArray(existing.responses) ||
      existing.responses.length < 60 ||
      !existing.instrument_scores ||
      !existing.instrument_scores.MMSE ||
      !existing.instrument_scores.MoCA;

    const report = shouldRefresh ? buildDemoReport(sessionId) : existing;
    if (shouldRefresh) {
      reportCache[sessionId] = report;
      saveReportCacheMap(reportCache);
    }

    const gameMap = loadGameResultsMap();
    const existingGame = gameMap[sessionId] || null;
    const needGameRefresh =
      !existingGame ||
      !existingGame.logic ||
      !existingGame.sequence ||
      !existingGame.memory ||
      !existingGame.reaction ||
      !existingGame.focus;

    if (needGameRefresh) {
      gameMap[sessionId] = {
        ...buildDemoGameEntry(report.created_at),
        session_id: sessionId,
      };
      saveJsonMap(GAME_RESULTS_KEY, gameMap);
    }

    return report;
  }

  function shouldSeedMockGameSession(sessionId) {
    if (!sessionId) {
      return false;
    }
    return /^(demo|mock)[-_]/i.test(String(sessionId));
  }

  function ensureMockGameEntry(sessionId, report, gameResultsMap) {
    if (!shouldSeedMockGameSession(sessionId)) {
      return null;
    }

    const map = gameResultsMap || loadGameResultsMap();
    const existingGame = map[sessionId] || null;
    const hasCompleteGame =
      existingGame &&
      existingGame.logic &&
      existingGame.sequence &&
      existingGame.memory &&
      existingGame.reaction &&
      existingGame.focus;

    if (hasCompleteGame) {
      return existingGame;
    }

    const createdAt = report && report.created_at ? report.created_at : new Date().toISOString();
    const seeded = {
      ...buildDemoGameEntry(createdAt),
      session_id: sessionId,
    };
    map[sessionId] = seeded;
    saveJsonMap(GAME_RESULTS_KEY, map);
    return seeded;
  }
  function setExportHint(message, isError = false) {
    if (!csvExportHintEl) {
      return;
    }
    csvExportHintEl.textContent = message || "";
    csvExportHintEl.style.color = isError ? "#b91c1c" : "";
  }

  function formatDateOnly(value) {
    const date = parseDate(value);
    return date ? formatDateLabel(date) : "";
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) {
      return "--";
    }
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${formatDateLabel(date)} ${hh}:${mm}:${ss}`;
  }

  function toSafeString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }

  function toSheetBoolean(value) {
    if (value === true) {
      return "TRUE";
    }
    if (value === false) {
      return "FALSE";
    }
    return "";
  }

  function toRoundedNumber(value, digits = 0) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "";
    }
    if (digits <= 0) {
      return Math.round(value);
    }
    return Number(value.toFixed(digits));
  }

  function resolveExpectedAnswer(item) {
    if (!item || typeof item !== "object") {
      return "";
    }
    const llm = item.llm_judge || {};
    if (Array.isArray(llm.matched_expected) && llm.matched_expected.length) {
      return llm.matched_expected.join(" | ");
    }
    const rule = item.rule_score || {};
    if (rule.details) {
      return String(rule.details);
    }
    return "";
  }

  function resolveResponseProcess(item) {
    if (!item || typeof item !== "object") {
      return "";
    }
    const payload = {
      created_at: item.created_at || null,
      manual_confirmed: item.manual_confirmed ?? null,
      rule_score: item.rule_score || null,
      llm_judge: item.llm_judge || null,
    };
    try {
      return JSON.stringify(payload);
    } catch (error) {
      return "";
    }
  }

  function normalizeReaction(item) {
    const reaction = item && item.reaction_time_ms ? item.reaction_time_ms : {};
    const vadMs = toRoundedNumber(reaction.vad);
    const whisperMs = toRoundedNumber(reaction.whisper);
    const merged = whisperMs !== "" ? whisperMs : vadMs;
    return {
      vad_ms: vadMs,
      whisper_ms: whisperMs,
      response_time_ms: merged,
    };
  }

  function buildTestSheetRowsForSession(sessionId, report, progress) {
    const responses = report && Array.isArray(report.responses) ? report.responses : [];
    const answeredCount = responses.length;
    const totalFromProgress = progress && Number.isFinite(progress.total_questions)
      ? Number(progress.total_questions)
      : null;
    const totalQuestions = Math.max(totalFromProgress || 0, answeredCount);

    if (!totalQuestions && !answeredCount) {
      return [];
    }

    const summary = report && report.summary ? report.summary : {};
    const instrumentFallback = responses[0] && responses[0].instrument
      ? responses[0].instrument
      : "SPMSQ";

    const rows = [];
    let correctCount = 0;
    let judgedCount = 0;

    for (let index = 0; index < totalQuestions; index += 1) {
      const item = responses[index] || null;
      const isAnswered = Boolean(item);
      const isCorrect = item && typeof item.is_correct === "boolean" ? item.is_correct : null;
      if (typeof isCorrect === "boolean") {
        judgedCount += 1;
      }
      if (isCorrect) {
        correctCount += 1;
      }
      const reaction = normalizeReaction(item);

      rows.push({
        row_type: "question",
        session_id: sessionId,
        test_date: formatDateOnly((item && item.created_at) || (report && report.created_at) || ""),
        instrument: item && item.instrument ? item.instrument : instrumentFallback,
        question_no: index + 1,
        question_id: item && item.question_id ? item.question_id : "",
        question_text: item && item.question_text ? item.question_text : "（未回覆）",
        expected_answer: resolveExpectedAnswer(item),
        user_answer: item && item.transcript ? item.transcript : "",
        is_answered: toSheetBoolean(isAnswered),
        is_correct: toSheetBoolean(isCorrect),
        vad_ms: reaction.vad_ms,
        whisper_ms: reaction.whisper_ms,
        response_time_ms: reaction.response_time_ms,
        response_process: resolveResponseProcess(item),
        summary_total: "",
        summary_answered: "",
        summary_unanswered: "",
        summary_correct: "",
        summary_accuracy_pct: "",
        summary_stage: "",
        summary_note: "",
      });
    }

    const unansweredCount = Math.max(totalQuestions - answeredCount, 0);
    const accuracy = judgedCount > 0
      ? Number(((correctCount / judgedCount) * 100).toFixed(1))
      : "";
    rows.push({
      row_type: "summary",
      session_id: sessionId,
      test_date: formatDateOnly((report && report.created_at) || ""),
      instrument: instrumentFallback,
      question_no: "",
      question_id: "",
      question_text: "",
      expected_answer: "",
      user_answer: "",
      is_answered: "",
      is_correct: "",
      vad_ms: "",
      whisper_ms: "",
      response_time_ms: "",
      response_process: "",
      summary_total: totalQuestions,
      summary_answered: answeredCount,
      summary_unanswered: unansweredCount,
      summary_correct: correctCount,
      summary_accuracy_pct: accuracy,
      summary_stage: formatBandText(summary.screening_risk_band || "") || "--",
      summary_note: summary.message || "",
    });

    return rows;
  }

  function resolveGameDurationSec(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    if (typeof payload.duration_sec === "number" && Number.isFinite(payload.duration_sec)) {
      return Number(payload.duration_sec.toFixed(1));
    }
    if (typeof payload.elapsed_sec === "number" && Number.isFinite(payload.elapsed_sec)) {
      return Number(payload.elapsed_sec.toFixed(1));
    }
    const details = payload.details || {};
    if (typeof details.duration_sec === "number" && Number.isFinite(details.duration_sec)) {
      return Number(details.duration_sec.toFixed(1));
    }
    return "";
  }

  function resolveGameAccuracy(gameKey, payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    if (gameKey === "logic") {
      if (typeof payload.correct === "number" && typeof payload.total === "number" && payload.total > 0) {
        return Number(((payload.correct / payload.total) * 100).toFixed(1));
      }
      return "";
    }
    if (gameKey === "sequence") {
      if (typeof payload.completed_count === "number" && typeof payload.total_numbers === "number" && payload.total_numbers > 0) {
        return Number(((payload.completed_count / payload.total_numbers) * 100).toFixed(1));
      }
      return "";
    }
    if (gameKey === "memory") {
      if (typeof payload.pairs_matched === "number" && typeof payload.pairs_total === "number" && payload.pairs_total > 0) {
        return Number(((payload.pairs_matched / payload.pairs_total) * 100).toFixed(1));
      }
      return "";
    }
    if (gameKey === "reaction") {
      if (typeof payload.hits === "number" && typeof payload.misses === "number") {
        const total = payload.hits + payload.misses;
        return total > 0 ? Number(((payload.hits / total) * 100).toFixed(1)) : "";
      }
      return "";
    }
    if (gameKey === "focus") {
      if (typeof payload.found === "number" && typeof payload.total === "number" && payload.total > 0) {
        return Number(((payload.found / payload.total) * 100).toFixed(1));
      }
      return "";
    }
    return "";
  }

  function buildGameSheetRowsForSession(sessionId, report, gameEntry) {
    if (!gameEntry) {
      return [];
    }

    const specs = [
      { key: "logic", label: "邏輯：物件分類" },
      { key: "sequence", label: "邏輯：數字順序" },
      { key: "memory", label: "記憶：圖片配對" },
      { key: "reaction", label: "反應：打地鼠" },
      { key: "focus", label: "專注：找不同" },
    ];

    const rows = [];
    let totalScore = 0;
    let totalDuration = 0;
    let count = 0;

    specs.forEach((spec) => {
      const payload = gameEntry[spec.key];
      if (!payload) {
        return;
      }
      const score = typeof payload.score === "number" && Number.isFinite(payload.score)
        ? Math.round(payload.score)
        : "";
      const duration = resolveGameDurationSec(payload);
      const accuracy = resolveGameAccuracy(spec.key, payload);
      if (typeof score === "number") {
        totalScore += score;
      }
      if (typeof duration === "number") {
        totalDuration += duration;
      }
      count += 1;

      rows.push({
        row_type: "game",
        session_id: sessionId,
        play_date: formatDateOnly(payload.completed_at || (report && report.created_at) || ""),
        game_name: spec.label,
        difficulty: payload.difficulty || "",
        score,
        duration_sec: duration,
        accuracy_pct: accuracy,
        notes: "",
        total_games: "",
        avg_score: "",
        total_duration_sec: "",
      });
    });

    if (!count) {
      return [];
    }

    rows.push({
      row_type: "summary",
      session_id: sessionId,
      play_date: formatDateOnly((report && report.created_at) || ""),
      game_name: "all",
      difficulty: "",
      score: "",
      duration_sec: "",
      accuracy_pct: "",
      notes: "",
      total_games: count,
      avg_score: Number((totalScore / count).toFixed(1)),
      total_duration_sec: Number(totalDuration.toFixed(1)),
    });

    return rows;
  }

  function collectSheetHeaders(rows, preferredOrder) {
    const seen = new Set(preferredOrder);
    const extra = [];
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          extra.push(key);
        }
      });
    });
    return [...preferredOrder, ...extra];
  }

  function xmlEscape(value) {
    const text = toSafeString(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function cellXml(value, styleId = "") {
    const isNumber = typeof value === "number" && Number.isFinite(value);
    const type = isNumber ? "Number" : "String";
    const data = xmlEscape(isNumber ? value : toSafeString(value));
    const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : "";
    return `<Cell${styleAttr}><Data ss:Type="${type}">${data}</Data></Cell>`;
  }

  function worksheetXml(name, headers, rows) {
    const headerCells = headers.map((header) => cellXml(header, "Header")).join("");
    const rowXml = rows
      .map((row) => {
        const cells = headers.map((header) => cellXml(row[header])).join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");
    return `<Worksheet ss:Name="${xmlEscape(name)}"><Table><Row>${headerCells}</Row>${rowXml}</Table></Worksheet>`;
  }

  function buildWorkbookXml(sheets) {
    const worksheetXmlList = sheets
      .map((sheet) => worksheetXml(sheet.name, sheet.headers, sheet.rows))
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Noto Sans TC" ss:Size="10"/></Style>
<Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>
</Styles>
${worksheetXmlList}
</Workbook>`;
  }

  async function legacyDownloadWorkbookForSessions(sessionIds, fileLabel = "") {
    const normalizedSessionIds = Array.from(
      new Set((sessionIds || []).filter(Boolean)),
    );
    if (!normalizedSessionIds.length) {
      setExportHint("找不到可匯出資料的 Session。", true);
      return;
    }

    const gameMap = loadGameResultsMap();
    const reportCache = loadReportCacheMap();
    if (currentExportSessionId && currentExportReport) {
      reportCache[currentExportSessionId] = currentExportReport;
    }

    const testRows = [];
    const gameRows = [];
    let cacheUpdated = false;

    for (const sessionId of normalizedSessionIds) {
      let report = reportCache[sessionId] || null;
      if (!report) {
        try {
          report = await fetchReport(sessionId);
          reportCache[sessionId] = report;
          cacheUpdated = true;
        } catch (error) {
          report = null;
        }
      }

      const progress = await fetchProgress(sessionId);
      testRows.push(...buildTestSheetRowsForSession(sessionId, report, progress));
      gameRows.push(...buildGameSheetRowsForSession(sessionId, report, gameMap[sessionId] || null));
    }

    if (cacheUpdated) {
      saveReportCacheMap(reportCache);
    }

    if (!testRows.length && !gameRows.length) {
      setExportHint("目前沒有可匯出的測試/遊戲資料。", true);
      return;
    }

    const testHeaderOrder = [
      "row_type",
      "session_id",
      "test_date",
      "instrument",
      "question_no",
      "question_id",
      "question_text",
      "expected_answer",
      "user_answer",
      "is_answered",
      "is_correct",
      "vad_ms",
      "whisper_ms",
      "response_time_ms",
      "response_process",
      "summary_total",
      "summary_answered",
      "summary_unanswered",
      "summary_correct",
      "summary_accuracy_pct",
      "summary_stage",
      "summary_note",
    ];

    const gameHeaderOrder = [
      "row_type",
      "session_id",
      "play_date",
      "game_name",
      "difficulty",
      "score",
      "duration_sec",
      "accuracy_pct",
      "notes",
      "total_games",
      "avg_score",
      "total_duration_sec",
    ];

    const workbookXml = buildWorkbookXml([
      {
        name: "測試",
        headers: collectSheetHeaders(testRows, testHeaderOrder),
        rows: testRows,
      },
      {
        name: "遊戲",
        headers: collectSheetHeaders(gameRows, gameHeaderOrder),
        rows: gameRows,
      },
    ]);

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const rawLabel = fileLabel || (normalizedSessionIds.length === 1 ? normalizedSessionIds[0] : "multi");
    const safeLabel = String(rawLabel)
      .trim()
      .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "sessions";
    const fileName = `cogscreen_${safeLabel}_${stamp}.xls`;

    const blob = new Blob([`﻿${workbookXml}`], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportHint(`Excel 已下載：${fileName}`);
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
    if (!hasAnyGameResult(entry)) {
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
    if (entry.sequence) {
      gameScoresEl.appendChild(
        createGameCard(
          "邏輯：數字順序",
          `完成 ${entry.sequence.completed_count || 0}/${entry.sequence.total_numbers || 9}`,
          `錯誤 ${entry.sequence.errors || 0} 次｜耗時 ${entry.sequence.duration_sec || "--"} 秒`,
          entry.sequence.score,
        ),
      );
    }
    if (entry.memory) {
      gameScoresEl.appendChild(
        createGameCard(
          "記憶：圖片配對",
          `配對 ${entry.memory.pairs_matched || 0}/${entry.memory.pairs_total || 8}`,
          `翻牌 ${entry.memory.moves || 0} 次｜耗時 ${entry.memory.duration_sec || "--"} 秒`,
          entry.memory.score,
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
    if (gameEntry && gameEntry.sequence && gameEntry.sequence.completed_at) {
      candidates.push(gameEntry.sequence.completed_at);
    }
    if (gameEntry && gameEntry.memory && gameEntry.memory.completed_at) {
      candidates.push(gameEntry.memory.completed_at);
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

  function buildRadarRecord(sessionId, report, gameEntry, meta = null) {
    const metrics = {
      cognitive: calculateCognitiveScore(report),
      logic: clampScore(resolveLogicMetric(gameEntry)),
      reaction: clampScore(gameEntry && gameEntry.reaction ? gameEntry.reaction.score : null),
      focus: clampScore(gameEntry && gameEntry.focus ? gameEntry.focus.score : null),
      memory: clampScore(resolveMemoryMetric(gameEntry)),
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
    const summaryMessage =
      report && report.summary && report.summary.message
        ? String(report.summary.message)
        : "";
    const patientName =
      meta && meta.patient_name
        ? String(meta.patient_name)
        : meta && meta.patient_id
          ? String(meta.patient_id)
          : sessionId;
    return {
      sessionId,
      patientName,
      timestamp,
      dateKey: formatDateKey(timestamp),
      dateLabel: formatDateLabel(timestamp),
      riskBand: reportRiskBand || inferredRiskBand,
      summaryMessage,
      metrics,
    };
  }

  function groupRadarByDate(records) {
    const output = records.map((record) => {
      return {
        dateKey: record.dateKey,
        dateLabel: record.dateLabel,
        sessionCount: 1,
        sessionIds: record.sessionId ? [record.sessionId] : [],
        sessionTimeline: record.sessionId
          ? [
              {
                sessionId: record.sessionId,
                timestamp: record.timestamp.toISOString(),
              },
            ]
          : [],
        patientNames: record.patientName ? [record.patientName] : [],
        nameLabel: record.patientName || "--",
        riskBand: record.riskBand,
        summaryMessage: record.summaryMessage || "",
        metrics: record.metrics,
        latestTimestamp: record.timestamp || new Date(),
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

  function createValueCell(label, value) {
    const cell = document.createElement("article");
    cell.className = "date-radar-value";

    const labelEl = document.createElement("p");
    labelEl.textContent = label;
    cell.appendChild(labelEl);

    const valueEl = document.createElement("strong");
    valueEl.textContent =
      typeof value === "number" && Number.isFinite(value) ? String(value) : "--";
    cell.appendChild(valueEl);

    return cell;
  }

  function stripScreeningSuffix(text) {
    if (!text) {
      return "";
    }
    return String(text)
      .replace(/[（(]\s*僅供篩檢參考\s*[,，]?\s*非診斷\s*[)）]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function formatJudgementText(riskBand, message = "") {
    const cleanMessage = stripScreeningSuffix(message);
    if (cleanMessage) {
      return cleanMessage;
    }
    const bandText = formatBandText(riskBand) || "--";
    return `失智前兆初步判斷：${bandText}`;
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
      const ratio = Math.max(0, Math.min(100, numericValue)) / 100;
      const point = polygonPoint(centerX, centerY, radius * ratio, index, total);
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(37, 99, 235, 0.18)";
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    values.forEach((value, index) => {
      if (typeof value !== "number") {
        return;
      }
      const ratio = Math.max(0, Math.min(100, value)) / 100;
      const point = polygonPoint(centerX, centerY, radius * ratio, index, total);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function formatDateTimeLabel(group) {
    if (!group || !(group.latestTimestamp instanceof Date)) {
      return group && group.dateLabel ? group.dateLabel : "--";
    }
    const hh = String(group.latestTimestamp.getHours()).padStart(2, "0");
    const mm = String(group.latestTimestamp.getMinutes()).padStart(2, "0");
    const ss = String(group.latestTimestamp.getSeconds()).padStart(2, "0");
    return `${group.dateLabel} ${hh}:${mm}:${ss}`;
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

    const tableHead = document.createElement("div");
    tableHead.className = "date-radar-table-head";
    ["姓名", "日期", "Summary", "詳細資訊"].forEach((label) => {
      const headCell = document.createElement("p");
      headCell.className = "date-radar-head-cell";
      headCell.textContent = label;
      tableHead.appendChild(headCell);
    });
    dailyRadarListEl.appendChild(tableHead);

    groups.forEach((group) => {
      const card = document.createElement("details");
      card.className = "date-radar-card date-radar-row-card";

      const summary = document.createElement("summary");
      summary.className = "date-radar-toggle date-radar-row-toggle";

      const sessionCell = document.createElement("p");
      sessionCell.className = "date-radar-col date-radar-col-session";
      sessionCell.textContent = group.nameLabel || "--";

      const dateCell = document.createElement("p");
      dateCell.className = "date-radar-col date-radar-col-date";
      dateCell.textContent = formatDateTimeLabel(group);

      const summaryCell = document.createElement("p");
      summaryCell.className = "date-radar-col date-radar-col-summary";
      summaryCell.textContent = formatJudgementText(group.riskBand, group.summaryMessage || "");

      const actionCell = document.createElement("div");
      actionCell.className = "date-radar-col date-radar-col-action";
      const togglePill = document.createElement("span");
      togglePill.className = "date-radar-toggle-pill";
      togglePill.textContent = "展開";
      actionCell.appendChild(togglePill);

      summary.appendChild(sessionCell);
      summary.appendChild(dateCell);
      summary.appendChild(summaryCell);
      summary.appendChild(actionCell);

      const body = document.createElement("div");
      body.className = "date-radar-body";

      const left = document.createElement("div");
      const head = document.createElement("div");
      head.className = "date-radar-head";

      const title = document.createElement("h3");
      title.className = "date-radar-title";
      title.textContent = "能力雷達圖";

      const headRight = document.createElement("div");
      headRight.className = "date-radar-head-right";

      const meta = document.createElement("p");
      meta.className = "date-radar-meta";
      meta.textContent = `Sessions: ${group.sessionCount}`;

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "ghost date-radar-download";
      downloadButton.textContent = "下載當日 Excel";
      downloadButton.disabled = !group.sessionIds || !group.sessionIds.length;
      downloadButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await downloadWorkbookForSessions(group.sessionIds || [], group.dateLabel, {
          sessionTimeline: group.sessionTimeline || [],
        });
      });

      head.appendChild(title);
      headRight.appendChild(meta);
      headRight.appendChild(downloadButton);
      head.appendChild(headRight);

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
        valuesGrid.appendChild(createValueCell(DIMENSION_LABELS[key], group.metrics[key]));
      });

      body.appendChild(left);
      body.appendChild(valuesGrid);
      card.appendChild(summary);
      card.appendChild(body);
      dailyRadarListEl.appendChild(card);

      card.addEventListener("toggle", () => {
        togglePill.textContent = card.open ? "收合" : "展開";
        if (card.open) {
          drawRadar(canvas, group.metrics);
        }
      });
    });
  }

  function renderIncompleteSpmsqHistory(items) {
    if (!spmsqIncompleteListEl) {
      return;
    }
    spmsqIncompleteListEl.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "date-radar-empty";
      empty.textContent = "目前沒有未完成的 SPMSQ 測驗。";
      spmsqIncompleteListEl.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "spmsq-history-card";

      const row = document.createElement("div");
      row.className = "spmsq-history-row";

      const sessionCell = document.createElement("p");
      sessionCell.className = "spmsq-history-cell spmsq-history-session";
      sessionCell.textContent = item.sessionId || "--";

      const dateCell = document.createElement("p");
      dateCell.className = "spmsq-history-cell spmsq-history-date";
      dateCell.textContent = formatDateTime(item.createdAt);

      const progressCell = document.createElement("p");
      progressCell.className = "spmsq-history-cell spmsq-history-progress";
      progressCell.textContent = `已作答 ${item.answered}/${item.totalQuestions}（${item.completionPct}%）`;

      const statusCell = document.createElement("div");
      statusCell.className = "spmsq-history-cell";
      const chip = document.createElement("span");
      chip.className = "spmsq-history-chip";
      chip.textContent = "未完成";
      statusCell.appendChild(chip);

      row.appendChild(sessionCell);
      row.appendChild(dateCell);
      row.appendChild(progressCell);
      row.appendChild(statusCell);
      card.appendChild(row);
      spmsqIncompleteListEl.appendChild(card);
    });
  }

  async function buildIncompleteSpmsqHistory(sessionDirectory) {
    if (!Array.isArray(sessionDirectory) || !sessionDirectory.length) {
      return [];
    }

    const items = (await Promise.all(
      sessionDirectory.map(async (entry) => {
        const sessionId = entry && entry.session_id ? String(entry.session_id) : "";
        if (!sessionId) {
          return null;
        }

        const progress = await fetchProgress(sessionId);
        if (!progress || progress.is_complete) {
          return null;
        }

        const answered = Number.isFinite(progress.answered) ? Number(progress.answered) : 0;
        const totalQuestions = Number.isFinite(progress.total_questions)
          ? Number(progress.total_questions)
          : 0;
        const completionPct = totalQuestions > 0
          ? Number(((answered / totalQuestions) * 100).toFixed(1))
          : 0;

        return {
          sessionId,
          createdAt: entry.created_at || null,
          answered,
          totalQuestions,
          completionPct,
        };
      }),
    )).filter((item) => Boolean(item));

    items.sort((a, b) => {
      const aDate = parseDate(a.createdAt);
      const bDate = parseDate(b.createdAt);
      const aTime = aDate ? aDate.getTime() : 0;
      const bTime = bDate ? bDate.getTime() : 0;
      return bTime - aTime;
    });
    return items;
  }

  function getSessionIdsForTimeline(
    currentSessionId,
    gameResults,
    reportCache,
    sessionDirectory,
    isGlobalViewer,
  ) {
    if (Array.isArray(sessionDirectory) && sessionDirectory.length) {
      return Array.from(
        new Set(
          sessionDirectory
            .map((item) => item && item.session_id)
            .filter(Boolean),
        ),
      );
    }

    const ids = new Set();
    if (currentSessionId) {
      ids.add(currentSessionId);
    }

    if (isGlobalViewer) {
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
    }

    return Array.from(ids);
  }

  async function fetchReport(sessionId) {
    const response = await fetch(`${API_ROOT}/sessions/${sessionId}/report`);
    if (!response.ok) {
      throw new Error(`Report API failed: ${response.status}`);
    }
    return response.json();
  }

  async function fetchProgress(sessionId) {
    try {
      const response = await fetch(`${API_ROOT}/sessions/${sessionId}/progress`);
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function buildTimelineGroups(currentSessionId, currentReport, options = {}) {
    const { sessionDirectory = [], isGlobalViewer = false } = options;
    const gameResults = loadGameResultsMap();
    const reportCache = loadReportCacheMap();

    const directoryMap = Object.create(null);
    if (Array.isArray(sessionDirectory)) {
      sessionDirectory.forEach((item) => {
        if (item && item.session_id) {
          directoryMap[item.session_id] = item;
        }
      });
    }

    if (currentSessionId && currentReport) {
      reportCache[currentSessionId] = currentReport;
      saveReportCacheMap(reportCache);
    }

    const sessionIds = getSessionIdsForTimeline(
      currentSessionId,
      gameResults,
      reportCache,
      sessionDirectory,
      isGlobalViewer,
    );
    if (!sessionIds.length) {
      return [];
    }

    const records = [];
    let cacheUpdated = false;

    for (const sessionId of sessionIds) {
      const progress = await fetchProgress(sessionId);
      if (!progress || !progress.is_complete) {
        continue;
      }

      let gameEntry = gameResults[sessionId] || null;
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

      if (!gameEntry) {
        gameEntry = ensureMockGameEntry(sessionId, report, gameResults) || null;
      }

      const record = buildRadarRecord(
        sessionId,
        report,
        gameEntry,
        directoryMap[sessionId] || null,
      );
      if (record) {
        records.push(record);
      }
    }

    if (cacheUpdated) {
      saveReportCacheMap(reportCache);
    }

    return groupRadarByDate(records);
  }

  function clearSummaryPanel() {
    applyRiskStyle("none");
    if (riskBadgeEl) {
      riskBadgeEl.textContent = "--";
    }
    if (summaryMessageEl) {
      summaryMessageEl.textContent = "尚無可用報表資料";
    }
    if (needsFollowupEl) {
      needsFollowupEl.textContent = "--";
    }
    if (avgVadEl) {
      avgVadEl.textContent = "--";
    }
    if (avgWhisperEl) {
      avgWhisperEl.textContent = "--";
    }
    if (accuracyRateEl) {
      accuracyRateEl.textContent = "--";
    }
    renderInstrumentScores({});
    renderResponses([]);
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

    setExportHint("展開歷史紀錄卡片後，可下載該日期的 Excel（測試/遊戲）明細。");

    const viewerContext = resolveViewerContext();
    const sessionDirectory = await fetchSessionDirectory(viewerContext);
    if (spmsqIncompleteListEl) {
      const incompleteHistoryItems = await buildIncompleteSpmsqHistory(sessionDirectory);
      renderIncompleteSpmsqHistory(incompleteHistoryItems);
    }
    setExportHint("預設匯出：當日最新且已完成的 1 筆 Session。");

    const resolvedSessionId = resolveSessionId();
    const latestSessionId = sessionDirectory.length > 0
      ? sessionDirectory[0].session_id
      : null;
    const viewerDemoSessionId = shouldSeedDemoSession(viewerContext.viewerPatientId)
      ? viewerContext.viewerPatientId
      : null;
    const reportSessionId = resolvedSessionId || latestSessionId || viewerDemoSessionId;
    const shouldAutoDemo = !reportSessionId && sessionDirectory.length === 0 && !viewerContext.viewerPatientId;
    const effectiveSessionId = reportSessionId || (shouldAutoDemo ? "demo-preview_v1" : null);

    currentExportSessionId = effectiveSessionId || null;

    const sessionLabel = resolvedSessionId
      || viewerContext.viewerPatientId
      || effectiveSessionId
      || "--";

    if (sessionIdEl) {
      sessionIdEl.textContent = sessionLabel;
    }

    if (shouldAutoDemo && effectiveSessionId) {
      sessionStorage.setItem(REPORT_SESSION_KEY, effectiveSessionId);
    }

    const shouldUseDemoSeed = Boolean(
      effectiveSessionId && (shouldAutoDemo || shouldSeedDemoSession(effectiveSessionId)),
    );

    const seededDemoReport = shouldUseDemoSeed
      ? seedDemoData(effectiveSessionId, {
          force: shouldAutoDemo,
          allowAnySession: shouldAutoDemo,
        })
      : null;

    let currentReport = seededDemoReport || null;
    if (currentReport) {
      applyReportToSummary(currentReport);
      setStatus(
        shouldAutoDemo
          ? "未帶入 Session ID，已載入模擬完整資料。"
          : "已載入模擬完整資料。可以直接檢視結果與下載明細。",
      );
    } else if (effectiveSessionId) {
      try {
        currentReport = await fetchReport(effectiveSessionId);
        applyReportToSummary(currentReport);
        const cache = loadReportCacheMap();
        cache[effectiveSessionId] = currentReport;
        saveReportCacheMap(cache);
        setStatus("報表載入完成。");
      } catch (error) {
        const cache = loadReportCacheMap();
        if (cache[effectiveSessionId]) {
          currentReport = cache[effectiveSessionId];
          applyReportToSummary(currentReport);
          setStatus("報表載入失敗，已改用快取資料。");
        } else if (shouldSeedDemoSession(effectiveSessionId)) {
          const fallbackDemo = seedDemoData(effectiveSessionId, { force: true });
          if (fallbackDemo) {
            currentReport = fallbackDemo;
            applyReportToSummary(currentReport);
            setStatus("報表載入失敗，已改用模擬完整資料。");
          } else {
            clearSummaryPanel();
            setStatus("報表載入失敗，已顯示可用的歷史資料。");
          }
        } else {
          clearSummaryPanel();
          setStatus("報表載入失敗，已顯示可用的歷史資料。");
        }
      }
    } else {
      clearSummaryPanel();
      setStatus(sessionDirectory.length ? "已載入歷史紀錄。" : "尚無可用歷史資料。");
    }

    currentExportReport = currentReport;

    if (effectiveSessionId) {
      const gameMap = loadGameResultsMap();
      ensureMockGameEntry(effectiveSessionId, currentReport, gameMap);
      renderGameScores(effectiveSessionId);
    } else {
      renderGameScores(effectiveSessionId);
    }

    const timelineGroups = await buildTimelineGroups(effectiveSessionId, currentReport, {
      sessionDirectory,
      isGlobalViewer: viewerContext.isGlobalViewer,
    });
    renderDateRadar(timelineGroups);
  }

  async function downloadWorkbookForSessions(sessionIds, fileLabel = "", options = {}) {
    const normalizedSessionIds = Array.from(new Set((sessionIds || []).filter(Boolean)));
    if (!normalizedSessionIds.length) {
      setExportHint("找不到可匯出的 Session。", true);
      return;
    }

    const timeline = Array.isArray(options.sessionTimeline) ? options.sessionTimeline : [];
    const timelineOrder = Array.from(
      new Set(
        timeline
          .map((item) => (item && item.sessionId ? item.sessionId : null))
          .filter(Boolean),
      ),
    );
    const orderedSessionIds = [
      ...timelineOrder.filter((id) => normalizedSessionIds.includes(id)),
      ...normalizedSessionIds.filter((id) => !timelineOrder.includes(id)),
    ];

    const gameMap = loadGameResultsMap();
    const reportCache = loadReportCacheMap();
    if (currentExportSessionId && currentExportReport) {
      reportCache[currentExportSessionId] = currentExportReport;
    }

    const progressCache = Object.create(null);
    const getProgressForSession = async (sessionId) => {
      if (sessionId in progressCache) {
        return progressCache[sessionId];
      }
      const progress = await fetchProgress(sessionId);
      progressCache[sessionId] = progress;
      return progress;
    };

    let exportSessionIds = [...normalizedSessionIds];
    let exportSelectionNote = "";

    if (normalizedSessionIds.length > 1) {
      let latestCompletedSessionId = null;
      for (const sessionId of orderedSessionIds) {
        const progress = await getProgressForSession(sessionId);
        if (progress && progress.is_complete) {
          latestCompletedSessionId = sessionId;
          break;
        }
      }

      if (latestCompletedSessionId) {
        exportSessionIds = [latestCompletedSessionId];
        exportSelectionNote = "已依預設匯出當日最新且已完成的 1 筆 Session。";
      } else if (orderedSessionIds.length) {
        exportSessionIds = [orderedSessionIds[0]];
        exportSelectionNote = "當日無已完成 Session，已改匯出最新 1 筆 Session。";
      }
    }

    const testRows = [];
    const gameRows = [];
    let cacheUpdated = false;

    for (const sessionId of exportSessionIds) {
      let report = reportCache[sessionId] || null;
      if (!report) {
        try {
          report = await fetchReport(sessionId);
          reportCache[sessionId] = report;
          cacheUpdated = true;
        } catch (error) {
          report = null;
        }
      }

      const progress = await getProgressForSession(sessionId);
      testRows.push(...buildTestSheetRowsForSession(sessionId, report, progress));
      gameRows.push(...buildGameSheetRowsForSession(sessionId, report, gameMap[sessionId] || null));
    }

    if (cacheUpdated) {
      saveReportCacheMap(reportCache);
    }

    if (!testRows.length && !gameRows.length) {
      setExportHint("找不到可匯出的測驗/遊戲資料。", true);
      return;
    }

    const testHeaderOrder = [
      "row_type",
      "session_id",
      "test_date",
      "instrument",
      "question_no",
      "question_id",
      "question_text",
      "expected_answer",
      "user_answer",
      "is_answered",
      "is_correct",
      "vad_ms",
      "whisper_ms",
      "response_time_ms",
      "response_process",
      "summary_total",
      "summary_answered",
      "summary_unanswered",
      "summary_correct",
      "summary_accuracy_pct",
      "summary_stage",
      "summary_note",
    ];

    const gameHeaderOrder = [
      "row_type",
      "session_id",
      "play_date",
      "game_name",
      "difficulty",
      "score",
      "duration_sec",
      "accuracy_pct",
      "notes",
      "total_games",
      "avg_score",
      "total_duration_sec",
    ];

    const workbookXml = buildWorkbookXml([
      {
        name: "測試",
        headers: collectSheetHeaders(testRows, testHeaderOrder),
        rows: testRows,
      },
      {
        name: "遊戲",
        headers: collectSheetHeaders(gameRows, gameHeaderOrder),
        rows: gameRows,
      },
    ]);

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const rawLabel = fileLabel || (exportSessionIds.length === 1 ? exportSessionIds[0] : "multi");
    const safeLabel = String(rawLabel)
      .trim()
      .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "sessions";
    const fileName = `cogscreen_${safeLabel}_${stamp}.xls`;

    const blob = new Blob([`\uFEFF${workbookXml}`], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const hint = exportSelectionNote
      ? `${exportSelectionNote} Excel 已下載：${fileName}`
      : `Excel 已下載：${fileName}`;
    setExportHint(hint);
  }

  window.addEventListener("resize", () => {
    if (!dailyRadarListEl) {
      return;
    }

    const cards = Array.from(dailyRadarListEl.querySelectorAll(".date-radar-card"));
    cards.forEach((card) => {
      if (!card.open) {
        return;
      }
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
