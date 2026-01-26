# 失智／認知問答偵測系統（Research Prototype, Ubuntu + Web UI）— Codex Agent 指南

> **重要聲明（務必保留）**  
> 這是一個「研究／輔助篩檢」原型，用於量測口語問答反應與回答正確度；**不能**用來做失智症診斷或取代臨床評估。任何結果都必須由合格醫事人員解讀，並以經授權、經驗證的量表與臨床流程為準。

---

## 0) 平台與介面假設

- OS：**Ubuntu (建議 22.04+ / 24.04+)**
- UI：**Web（瀏覽器）**
- 後端：Python 3.11+（FastAPI）
- 前端：純 HTML/JS（MVP 先不要 React 以降低複雜度；後續再升級成 SPA）

---

## 1) 專案目標

打造一套以 **Python** 為主的「口語問答」系統原型，核心輸出：

1. **反應時間 (reaction_time_ms)**：從「題目播放結束」到「受試者開始回答（第一段語音開始 / 第一個詞開始）」的時間差（毫秒）。
2. **回答正確度 (accuracy)**：受試者回答是否符合該題的「預期答案／判分規則」。
3. **量表分數與風險分級（可配置）**：支援 AD-8 / SPMSQ / MMSE / MoCA 的「分數計算」與「簡易分級規則」（僅供研究與趨勢追蹤，不作診斷）。

---

## 2) Web 架構（MVP）

### 2.1 前端（Browser）
- 使用 `getUserMedia()` + `MediaRecorder` 錄音
- 題目播放：
  - 題目音檔由後端提供 URL（`/static/questions/Q1.wav`）
  - 前端用 `<audio>` 播放，監聽 `ended` 事件：
    - `ended` 觸發瞬間：**視為題目結束時間 (t=0)**  
    - 立即開始錄音（保留前段靜音）
- 上傳回答音檔到後端（multipart/form-data）

> 注意：麥克風權限需要 HTTPS 或 localhost；MVP 可先在 `http://localhost` 開發。

### 2.2 後端（FastAPI）
建議 API：
- `POST /api/sessions`：建立 session（patient_id 匿名代碼、選擇量表、設定）
- `GET /api/sessions/{session_id}/next`：取得下一題（題目文字、音檔 URL、評分規則摘要）
- `POST /api/sessions/{session_id}/responses`：上傳回答音檔（question_id、audio blob、client-side timestamps）
- `GET /api/sessions/{session_id}/report`：回傳 session 報表（每題反應時間、正確率、量表分數、趨勢）

---

## 3) 反應時間：如何定義與量測

### 3.1 你現在的公式會不會「很延遲」？
你寫的：
- `reaction_time_ms = first_word.start * 1000`

**這個 reaction_time 本身不會因為 API 回傳慢而變大**，因為 `first_word.start` 是「音檔內部時間軸」的起點（相對於你開始錄音的那一刻）。  
但要注意兩件事：

1) **你必須等轉錄完成才拿得到 timestamps**（也就是 UI 上顯示反應時間會「晚幾秒」是正常的）。  
2) 開啟 **word timestamps 會增加轉錄延遲**：OpenAI 文件明確提到「word timestamps 會額外增加 latency，segment timestamps 則不會」。  
（因此若你只要粗略反應時間，segment 可能更快；若要精準 onset，用 word 或改用本地 VAD。）  

> 參考：OpenAI Audio verbose_json 文件對 timestamp_granularities 的說明（word 會增加 latency）。  

### 3.2 建議：同時保存兩個 reaction time（最佳實務）
- `reaction_time_vad_ms`（前端/後端本地 VAD 偵測語音開始，**可即時**）
- `reaction_time_whisper_ms`（Whisper word timestamp，**可回溯對齊**）

這樣你可以：
- UI 即時顯示（VAD）
- 報表用較穩定的對齊結果（Whisper），並做品質檢查（兩者差距過大則標示需人工查看）

