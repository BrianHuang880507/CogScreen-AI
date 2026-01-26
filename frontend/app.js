const patientIdInput = document.getElementById("patientId");
const instrumentSelect = document.getElementById("instrument");
const createSessionButton = document.getElementById("createSession");
const loadQuestionButton = document.getElementById("loadQuestion");
const startRecordingButton = document.getElementById("startRecording");
const stopRecordingButton = document.getElementById("stopRecording");
const questionText = document.getElementById("questionText");
const questionAudio = document.getElementById("questionAudio");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

let sessionId = null;
let currentQuestion = null;
let mediaRecorder = null;
let recordedChunks = [];
let vadStartMs = null;
let recordingStart = null;
let audioContext = null;
let analyser = null;
let micSource = null;
let rafId = null;

const VAD_THRESHOLD = 0.02;

const setStatus = (message) => {
  statusEl.textContent = message;
};

createSessionButton.addEventListener("click", async () => {
  const payload = {
    patient_id: patientIdInput.value || "anonymous",
    instrument: instrumentSelect.value || null,
    config: {},
  };
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  sessionId = data.session_id;
  setStatus(`Session created: ${sessionId}`);
});

loadQuestionButton.addEventListener("click", async () => {
  if (!sessionId) {
    setStatus("請先建立 session");
    return;
  }
  const response = await fetch(`/api/sessions/${sessionId}/next`);
  if (!response.ok) {
    setStatus("沒有更多題目");
    return;
  }
  currentQuestion = await response.json();
  questionText.textContent = currentQuestion.text;
  questionAudio.src = currentQuestion.audio_url;
  startRecordingButton.disabled = false;
  setStatus("已取得題目，請播放題目音檔。播放結束後會自動開始錄音。");
});

questionAudio.addEventListener("ended", () => {
  if (!startRecordingButton.disabled) {
    beginRecording();
  }
});

startRecordingButton.addEventListener("click", () => {
  beginRecording();
});

stopRecordingButton.addEventListener("click", () => {
  stopRecording();
});

async function beginRecording() {
  if (!sessionId || !currentQuestion) {
    setStatus("請先取得題目");
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
  startRecordingButton.disabled = true;
  stopRecordingButton.disabled = false;
  setStatus("錄音中...");
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }
  mediaRecorder.stop();
  stopRecordingButton.disabled = true;
  startRecordingButton.disabled = false;
  setStatus("上傳中...");
}

async function uploadResponse(blob) {
  const formData = new FormData();
  formData.append("audio", blob, "response.webm");
  formData.append("question_id", currentQuestion.question_id);
  if (vadStartMs !== null) {
    formData.append("reaction_time_vad_ms", vadStartMs.toFixed(2));
  }
  const response = await fetch(`/api/sessions/${sessionId}/responses`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  resultEl.textContent = JSON.stringify(data, null, 2);
  setStatus("完成。可取得下一題。\n");
}
