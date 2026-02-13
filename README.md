# 認知問答篩檢系統（研究原型）

> **重要聲明**  
> 本專案為「研究／輔助篩檢」原型，用於量測口語問答反應時間與回答正確度。  
> **不得**用於失智症診斷，亦不得取代臨床評估。任何結果必須由合格醫事人員解讀，並搭配經授權、經驗證之量表與臨床流程。

## 專案簡介

此專案提供一套 Web 版流程：

1. 前端播放題目音檔並錄音。
2. 後端接收音檔，進行語音轉文字與評分。
3. 產出每題反應時間、正確度與整體報表。

## 主要功能

- 使用 `MediaRecorder` 進行瀏覽器錄音。
- FastAPI 提供測驗流程 API（建立 session、取題、上傳回答、報表）。
- 反應時間同時支援：
  - `reaction_time_whisper_ms`（Whisper 時間戳）
  - `reaction_time_vad_ms`（前端 VAD 粗估）
- 規則式判分 + LLM 判分（結構化輸出）。
- SQLite 儲存 session、作答與量表分數。
- 作答完成後可自動提交完整報表。

## 授權與使用限制（非常重要）

- **MMSE**、**MoCA** 可能涉及版權、授權或訓練認證要求。請勿在公開 repo 放入完整題目內容。
- **AD-8** 也有使用授權與政策限制，請依官方規範執行。
- 公開專案建議僅保留：資料 schema、範例、計分引擎。完整題庫請放私有環境。

## 專案結構

```text
backend/
  app/
    api.py
    main.py
    models.py
    question_bank.py
    reporting.py
    storage.py
    transcribe.py
    reaction_time.py
    scoring_rules.py
    llm_judge.py
    instruments/
frontend/
  index.html
  test.html
  exam.html
  qa.html
  app.js
  styles.css
static/
  questions/
data/
scripts/
tests/
```

## 環境需求

- Python `3.11+`
- 建議使用虛擬環境（`venv`）

## 安裝與設定

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env
```

## 啟動方式

```bash
uvicorn backend.app.main:app --reload
```

啟動後開啟：`http://localhost:8000/`  
前端檔案由 FastAPI 靜態掛載，不需額外前端 dev server。

## 前端頁面說明

- `/`：登入與註冊
- `/test.html`：選擇量表
- `/exam.html`：作答頁（播放題目、錄音、上傳）
- `/qa.html`：量表 Q&A 說明

## API 端點（MVP）

- `POST /api/sessions`：建立 session
- `GET /api/sessions/{session_id}/next`：取得下一題
- `POST /api/sessions/{session_id}/responses`：上傳作答音檔
- `GET /api/sessions/{session_id}/progress`：取得作答進度
- `GET /api/sessions/{session_id}/report`：取得 session 報表
- `POST /api/sessions/{session_id}/submit`：產生並提交報表

## 測試

```bash
pytest
```

## 題庫與音檔

- 題目音檔放在 `static/questions/`（例：`MMSE_Q1.mp3`）。
- 題庫 JSON 的 `id` 必須對應音檔檔名。
- 避免在公開 repo 放入未授權的量表全文。

### 題庫 JSON 範例

```json
[
  { "id": "MMSE_Q1", "text": "題目內容" }
]
```

### 產生題目語音（MP3）

```bash
pip install edge-tts
python scripts/tts_questions.py --questions data/MMSE_questions.json --output static/questions
```

## 環境變數

- `OPENAI_API_KEY`：啟用語音轉文字與 LLM 判分
- `COGSCREEN_API_URL`：外部報表 API（`/submit` 會送出）
- `COGSCREEN_REPORT_DIR`：報表輸出資料夾
- `COGSCREEN_TIMEZONE`：時區（預設 `Asia/Taipei`）
