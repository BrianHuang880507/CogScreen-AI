(function () {
  const LOGIN_KEY = "isLoggedIn";
  const REPORT_SESSION_KEY = "latestReportSessionId";
  const GAME_RESULTS_KEY = "gameResultsBySession";
  const API_ROOT = "/api";

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

  const riskTextMap = {
    none: "低風險",
    mild: "輕度風險",
    moderate: "中度風險",
    severe: "高度風險",
  };

  const severityTextMap = {
    none: "無",
    mild: "輕度",
    moderate: "中度",
    severe: "重度",
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
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
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

  function average(values) {
    if (!values.length) {
      return null;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
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
    const rows = [];

    const ad8 = scores.AD8 || {};
    rows.push(
      createInstrumentCard("AD8", [
        {
          label: "分數",
          value:
            ad8.score !== null && ad8.score !== undefined
              ? `${ad8.score}/${ad8.max_score || 8}`
              : "--",
        },
        { label: "篩檢陽性", value: ad8.screen_positive ? "是" : "否" },
      ]),
    );

    const spmsq = scores.SPMSQ || {};
    rows.push(
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

    const mmse = scores.MMSE || {};
    rows.push(
      createInstrumentCard("MMSE", [
        {
          label: "分數",
          value:
            mmse.score !== null && mmse.score !== undefined
              ? `${mmse.score}/${mmse.max_score || 30}`
              : "--",
        },
        { label: "風險分級", value: formatSeverityText(mmse.severity_band) },
      ]),
    );

    const moca = scores.MoCA || {};
    rows.push(
      createInstrumentCard("MoCA", [
        {
          label: "分數",
          value:
            moca.score !== null && moca.score !== undefined
              ? `${moca.score}/${moca.max_score || 30}`
              : "--",
        },
        { label: "風險分級", value: formatSeverityText(moca.severity_band) },
      ]),
    );

    rows.forEach((card) => instrumentCardsEl.appendChild(card));
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

  function loadGameResultsMap() {
    try {
      const raw = localStorage.getItem(GAME_RESULTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
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
      gameScoresEl.appendChild(
        createGameCard(
          "邏輯：圖形分類",
          `正確數 ${entry.logic.correct}/${entry.logic.total}`,
          "完成拖曳分類。",
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

  async function fetchReport(sessionId) {
    const response = await fetch(`${API_ROOT}/sessions/${sessionId}/report`);
    if (!response.ok) {
      throw new Error(`Report API failed: ${response.status}`);
    }
    return response.json();
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

    if (!sessionId) {
      setStatus("找不到 Session ID，請先完成測驗流程。");
      return;
    }

    try {
      const report = await fetchReport(sessionId);
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
        needsFollowupEl.textContent = summary.needs_followup
          ? "建議追蹤"
          : "暫無";
      }
      if (disclaimerEl) {
        disclaimerEl.textContent =
          report.disclaimer || disclaimerEl.textContent;
      }
      renderInstrumentScores(report.instrument_scores || {});
      renderResponses(Array.isArray(report.responses) ? report.responses : []);
      updateSummaryMetrics(report);
      setStatus("報表載入完成。");
    } catch (error) {
      setStatus("報表載入失敗，請稍後再試。");
    }
  }

  init();
})();
