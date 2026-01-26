# Cognitive Q&A Screening (Research Prototype)

> **重要聲明（務必保留）**  
> 這是一個「研究／輔助篩檢」原型，用於量測口語問答反應與回答正確度；**不能**用來做失智症診斷或取代臨床評估。任何結果都必須由合格醫事人員解讀，並以經授權、經驗證的量表與臨床流程為準。

## Overview

This project is a **research/assisted screening** prototype for measuring spoken Q&A reaction time and response accuracy using a web-based workflow (browser recording + FastAPI backend). It **must not** be used for dementia diagnosis.

## Features

- Web UI using MediaRecorder for audio recording and question playback.
- FastAPI backend for session flow, transcription, scoring, and reporting.
- Reaction time from:
  - Whisper word timestamps (`reaction_time_whisper_ms`).
  - Energy/VAD estimate from client-side audio analysis (`reaction_time_vad_ms`).
- Rule-based scoring + LLM judge with structured outputs.
- SQLite storage (sessions/responses/instrument_scores) + CSV export.

## Licensing / Training Notices (Very Important)

- **MMSE** and **MoCA** are protected instruments with licensing/training requirements. Do **not** ship or publish their full question text in this repo. Obtain proper permissions before use.
- **AD-8** also has licensing/permission policies. Do **not** include full instrument text unless authorized.

Only schemas/examples are included here; external instrument JSONs should live in a private location.

## Project Structure

```
backend/
  app/
    api.py
    main.py
    models.py
    storage.py
    transcribe.py
    reaction_time.py
    scoring_rules.py
    llm_judge.py
    instruments/
frontend/
  index.html
  app.js
  styles.css
static/
  questions/
```

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env
```

## Run (Backend + Frontend)

```bash
uvicorn backend.app.main:app --reload
```

Open the UI at http://localhost:8000/ (served by FastAPI).

## Tests

```bash
pytest
```

## Notes on Question Bank

Place question audio files under `static/questions/` (e.g., `Q1.wav`). Update `backend/app/api.py` question entries accordingly. Avoid storing copyrighted instrument content in this repo.
