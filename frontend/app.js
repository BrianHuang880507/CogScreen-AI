
const STR = {
  loginRequired: "請先登入再進行測試",
  loginMissing: "請輸入 Session ID",
  loginSuccess: "登入成功",
  anonSuccess: "已以匿名方式登入",
  registerSuccess: "註冊成功",
  registerMissing: "請輸入使用者名稱與年齡",
  logoutSuccess: "已登出",
  anonBlocked: "匿名登入無法進行測試",
  mocaBuilding: "MoCA 正在建立中",
  pickTest: "請先選擇測試",
  tryLater: "目前無法載入題目",
  waitAudio: "等待題目播放完成",
  startHint: "請按下一題開始",
  starting: "正在建立測驗...",
  needQuestion: "尚未取得題目",
  recording: "錄音中...",
  uploading: "上傳錄音中...",
  uploadFail: "上傳失敗，請再試一次",
  answered: "作答完成，正在檢查進度",
  reporting: "正在產生報表...",
  reportFail: "報表產生失敗",
  reportOk: "測驗完成",
  noResult: "尚無錄音結果",
  missingInstrument: "尚未選擇測驗",
  anonymousName: "匿名使用者",
  candidatePrefix: "考生：",
  examSuffix: "測驗",
};

const toast = document.getElementById("toast");
const navLinks = document.querySelectorAll(".nav-link");
const currentPage = document.body ? document.body.dataset.page : "";
const LOGIN_KEY = "isLoggedIn";
const USER_NAME_KEY = "userName";
const USER_AGE_KEY = "userAge";
const USER_SESSION_KEY = "userSessionId";
const USER_ANON_KEY = "isAnonymous";

const loginButton = document.getElementById("loginButton");
const loginAnonymous = document.getElementById("loginAnonymous");
const registerButton = document.getElementById("registerButton");
const backToLogin = document.getElementById("backToLogin");
const sessionIdInput = document.getElementById("sessionIdInput");
const loginFields = document.getElementById("loginFields");
const registerFields = document.getElementById("registerFields");
const userNameInput = document.getElementById("userName");
const userAgeInput = document.getElementById("userAge");
const sessionInfo = document.getElementById("sessionInfo");
const sessionIdText = document.getElementById("sessionIdText");
const logoutBubble = document.getElementById("logoutBubble");
const loginForm = document.querySelector(".login-form");
const loginActions = document.querySelector(".login-actions");

const testCards = document.querySelectorAll(".test-card");
const prevQuestionButton = document.getElementById("prevQuestion");
const nextQuestionButton = document.getElementById("nextQuestion");
const viewResultsButton = document.getElementById("viewResults");
const questionBigText = document.getElementById("questionBigText");
const questionAudio = document.getElementById("questionAudio");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const questionIndex = document.getElementById("questionIndex");
const examTitle = document.getElementById("examTitle");
const sessionIdDisplay = document.getElementById("sessionIdDisplay");
const doneCountEl = document.getElementById("doneCount");
const totalCountEl = document.getElementById("totalCount");
const answerPanel = document.querySelector(".answer-panel");
const micButton = document.getElementById("micButton");
const sendButton = document.getElementById("sendButton");
const manualConfirmButton = document.getElementById("manualConfirm");
const manualRejectButton = document.getElementById("manualReject");
const manualPanel = document.getElementById("manualPanel");
const questionMedia = document.getElementById("questionMedia");
const questionImage = document.getElementById("questionImage");
const questionImagePlaceholder = document.getElementById("questionImagePlaceholder");

let sessionId = null;
let currentQuestion = null;
let selectedInstrument = null;
let mediaRecorder = null;
let recordedChunks = [];
let vadStartMs = null;
let recordingStart = null;
let audioContext = null;
let analyser = null;
let micSource = null;
let rafId = null;
let currentIndex = 0;
let totalQuestions = null;
let historyIndex = -1;
let pendingNavigation = null;
const questionHistory = [];
const answerCache = new Map();
let manualConfirmed = false;
let recordingDisabled = false;

const VAD_THRESHOLD = 0.02;
const RESULTS_URL = "https://play-game.azurewebsites.net/#/";
const IMAGE_PLACEHOLDER_IDS = new Set();
const SESSION_MAP_KEY = "instrumentSessionMap";
const API_ROOT = "/api";

const instrumentLabels = {
  mmse: "MMSE",
  spmsq: "SPMSQ",
  ad8: "AD8",
  moca: "MoCA",
};

