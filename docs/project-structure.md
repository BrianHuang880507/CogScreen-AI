# 專案文件架構總覽

本文件整理 CogScreen-AI 的主要目錄用途，方便開發、部署與維運時快速定位。

## 1) 根目錄

- `README.md`：專案說明與快速啟動
- `pyproject.toml` / `requirements.txt`：Python 相依套件定義
- `Dockerfile` / `docker-compose.yml`：容器化部署設定
- `main.py`：啟動入口（整合用）

## 2) Backend（API 與評分邏輯）

位置：`backend/app/`

- `main.py`：FastAPI 應用初始化
- `api.py`：API 路由（測試、遊戲、結果）
- `models.py`：資料模型定義
- `question_bank.py`：題庫讀取與供題邏輯
- `scoring_rules.py`：規則評分邏輯
- `llm_judge.py`：LLM 判斷與結構化輸出
- `reporting.py`：結果彙整、統計、輸出
- `storage.py`：儲存層（session / report）
- `transcribe.py`：語音轉文字相關流程
- `reaction_time.py`：反應時間相關處理
- `instruments/`：量表題目與流程模組（AD8/MMSE/MOCA/SPMSQ）

## 3) Frontend（頁面與互動）

位置：`frontend/`

- `index.html`：登入/首頁
- `test.html`：量表選單
- `exam.html`：題目作答頁
- `games.html`：遊戲選單頁
- `game-logic.html` / `game-reaction.html` / `game-focus.html`：三款遊戲頁
- `results.html`：結果分析頁（含日期雷達卡片與 CSV 下載）
- `qa.html`：Q&A 頁
- `styles.css`：全站樣式
- `app.js`：共用前端狀態與 API 串接
- `games.js` / `game-utils.js`：遊戲入口與共用邏輯
- `results.js`：結果頁資料整理與下載匯出

## 4) Data（題庫與測試資料）

位置：`data/`

- `AD8_questions.json`
- `MMSE_questions.json`
- `SPMSQ_questions.json`
- `questions_sample.json`

用途：量表題庫與樣本資料。

## 5) Static（靜態資源）

位置：`static/`

- `static/images/`：UI 與遊戲圖片
- `static/audio/`：語音或音效素材
- `static/questions/`：題目相關靜態檔

## 6) Scripts（工具腳本）

位置：`scripts/`

- `test_report.sh` / `test_report.ps1`：測試與報告工具腳本
- `tts_questions.py`：題目 TTS 相關處理
- `seed_mock_session.py`：模擬測試資料產生

## 7) Tests（自動化測試）

位置：`tests/`

- `conftest.py`：測試共用設定
- `test_llm_judge_schema.py`：LLM 輸出格式測試
- `test_reaction_time.py`：反應時間邏輯測試
- `test_spmsq_scoring.py`：SPMSQ 評分測試

## 8) Docs（文件）

位置：`docs/`

- `dementia-stage-criteria.md`：失智階段判斷條件說明
- `project-structure.md`（本文件）：專案結構索引

---

## 建議維護規則

- 新增前端頁面：HTML/JS 放 `frontend/`，共用樣式優先整併到 `styles.css`
- 新增 API：路由進 `api.py`，邏輯拆到 `backend/app` 對應模組
- 新增量表題庫：JSON 放 `data/`，並在 `question_bank.py` 註冊
- 新增文件：放 `docs/`，並在 `README.md` 增加連結
