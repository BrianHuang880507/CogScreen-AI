# 失智階段判斷條件說明（本專案）

## 1) 目的與定位
- 本專案輸出的是「研究/篩檢風險等級」，不是臨床診斷。
- 主要階段欄位是 `summary.screening_risk_band`，可能值為：`none` / `mild` / `moderate` / `severe`。

## 2) 單題正確與否判定流程
每一題 `is_correct` 的優先順序如下：
1. `manual_confirmed`（人工覆核）
2. `rule_score.is_correct`（規則比對）
3. `llm_judge.is_correct`（LLM 判斷）
4. 若都沒有，則為 `null`

程式位置：`backend/app/reporting.py`（`build_report`）。

## 3) 量表分級規則

### SPMSQ（目前主流程最常用）
- 先算 `errors`（錯誤題數）。
- 教育程度校正：
  - `grade_school_or_less`：`adjusted_errors = max(0, errors - 1)`
  - `high_school_or_more`：`adjusted_errors = errors + 1`
- 分級：
  - `adjusted_errors <= 2` -> `normal`
  - `3-4` -> `mild`
  - `5-7` -> `moderate`
  - `>= 8` -> `severe`

程式位置：`backend/app/instruments/spmsq.py`。

### MMSE
- 依 cutoff（可配置）分級：
  - `>= normal(預設 24)` -> `normal`
  - `>= mild(預設 18)` -> `mild`
  - `>= moderate(預設 10)` -> `moderate`
  - 其餘 -> `severe`

程式位置：`backend/app/instruments/mmse.py`。

### MoCA
- 以 cutoff（預設 26）判斷 `screen_positive`。
- 教育年數 `<=12` 且原始分數 `<30` 時，`adjusted_score +1`。
- MoCA 本身主要回傳篩檢陽性資訊，後續在 summary 併入追蹤建議。

程式位置：`backend/app/instruments/moca.py`。

### AD8
- 總分 `>=2` 視為 `screen_positive`。

程式位置：`backend/app/instruments/ad8.py`。

## 4) 最終風險等級（screening_risk_band）如何合成
- 系統會把各量表 severity 映射到等級：
  - `normal/none -> 0`
  - `mild -> 1`
  - `moderate -> 2`
  - `severe -> 3`
- 最終 `screening_risk_band` 取「最高嚴重度」。
- `needs_followup` 來自 `screen_positive`，只要任一量表觸發陽性即為 `true`。

程式位置：`backend/app/reporting.py`（`_build_summary`）。

## 5) 遊戲分數在目前版本的角色
- 邏輯/反應/專注遊戲分數目前不直接參與 `screening_risk_band` 計算。
- 遊戲資料用於結果頁趨勢觀察與 CSV 明細輸出。

前端位置：`frontend/results.js`。

## 6) 結果輸出欄位（本次已補強）
- 題目明細：`question_text`, `manual_confirmed`, `rule_score`, `llm_judge`, `created_at`。
- 遊戲明細：各遊戲 payload 的 `details`（事件/點擊/嘗試紀錄）。
- 可於結果頁按「下載 CSV」一次匯出。

## 7) 重要提醒
- 這是篩檢與追蹤機制，不可替代臨床診斷。
- 若 `needs_followup=true`，建議轉介專業醫療評估。