function showToast(message) {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

async function apiRequest(path, options = {}) {
  const url = `${API_ROOT}${path}`;
  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error,
    };
  }
}

function apiGet(path) {
  return apiRequest(path);
}

function apiPost(path) {
  return apiRequest(path, {
    method: "POST",
  });
}

function apiPostJson(path, payload) {
  return apiRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function apiPostForm(path, formData) {
  return apiRequest(path, {
    method: "POST",
    body: formData,
  });
}

function loadSessionMap() {
  try {
    const raw = localStorage.getItem(SESSION_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveSessionMap(map) {
  localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map));
}

function getStoredSessionId(instrument) {
  const map = loadSessionMap();
  return map[instrument] || null;
}

function setStoredSessionId(instrument, id) {
  if (!instrument || !id) {
    return;
  }
  const map = loadSessionMap();
  map[instrument] = id;
  saveSessionMap(map);
}

function clearStoredSessionId(instrument) {
  const map = loadSessionMap();
  if (instrument in map) {
    delete map[instrument];
    saveSessionMap(map);
  }
}

function isLoggedIn() {
  return sessionStorage.getItem(LOGIN_KEY) === "true";
}

function isAnonymous() {
  return sessionStorage.getItem(USER_ANON_KEY) === "true";
}

function canTakeTest() {
  return isLoggedIn();
}

function generateSessionId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `uuid-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function setLoggedIn(name, age, anonymousLogin, sessionOverride) {
  sessionStorage.setItem(LOGIN_KEY, "true");
  sessionStorage.setItem(USER_NAME_KEY, name || STR.anonymousName);
  sessionStorage.setItem(USER_ANON_KEY, anonymousLogin ? "true" : "false");
  if (age) {
    sessionStorage.setItem(USER_AGE_KEY, String(age));
  }
  const sessionUuid = sessionOverride || generateSessionId();
  sessionStorage.setItem(USER_SESSION_KEY, sessionUuid);
  return sessionUuid;
}

function updateNavState() {
  const loggedIn = isLoggedIn();
  const allowTest = canTakeTest();
  navLinks.forEach((link) => {
    if (link.dataset.view === "login") {
      link.style.display = loggedIn ? "none" : "inline-flex";
    }
    if (link.dataset.view === "test") {
      link.style.display = loggedIn ? "inline-flex" : "none";
    }
    link.classList.toggle("is-active", link.dataset.view === currentPage);
  });
  if (logoutBubble) {
    logoutBubble.classList.toggle("hidden", !loggedIn);
  }
}

function updateLoginPanel() {
  if (!loginForm || !loginActions) {
    return;
  }
  const loggedIn = isLoggedIn();
  loginForm.classList.toggle("hidden", loggedIn);
  loginActions.classList.toggle("hidden", loggedIn);
  if (registerFields && loggedIn) {
    registerFields.classList.add("hidden");
  }
}

function setAuthMode(mode) {
  const isRegister = mode === "register";
  if (loginFields) {
    loginFields.classList.toggle("hidden", isRegister);
    loginFields.toggleAttribute("hidden", isRegister);
  }
  if (registerFields) {
    registerFields.classList.toggle("hidden", !isRegister);
    registerFields.toggleAttribute("hidden", !isRegister);
  }
  if (loginButton) {
    loginButton.classList.toggle("hidden", isRegister);
  }
  if (loginAnonymous) {
    loginAnonymous.classList.toggle("hidden", isRegister);
  }
  if (backToLogin) {
    backToLogin.classList.toggle("hidden", !isRegister);
    backToLogin.toggleAttribute("hidden", !isRegister);
  }
}

function requireTestAccess(target = "/") {
  if (!isLoggedIn()) {
    showToast(STR.loginRequired);
    setTimeout(() => {
      window.location.href = target;
    }, 600);
    return false;
  }
  return true;
}

function hydrateSessionInfo() {
  if (!sessionInfo || !sessionIdText) {
    return;
  }
  const existing = sessionStorage.getItem(USER_SESSION_KEY);
  if (existing) {
    sessionIdText.textContent = existing;
    sessionInfo.classList.remove("hidden");
    if (sessionIdInput) {
      sessionIdInput.value = existing;
    }
  }
}

updateNavState();
updateLoginPanel();
setAuthMode("login");
hydrateSessionInfo();

if (navLinks.length > 0) {
  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const view = link.dataset.view;
      if (view === "test" && !canTakeTest()) {
        event.preventDefault();
        requireTestAccess("/");
      }
    });
  });
}

if (loginButton) {
  loginButton.addEventListener("click", () => {
    const sessionValue = sessionIdInput ? sessionIdInput.value.trim() : "";
    if (!sessionValue) {
      showToast(STR.loginMissing);
      return;
    }
    const sessionUuid = setLoggedIn("", "", false, sessionValue);
    if (sessionInfo && sessionIdText) {
      sessionIdText.textContent = sessionUuid;
      sessionInfo.classList.remove("hidden");
    }
    if (sessionIdInput) {
      sessionIdInput.value = sessionUuid;
    }
    showToast(STR.loginSuccess);
    updateNavState();
    updateLoginPanel();
    setTimeout(() => {
      window.location.href = "/test.html";
    }, 400);
  });
}

if (registerButton) {
  registerButton.addEventListener("click", () => {
    if (registerFields && registerFields.classList.contains("hidden")) {
      setAuthMode("register");
      if (userNameInput) {
        userNameInput.focus();
      }
      return;
    }
    const name = userNameInput ? userNameInput.value.trim() : "";
    const ageValue = userAgeInput ? userAgeInput.value.trim() : "";
    if (!name || !ageValue) {
      showToast(STR.registerMissing);
      return;
    }
    const ageNumber = Number(ageValue);
    if (!Number.isFinite(ageNumber) || ageNumber <= 0) {
      showToast(STR.registerMissing);
      return;
    }
    const sessionUuid = setLoggedIn(name, ageNumber, false);
    if (sessionInfo && sessionIdText) {
      sessionIdText.textContent = sessionUuid;
      sessionInfo.classList.remove("hidden");
    }
    if (sessionIdInput) {
      sessionIdInput.value = sessionUuid;
    }
    showToast(STR.registerSuccess);
    updateNavState();
    updateLoginPanel();
    setTimeout(() => {
      window.location.href = "/test.html";
    }, 500);
  });
}

if (loginAnonymous) {
  loginAnonymous.addEventListener("click", () => {
    const sessionUuid = setLoggedIn(STR.anonymousName, "", true);
    if (sessionInfo && sessionIdText) {
      sessionIdText.textContent = sessionUuid;
      sessionInfo.classList.remove("hidden");
    }
    showToast(STR.anonSuccess);
    updateNavState();
    updateLoginPanel();
    setTimeout(() => {
      window.location.href = "/test.html";
    }, 300);
  });
}

if (backToLogin) {
  backToLogin.addEventListener("click", () => {
    setAuthMode("login");
  });
}

if (logoutBubble) {
  logoutBubble.addEventListener("click", () => {
    sessionStorage.clear();
    localStorage.removeItem(SESSION_MAP_KEY);
    showToast(STR.logoutSuccess);
    updateNavState();
    updateLoginPanel();
    setTimeout(() => {
      window.location.href = "/";
    }, 300);
  });
}

if (testCards.length > 0) {
  if (requireTestAccess("/")) {
    testCards.forEach((card) => {
      card.addEventListener("click", () => {
        const instrument = card.dataset.instrument;
        if (instrument === "moca") {
          showToast(STR.mocaBuilding);
          return;
        }
        sessionStorage.setItem("instrument", instrument);
        window.location.href = "/exam.html";
      });
    });
  }
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function setMicState(isRecording) {
  if (!micButton) {
    return;
  }
  if (recordingDisabled) {
    micButton.classList.remove("is-recording");
    micButton.setAttribute("aria-pressed", "false");
    micButton.classList.add("hidden");
    return;
  }
  micButton.classList.remove("hidden");
  micButton.classList.toggle("is-recording", isRecording);
  micButton.setAttribute("aria-pressed", isRecording ? "true" : "false");
}

function buildSilentWav(durationMs = 500, sampleRate = 16000) {
  const numSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);
  return new Blob([buffer], { type: "audio/wav" });
}

function updateExamHeader() {
  if (sessionIdDisplay) {
    const storedId = sessionStorage.getItem(USER_SESSION_KEY);
    sessionIdDisplay.textContent = storedId || "--";
  }
}

function setProgressCounts(done, total) {
  if (doneCountEl) {
    doneCountEl.textContent = String(done);
  }
  if (totalCountEl) {
    totalCountEl.textContent = String(total);
  }
}

function setManualConfirmState(isConfirmed) {
  manualConfirmed = isConfirmed;
  if (!manualConfirmButton) {
    return;
  }
  manualConfirmButton.classList.toggle("is-active", manualConfirmed);
  manualConfirmButton.setAttribute("aria-pressed", manualConfirmed ? "true" : "false");
}

function updateManualPanel(question) {
  if (!manualPanel) {
    return;
  }
  const needsManual = Boolean(question && question.manual_confirm);
  manualPanel.classList.toggle("hidden", !needsManual);
  if (!needsManual) {
    setManualConfirmState(false);
  }
}

function updateAnswerPanel(question) {
  if (!answerPanel) {
    return;
  }
  const hidePanel = Boolean(question && question.recording_disabled);
  answerPanel.classList.toggle("hidden", hidePanel);
}

function updateQuestionImage(question) {
  if (!questionMedia || !questionImage || !questionImagePlaceholder) {
    return;
  }
  const questionId = question.question_id || question.id;
  const explicit = question.image_url || question.image;
  let imageUrl = null;
  if (explicit) {
    imageUrl = String(explicit);
    if (!imageUrl.startsWith("/")) {
      imageUrl = `/static/images/${imageUrl}`;
    }
  } else if (questionId && IMAGE_PLACEHOLDER_IDS.has(questionId)) {
    imageUrl = `/static/images/${questionId}.png`;
  }

  if (!imageUrl) {
    questionMedia.classList.add("hidden");
    return;
  }

  questionMedia.classList.remove("hidden");
  questionImagePlaceholder.classList.remove("hidden");
  questionImagePlaceholder.textContent = "可放置題目圖片";
  questionImage.classList.add("hidden");
  questionImage.src = imageUrl;
  questionImage.onload = () => {
    questionImage.classList.remove("hidden");
    questionImagePlaceholder.classList.add("hidden");
  };
  questionImage.onerror = () => {
    questionImage.classList.add("hidden");
    questionImagePlaceholder.textContent = "尚未提供圖片";
    questionImagePlaceholder.classList.remove("hidden");
  };
}

async function refreshProgressCounts() {
  if (!sessionId) {
    return;
  }
  const result = await apiGet(`/sessions/${sessionId}/progress`);
  if (!result.ok || !result.data) {
    return;
  }
  totalQuestions = result.data.total_questions;
  setProgressCounts(result.data.answered, result.data.total_questions);
}

async function createSession() {
  const userSessionId = sessionStorage.getItem(USER_SESSION_KEY) || "anonymous";
  const age = sessionStorage.getItem(USER_AGE_KEY);
  const payload = {
    patient_id: userSessionId,
    instrument: selectedInstrument,
    config: { age },
  };
  const result = await apiPostJson("/sessions", payload);
  if (!result.ok || !result.data || !result.data.session_id) {
    setStatus(STR.tryLater);
    return false;
  }
  sessionId = result.data.session_id;
  setStoredSessionId(selectedInstrument, sessionId);
  await refreshProgressCounts();
  return true;
}

function setCurrentQuestion(question, index) {
  currentQuestion = question;
  historyIndex = index;
  currentIndex = index + 1;
  recordingDisabled = Boolean(question && question.recording_disabled);
  setMicState(false);
  setManualConfirmState(false);
  updateManualPanel(question);
  updateAnswerPanel(question);
  updateQuestionImage(question);
  if (questionIndex) {
    questionIndex.textContent = String(currentIndex);
  }
  if (questionBigText) {
    questionBigText.textContent = question.text;
  }
  if (questionAudio) {
    questionAudio.src = question.audio_url;
  }
  if (resultEl) {
    const cached = answerCache.get(question.question_id);
    resultEl.textContent = cached || STR.noResult;
  }
  if (totalQuestions === null) {
    setProgressCounts(currentIndex, currentIndex);
  }
  setStatus(STR.waitAudio);
}

async function fetchNextQuestion() {
  const result = await apiGet(`/sessions/${sessionId}/next`);
  if (!result.ok || !result.data) {
    setStatus(STR.tryLater);
    if (viewResultsButton) {
      viewResultsButton.classList.remove("hidden");
    }
    return null;
  }
  return result.data;
}

async function loadNextQuestion() {
  if (!sessionId) {
    return;
  }
  if (historyIndex < questionHistory.length - 1) {
    setCurrentQuestion(questionHistory[historyIndex + 1], historyIndex + 1);
    return;
  }
  const nextQuestion = await fetchNextQuestion();
  if (!nextQuestion) {
    return;
  }
  if (currentQuestion && nextQuestion.question_id === currentQuestion.question_id) {
    const silentBlob = buildSilentWav();
    await uploadResponse(silentBlob, "silence.wav");
    const retry = await fetchNextQuestion();
    if (retry && retry.question_id !== currentQuestion.question_id) {
      questionHistory.push(retry);
      setCurrentQuestion(retry, questionHistory.length - 1);
      return;
    }
    setStatus(STR.tryLater);
    return;
  }
  questionHistory.push(nextQuestion);
  setCurrentQuestion(nextQuestion, questionHistory.length - 1);
}

function loadPreviousQuestion() {
  if (historyIndex <= 0) {
    return;
  }
  setCurrentQuestion(questionHistory[historyIndex - 1], historyIndex - 1);
}

async function startExam(instrument) {
  selectedInstrument = instrument;
  currentIndex = 0;
  historyIndex = -1;
  questionHistory.length = 0;
  answerCache.clear();
  totalQuestions = null;
  updateExamHeader();
  if (questionIndex) {
    questionIndex.textContent = "1";
  }
  if (questionBigText) {
    questionBigText.textContent = STR.startHint;
  }
  if (questionMedia) {
    questionMedia.classList.add("hidden");
  }
  if (manualPanel) {
    manualPanel.classList.add("hidden");
  }
  if (answerPanel) {
    answerPanel.classList.remove("hidden");
  }
  recordingDisabled = false;
  setMicState(false);
  if (questionAudio) {
    questionAudio.removeAttribute("src");
  }
  if (resultEl) {
    resultEl.textContent = STR.noResult;
  }
  setManualConfirmState(false);
  if (viewResultsButton) {
    viewResultsButton.classList.add("hidden");
  }
  if (examTitle) {
    examTitle.textContent = `${instrumentLabels[instrument]} ${STR.examSuffix}`;
  }
  setProgressCounts(0, totalQuestions || 0);
  setStatus(STR.starting);
  const storedSessionId = getStoredSessionId(instrument);
  if (storedSessionId) {
    sessionId = storedSessionId;
    const progress = await apiGet(`/sessions/${sessionId}/progress`);
    if (progress.ok) {
      await refreshProgressCounts();
      await loadNextQuestion();
      return;
    }
    sessionId = null;
  }
  const created = await createSession();
  if (!created) {
    return;
  }
  await loadNextQuestion();
}

async function beginRecording() {
  if (!sessionId || !currentQuestion) {
    setStatus(STR.needQuestion);
    return;
  }
  if (recordingDisabled) {
    setStatus(STR.waitAudio);
    return;
  }
  if (mediaRecorder) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  recordedChunks = [];
  vadStartMs = null;
  recordingStart = performance.now();

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  micSource = audioContext.createMediaStreamSource(stream);
  micSource.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  const checkVad = () => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    if (vadStartMs === null && rms > VAD_THRESHOLD) {
      vadStartMs = performance.now() - recordingStart;
    }
    rafId = requestAnimationFrame(checkVad);
  };
  checkVad();

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    cancelAnimationFrame(rafId);
    if (audioContext) {
      await audioContext.close();
    }
    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    await uploadResponse(blob);
    mediaRecorder = null;
  };

  mediaRecorder.start();
  setMicState(true);
  setStatus(STR.recording);
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }
  mediaRecorder.stop();
  setMicState(false);
  setStatus(STR.uploading);
}

async function handleNavigation(direction) {
  if (!sessionId) {
    showToast(STR.pickTest);
    return;
  }
  if (!currentQuestion) {
    if (direction === "next") {
      await loadNextQuestion();
    }
    return;
  }
  if (mediaRecorder && mediaRecorder.state === "recording") {
    pendingNavigation = direction;
    stopRecording();
    return;
  }
  if (direction === "next") {
    const hasAnswer = answerCache.has(currentQuestion.question_id);
    if (!hasAnswer) {
      pendingNavigation = "next";
      const silentBlob = buildSilentWav();
      await uploadResponse(silentBlob, "silence.wav");
      return;
    }
    await loadNextQuestion();
  } else if (direction === "prev") {
    loadPreviousQuestion();
  }
}

async function uploadResponse(blob, filename = "response.webm", manualOverride = null) {
  if (!sessionId || !currentQuestion) {
    setStatus(STR.needQuestion);
    pendingNavigation = null;
    return false;
  }
  const questionId = currentQuestion.question_id || currentQuestion.id;
  if (!questionId || !blob) {
    setStatus(STR.uploadFail);
    pendingNavigation = null;
    return false;
  }
  const formData = new FormData();
  formData.append("audio", blob, filename);
  formData.append("question_id", questionId);
  const query = new URLSearchParams({
    question_id: questionId,
  });
  if (vadStartMs !== null) {
    query.set("reaction_time_vad_ms", vadStartMs.toFixed(2));
  }
  if (manualOverride !== null) {
    query.set("manual_confirmed", manualOverride ? "true" : "false");
  } else if (manualConfirmed) {
    query.set("manual_confirmed", "true");
  }
  const result = await apiPostForm(
    `/sessions/${sessionId}/responses?${query.toString()}`,
    formData,
  );
  if (!result.ok) {
    setStatus(STR.uploadFail);
    pendingNavigation = null;
    return false;
  }
  const data = result.data || {};
  const transcript = data && data.transcript ? String(data.transcript) : "";
  if (currentQuestion) {
    answerCache.set(questionId, transcript || STR.noResult);
  }
  if (resultEl) {
    resultEl.textContent = transcript || STR.noResult;
  }
  setManualConfirmState(false);
  setStatus(STR.answered);
  await refreshProgressCounts();
  await maybeSubmitReport();
  if (pendingNavigation) {
    const direction = pendingNavigation;
    pendingNavigation = null;
    if (direction === "next") {
      await loadNextQuestion();
    } else if (direction === "prev") {
      loadPreviousQuestion();
    }
  }
  return true;
}

async function submitManualDecision(isConfirmed) {
  if (!sessionId || !currentQuestion) {
    setStatus(STR.needQuestion);
    return;
  }
  setStatus(STR.uploading);
  pendingNavigation = "next";
  const silentBlob = buildSilentWav();
  await uploadResponse(silentBlob, "manual.wav", isConfirmed);
}

async function submitReport({ showStatus = false, redirectOnSuccess = false } = {}) {
  if (!sessionId) {
    return false;
  }
  if (showStatus) {
    setStatus(STR.reporting);
  }
  const submitResult = await apiPost(`/sessions/${sessionId}/submit`);
  if (!submitResult.ok) {
    if (showStatus) {
      setStatus(STR.reportFail);
    }
    return false;
  }
  if (viewResultsButton) {
    viewResultsButton.classList.remove("hidden");
  }
  if (showStatus) {
    setStatus(STR.reportOk);
  }
  if (redirectOnSuccess) {
    window.location.href = RESULTS_URL;
  }
  return true;
}

async function maybeSubmitReport() {
  if (!sessionId) {
    return;
  }
  const progressResult = await apiGet(`/sessions/${sessionId}/progress`);
  if (!progressResult.ok || !progressResult.data) {
    return;
  }
  const progress = progressResult.data;
  if (progress.is_complete) {
    await submitReport({ showStatus: true });
    clearStoredSessionId(selectedInstrument);
    return;
  }
  if (totalQuestions !== null && currentIndex >= totalQuestions) {
    await submitReport({ showStatus: true });
    clearStoredSessionId(selectedInstrument);
  }
}

if (currentPage === "exam") {
  if (!requireTestAccess("/")) {
    selectedInstrument = null;
  } else {
    selectedInstrument = sessionStorage.getItem("instrument");
  }
  if (!selectedInstrument) {
    showToast(STR.missingInstrument);
    setTimeout(() => {
      window.location.href = "/test.html";
    }, 800);
  } else {
    startExam(selectedInstrument);
  }
}

if (questionAudio) {
  questionAudio.addEventListener("ended", () => {
    if (recordingDisabled) {
      return;
    }
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      beginRecording();
    }
  });
}

if (micButton) {
  micButton.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      beginRecording();
    }
  });
}

if (manualConfirmButton) {
  manualConfirmButton.addEventListener("click", () => {
    submitManualDecision(true);
  });
}

if (manualRejectButton) {
  manualRejectButton.addEventListener("click", () => {
    submitManualDecision(false);
  });
}

if (sendButton) {
  sendButton.addEventListener("click", async () => {
    await handleNavigation("next");
  });
}

if (prevQuestionButton) {
  prevQuestionButton.addEventListener("click", async () => {
    await handleNavigation("prev");
  });
}

if (nextQuestionButton) {
  nextQuestionButton.addEventListener("click", async () => {
    await handleNavigation("next");
  });
}

if (viewResultsButton) {
  viewResultsButton.addEventListener("click", async () => {
    const ok = await submitReport({ showStatus: true, redirectOnSuccess: true });
    if (!ok) {
      showToast(STR.reportFail);
    }
  });
}