### 3.3 低延遲需求（可選）
若你想即時字幕/即時回饋，可考慮 OpenAI 的 **Realtime transcription**（適合 streaming transcription）。  
> 參考：OpenAI Realtime transcription 指南。

---

## 4) Speech-to-Text（Whisper / Transcriptions）

### 4.1 建議模型
- 若要 `verbose_json` + `timestamp_granularities=["word"]`：建議用 `whisper-1`（文件列出 whisper-1 支援 verbose_json）。  
- `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 目前文件顯示輸出格式較受限（常見為 json/text），不一定能拿到 verbose_json + word timestamps。

> 參考：OpenAI Speech-to-text 文件對各模型輸出格式的描述。

### 4.2 轉錄封裝（transcribe_audio）
- 以單一模組 `transcribe.py` 封裝 OpenAI 呼叫
- 參數：model、language、response_format、timestamp_granularities

---

## 5) 回答正確度：用 OpenAI Agent/LLM 來判分（建議做法）

你希望「語音利用 openai agent 分析是否正確」。建議流程：

1) 音檔 → Speech-to-Text → `transcript` + timestamps  
2) **LLM Judge**（OpenAI 模型）把 transcript 轉成結構化判分結果：
   - `normalized_answer`（把口語答案正規化）
   - `is_correct`（true/false）
   - `confidence`（0~1）
   - `reason`（簡短理由）
   - `matched_expected`（匹配到的標準答案/關鍵字）
3) 後端再把 judge 結果與 rule-based scoring 交叉驗證（可選）

### 5.1 為什麼要用 Structured Outputs
為了避免模型輸出格式漂移，建議使用 **Structured Outputs**（讓輸出符合你提供的 JSON Schema）。  
> 參考：OpenAI Structured Outputs 指南。

### 5.2 Agents SDK（可選）
如果你想「可追蹤、可審計」的多步判分工作流，可以用 **OpenAI Agents SDK** 把「轉錄 → 判分 → 寫 DB → 生成報告」做成 traceable pipeline。  
> 參考：OpenAI Agents SDK 指南。

---

## 6) 題庫與量表：資料與版權／授權（非常重要）

你提到的量表：
- AD-8（極早期失智症篩檢量表）
- SPMSQ（Short Portable Mental Status Questionnaire）
- MMSE（Mini-Mental State Examination）
- MoCA（Montreal Cognitive Assessment）

### 6.1 核心原則：Repo 不要內建「受版權保護」的題目全文
請做成「題庫/量表可外掛」：
- `data/instruments/<instrument>.json` 放在 **私有** 位置
- 公開 repo 只放「欄位 schema、示例（非完整題目）、與 scoring engine」

#### MMSE 的注意事項
MMSE 是受版權保護、且有授權發行單位（例如 PAR 也提供購買）。請勿把題目全文直接放到公開 repo。  
> 參考：PAR 對 MMSE 產品與授權資訊。

#### MoCA 的注意事項
MoCA 官網明確提到 permission / licensing 規範，且「施測與計分」可能需要 training/certification（依官方政策）。  
> 參考：MoCA permission 與 Training & Certification 說明。

#### AD8 的注意事項
AD8 也有 permission/licensing policy（特定用途可能需要授權）。  
> 參考：AD8 Permission & Licensing Policy 文件。

---

## 7) 量表分數與分級（只做「篩檢/風險」：不作診斷）

### 7.1 AD-8
- 分數範圍：0–8
- 常見解讀：**總分 ≥ 2** 建議進一步評估（屬初步篩檢訊號）  
> 參考：AD8 cutoff ≥2 的說明與量表文件。

> AD-8 通常較偏「是否有認知改變」的篩檢，不建議硬做嚴重度分級（可輸出：negative / positive）。

### 7.2 SPMSQ（Pfeiffer）
Stanford Geriatrics 的 scoring 說明（含教育調整）：
- 0–2 errors：normal mental functioning  
- 3–4 errors：mild cognitive impairment  
- 5–7 errors：moderate cognitive impairment  
- 8+ errors：severe cognitive impairment  
- 教育調整：grade school 或更低 → **允許多 1 個錯誤**；高中以上 → **少 1 個錯誤**  
> 參考：Stanford SPMSQ Scoring / Note on scoring。

### 7.3 MMSE（注意：需合法授權取得題目/表單）
- 常見總分：0–30（越高越好）  
- cutoff、教育校正與嚴重度分級會依族群/教育/語言而不同；請做成**可配置**，並在 UI 明示「僅供參考」。  
> 參考：RehabMeasures 對 MMSE 分數解讀摘要；以及 PAR 的授權資訊。

### 7.4 MoCA（注意：training/cert 與 permission）
- 分數：0–30
- 常見 cut-off：26（但研究顯示不同族群/教育可能需要不同 cut-off）
- 教育加分：**≤12 年教育者加 1 分**（但 30/30 不再加）  
> 參考：MoCA FAQ 對教育加分與滿分的說明；以及研究指出 cut-off 可能因族群而異。

---

## 8) 「嚴重程度」演算法（建議用：可配置的風險分級）

你想加入演算法判斷嚴重程度，建議不要輸出「失智嚴重度（診斷等級）」，
而是輸出：

- `risk_band`: none / mild / moderate / severe（基於量表解讀規則）
- `needs_followup`: true/false（例如 AD8 ≥2 或任一量表達異常）
- `notes`: (例如「cutoff 因教育程度不同」)

### 8.1 聚合規則（可配置，預設採最嚴重者）
- `risk_band = max(severity_from_spmsq, severity_from_mmse, severity_from_moca)`  
- AD8 只做 `screen_positive`（true/false）

> 並保留每一量表的原始分數與解讀，讓臨床端可追溯。

---

## 9) Repo 結構（建議：Web 版）

```
cognitive-qna-screening/
  AGENTS.md              # 給 Codex 自動讀的指引（建議）
  README.md
  pyproject.toml
  .env.example
  backend/
    app/
      main.py            # FastAPI
      api.py             # routers
      models.py          # pydantic schemas
      storage.py         # SQLite
      transcribe.py      # OpenAI STT
      reaction_time.py   # onset/VAD/whisper parsing
      scoring_rules.py   # rule-based scoring
      llm_judge.py       # LLM/Agent 判分（Structured Outputs）
      instruments/
        ad8.py
        spmsq.py
        mmse.py
        moca.py
  frontend/
    index.html
    app.js               # MediaRecorder + 播放題目 + 上傳
    styles.css
  tests/
    test_reaction_time.py
    test_spmsq_scoring.py
    test_llm_judge_schema.py
```

> 提醒：Codex 對指引檔案的自動發現通常看 `AGENTS.md` 等命名；若你只放 `agent.md` 可能被忽略。  
> 參考：OpenAI Codex 對 AGENTS.md 的說明。

---

## 10) 安全、隱私與合規（務必落實）

- 受試者同意：錄音與上傳雲端前要清楚告知並取得同意
- patient_id 匿名化：不得存姓名/身分證等
- 資料最小化：支援 `--delete-audio-after-transcribe` 或後台設定
- 權限控管：Ubuntu 檔案權限、可選磁碟加密、審計日誌
- UI 顯示：所有結果標註「研究/篩檢」與「需專業解讀」

---

## 11) MVP Done 定義

- Web UI 可跑完整 session（逐題播放 → 錄音 → 上傳 → 出結果）
- 每題有：音檔、轉錄文字、reaction_time_ms（至少一種算法）、correct
- SQLite 落地 + CSV 匯出
- 至少 3 個測試：reaction_time 解析、SPMSQ 計分、LLM judge schema 驗證
