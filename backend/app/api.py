from __future__ import annotations

import os
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.app import models, question_bank, reaction_time, reporting, scoring_rules, storage
from backend.app.llm_judge import judge_answer
from backend.app.transcribe import transcribe_audio

router = APIRouter()

QUESTION_BANK = question_bank.load_all_questions()


@router.post("/sessions", response_model=models.SessionCreateResponse)
async def create_session(payload: models.SessionCreateRequest) -> models.SessionCreateResponse:
    session_id = str(uuid.uuid4())
    storage.create_session(session_id, payload.patient_id, payload.instrument, payload.config)
    return models.SessionCreateResponse(session_id=session_id)


@router.get("/sessions/{session_id}/next", response_model=models.QuestionResponse)
async def next_question(session_id: str) -> models.QuestionResponse:
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    instrument = session.get("instrument")
    questions = question_bank.filter_questions(QUESTION_BANK, instrument)
    responses = storage.list_responses(session_id)
    index = len(responses)
    if index >= len(questions):
        raise HTTPException(status_code=404, detail="No more questions")
    question = questions[index]
    return models.QuestionResponse(**question)


@router.post("/sessions/{session_id}/responses", response_model=models.ResponseCreateResponse)
async def submit_response(
    session_id: str,
    question_id: str,
    reaction_time_vad_ms: float | None = None,
    manual_confirmed: bool | None = None,
    audio: UploadFile = File(...),
) -> models.ResponseCreateResponse:
    response_id = str(uuid.uuid4())
    upload_dir = Path("./data/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    audio_path = upload_dir / f"{response_id}_{audio.filename}"
    content = await audio.read()
    audio_path.write_bytes(content)

    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        config = json.loads(session.get("config_json") or "{}")
    except json.JSONDecodeError:
        config = {}

    question = next((q for q in QUESTION_BANK if q["question_id"] == question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    exclude_from_scoring = bool(question.get("exclude_from_scoring"))
    recording_disabled = bool(question.get("recording_disabled"))

    transcript = None
    transcription_payload: dict[str, Any] | None = None
    if os.getenv("OPENAI_API_KEY") and not recording_disabled and not exclude_from_scoring:
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

    rule_score = None
    llm_judge = None
    if transcript and not exclude_from_scoring:
        context = {
            "timezone": os.getenv("COGSCREEN_TIMEZONE", "Asia/Taipei"),
            "patient_age": config.get("age"),
            "patient_phone": config.get("phone"),
            "patient_address": config.get("address"),
            "patient_birthday": config.get("birthday"),
            "patient_mother_name": config.get("mother_name"),
            "president_current": config.get("president_current"),
            "president_previous": config.get("president_previous"),
        }
        prepared_rule, skip_scoring = scoring_rules.prepare_rule(question["scoring_rule"], context)
        if not skip_scoring:
            rule_score = scoring_rules.score_answer(transcript, prepared_rule)
            if os.getenv("OPENAI_API_KEY"):
                llm_judge = judge_answer(
                    transcript,
                    prepared_rule.get("expected", []),
                    prepared_rule.get("type", "exact"),
                )

    storage.save_response(
        response_id=response_id,
        session_id=session_id,
        question_id=question_id,
        transcript=transcript,
        reaction_time_whisper_ms=reaction_time_whisper_ms,
        reaction_time_vad_ms=reaction_time_vad_ms,
        manual_confirmed=manual_confirmed,
        rule_score=rule_score,
        llm_judge=llm_judge,
    )

    return models.ResponseCreateResponse(
        response_id=response_id,
        transcript=transcript,
        reaction_time_whisper_ms=reaction_time_whisper_ms,
        reaction_time_vad_ms=reaction_time_vad_ms,
        manual_confirmed=manual_confirmed,
        rule_score=rule_score,
        llm_judge=llm_judge,
    )


@router.get("/sessions/{session_id}/report", response_model=models.ReportResponse)
async def session_report(session_id: str) -> models.ReportResponse:
    try:
        report_payload = reporting.build_report(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found") from None
    return models.ReportResponse(**report_payload)


@router.get("/sessions/{session_id}/progress", response_model=models.ProgressResponse)
async def session_progress(session_id: str) -> models.ProgressResponse:
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    instrument = session.get("instrument")
    questions = question_bank.filter_questions(QUESTION_BANK, instrument)
    answered = len(storage.list_responses(session_id))
    total = len(questions)
    return models.ProgressResponse(
        session_id=session_id,
        answered=answered,
        total_questions=total,
        is_complete=answered >= total,
    )


@router.post("/sessions/{session_id}/submit", response_model=models.SubmitResponse)
async def submit_report(session_id: str) -> models.SubmitResponse:
    try:
        report_payload = reporting.build_report(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found") from None

    api_url = os.getenv(
        "COGSCREEN_API_URL",
        "https://play-game-api.azurewebsites.net/v1.0/telemetry/info",
    )
    try:
        async with reporting.http_client() as client:
            response = await client.post(api_url, json={"info": report_payload})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Submit failed: {exc}") from exc

    reporting.save_report(report_payload, session_id)
    return models.SubmitResponse(**report_payload)
