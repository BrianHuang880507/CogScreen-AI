from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.app import models, reaction_time, scoring_rules, storage
from backend.app.llm_judge import judge_answer
from backend.app.transcribe import transcribe_audio

router = APIRouter()

QUESTION_BANK = [
    {
        "question_id": "Q1",
        "text": "請說出今天的日期。",
        "audio_url": "/static/questions/Q1.wav",
        "scoring_rule": {"type": "numeric_range", "min_value": 1, "max_value": 31},
    },
    {
        "question_id": "Q2",
        "text": "請說出您目前所在的城市名稱。",
        "audio_url": "/static/questions/Q2.wav",
        "scoring_rule": {"type": "contains_any", "expected": ["台北", "高雄", "台中"]},
    },
]


@router.post("/sessions", response_model=models.SessionCreateResponse)
async def create_session(payload: models.SessionCreateRequest) -> models.SessionCreateResponse:
    session_id = str(uuid.uuid4())
    storage.create_session(session_id, payload.patient_id, payload.instrument, payload.config)
    return models.SessionCreateResponse(session_id=session_id)


@router.get("/sessions/{session_id}/next", response_model=models.QuestionResponse)
async def next_question(session_id: str) -> models.QuestionResponse:
    responses = storage.list_responses(session_id)
    index = len(responses)
    if index >= len(QUESTION_BANK):
        raise HTTPException(status_code=404, detail="No more questions")
    question = QUESTION_BANK[index]
    return models.QuestionResponse(**question)


@router.post("/sessions/{session_id}/responses", response_model=models.ResponseCreateResponse)
async def submit_response(
    session_id: str,
    question_id: str,
    reaction_time_vad_ms: float | None = None,
    audio: UploadFile = File(...),
) -> models.ResponseCreateResponse:
    response_id = str(uuid.uuid4())
    upload_dir = Path("./data/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    audio_path = upload_dir / f"{response_id}_{audio.filename}"
    content = await audio.read()
    audio_path.write_bytes(content)

    transcript = None
    transcription_payload: dict[str, Any] | None = None
    if os.getenv("OPENAI_API_KEY"):
        transcription_payload = transcribe_audio(
            str(audio_path),
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
        transcript = transcription_payload.get("text") if transcription_payload else None

    reaction_time_whisper_ms = (
        reaction_time.reaction_time_whisper_ms(transcription_payload)
        if transcription_payload
        else None
    )

    question = next((q for q in QUESTION_BANK if q["question_id"] == question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    rule_score = None
    llm_judge = None
    if transcript:
        rule_score = scoring_rules.score_answer(transcript, question["scoring_rule"])
        if os.getenv("OPENAI_API_KEY"):
            llm_judge = judge_answer(
                transcript,
                question["scoring_rule"].get("expected", []),
                question["scoring_rule"].get("type", "exact"),
            )

    storage.save_response(
        response_id=response_id,
        session_id=session_id,
        question_id=question_id,
        transcript=transcript,
        reaction_time_whisper_ms=reaction_time_whisper_ms,
        reaction_time_vad_ms=reaction_time_vad_ms,
        rule_score=rule_score,
        llm_judge=llm_judge,
    )

    return models.ResponseCreateResponse(
        response_id=response_id,
        transcript=transcript,
        reaction_time_whisper_ms=reaction_time_whisper_ms,
        reaction_time_vad_ms=reaction_time_vad_ms,
        rule_score=rule_score,
        llm_judge=llm_judge,
    )


@router.get("/sessions/{session_id}/report", response_model=models.ReportResponse)
async def session_report(session_id: str) -> models.ReportResponse:
    responses = storage.list_responses(session_id)
    instrument_scores = storage.list_instrument_scores(session_id)
    return models.ReportResponse(
        session_id=session_id,
        responses=responses,
        instrument_scores=instrument_scores,
    )
