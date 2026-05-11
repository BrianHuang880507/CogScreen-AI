from __future__ import annotations

import os
import json
import uuid
import logging
import re
import shutil
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from datetime import datetime

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator

from backend.app import models, question_bank, reaction_time, reporting, scoring_rules, storage
from backend.app.llm_judge import judge_answer
from backend.app.transcribe import transcribe_audio

router = APIRouter()
logger = logging.getLogger(__name__)

QUESTION_BANK = question_bank.load_all_questions()
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FOCUS_LEVELS_PATH = PROJECT_ROOT / "frontend" / "focus-levels.js"
FOCUS_IMAGE_DIR = PROJECT_ROOT / "static" / "images" / "games" / "spot-the-diff"
FOCUS_IMAGE_URL_PREFIX = "/static/images/games/spot-the-diff/"
ALLOWED_FOCUS_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


class FocusDifference(BaseModel):
    id: str = Field(min_length=1)
    shape: Literal["circle", "rect"]
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    r: int | None = Field(default=None, ge=1)
    w: int | None = Field(default=None, ge=1)
    h: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_shape_dimensions(self) -> "FocusDifference":
        if self.shape == "circle" and self.r is None:
            raise ValueError("circle differences require r")
        if self.shape == "rect" and (self.w is None or self.h is None):
            raise ValueError("rect differences require w and h")
        return self


class FocusLevelUpdateRequest(BaseModel):
    id: str = Field(default="spot-001", min_length=1)
    difficulty: Literal["easy", "medium", "hard"] = "easy"
    enabled: bool = True
    image: str = Field(min_length=1)
    differences: list[FocusDifference] = Field(default_factory=list)


class FocusLevel(BaseModel):
    id: str = Field(min_length=1)
    difficulty: Literal["easy", "medium", "hard"] = "easy"
    enabled: bool = True
    image: str = Field(min_length=1)
    differences: list[FocusDifference] = Field(default_factory=list)


class FocusLevelsUpdateRequest(BaseModel):
    levels: list[FocusLevel] = Field(min_length=1)
    active_id: str | None = None
    allow_empty_update: bool = False


def sanitize_focus_image_filename(filename: str | None) -> str:
    raw_name = (filename or "spot-diff.jpg").replace("\\", "/").split("/")[-1].strip()
    if not raw_name:
        raw_name = "spot-diff.jpg"
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", raw_name)
    safe_name = re.sub(r"\s+", " ", safe_name).strip(" .")
    if not safe_name:
        safe_name = "spot-diff.jpg"
    suffix = Path(safe_name).suffix.lower()
    if suffix not in ALLOWED_FOCUS_IMAGE_EXTENSIONS:
        safe_name = f"{Path(safe_name).stem or 'spot-diff'}.jpg"
    return safe_name


def unique_focus_image_path(filename: str) -> Path:
    FOCUS_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    candidate = FOCUS_IMAGE_DIR / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    counter = 2
    while True:
        next_candidate = FOCUS_IMAGE_DIR / f"{stem}-{counter}{suffix}"
        if not next_candidate.exists():
            return next_candidate
        counter += 1


def render_focus_levels_js(payload: FocusLevelUpdateRequest) -> str:
    return render_focus_levels([FocusLevel(**payload.model_dump())])


def render_focus_levels(levels: list[FocusLevel]) -> str:
    rendered_levels: list[str] = []
    for level in levels:
        diff_lines: list[str] = []
        for diff in level.differences:
            if diff.shape == "circle":
                diff_lines.append(
                    f'                {{ id: {json.dumps(diff.id, ensure_ascii=False)}, '
                    f'shape: "circle", x: {diff.x}, y: {diff.y}, r: {diff.r} }},'
                )
                continue
            diff_lines.append(
                f'                {{ id: {json.dumps(diff.id, ensure_ascii=False)}, '
                f'shape: "rect", x: {diff.x}, y: {diff.y}, w: {diff.w}, h: {diff.h} }},'
            )
        differences = "\n".join(diff_lines)
        rendered_levels.append(
            "        {\n"
            f"            id: {json.dumps(level.id, ensure_ascii=False)},\n"
            f"            difficulty: {json.dumps(level.difficulty, ensure_ascii=False)},\n"
            f"            enabled: {str(level.enabled).lower()},\n"
            f"            image: {json.dumps(level.image, ensure_ascii=False)},\n"
            "            differences: [\n"
            f"{differences}\n"
            "            ],\n"
            "        },"
        )
    return (
        "(function () {\n"
        "    const FOCUS_LEVELS = [\n"
        f"{chr(10).join(rendered_levels)}\n"
        "    ];\n\n"
        "    window.FOCUS_LEVELS = FOCUS_LEVELS;\n"
        "})();\n"
    )


def parse_existing_difference_counts() -> dict[str, int]:
    if not FOCUS_LEVELS_PATH.exists():
        return {}
    text = FOCUS_LEVELS_PATH.read_text(encoding="utf-8")
    counts: dict[str, int] = {}
    blocks = re.finditer(
        r"\{\s*id:\s*['\"](?P<id>[^'\"]+)['\"],[\s\S]*?difficulty:\s*['\"][^'\"]+['\"],[\s\S]*?differences:\s*\[(?P<diffs>[\s\S]*?)\]\s*,",
        text,
    )
    for match in blocks:
        diffs_text = match.group("diffs")
        counts[match.group("id")] = len(re.findall(r"\bid:\s*['\"]diff-", diffs_text))
    return counts


def backup_focus_levels_file() -> str | None:
    if not FOCUS_LEVELS_PATH.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = FOCUS_LEVELS_PATH.with_name(f"focus-levels.backup-{timestamp}.js")
    shutil.copy2(FOCUS_LEVELS_PATH, backup_path)
    return str(backup_path)


def validate_focus_levels_payload(payload: FocusLevelsUpdateRequest) -> None:
    level_ids = [level.id for level in payload.levels]
    if len(level_ids) != len(set(level_ids)):
        raise HTTPException(status_code=400, detail="Level ids must be unique")
    existing_counts = parse_existing_difference_counts()
    for level in payload.levels:
        if not level.image.startswith(FOCUS_IMAGE_URL_PREFIX):
            raise HTTPException(
                status_code=400,
                detail=f"Image path must start with {FOCUS_IMAGE_URL_PREFIX}",
            )
        diff_ids = [diff.id for diff in level.differences]
        if len(diff_ids) != len(set(diff_ids)):
            raise HTTPException(
                status_code=400,
                detail=f"Difference ids must be unique for level {level.id}",
            )
        if (
            not payload.allow_empty_update
            and existing_counts.get(level.id, 0) > 0
            and not level.differences
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Refusing to replace level {level.id} differences with an empty list",
            )


def render_legacy_focus_levels_js(payload: FocusLevelUpdateRequest) -> str:
    diff_lines: list[str] = []
    for diff in payload.differences:
        if diff.shape == "circle":
            diff_lines.append(
                f'                {{ id: {json.dumps(diff.id, ensure_ascii=False)}, '
                f'shape: "circle", x: {diff.x}, y: {diff.y}, r: {diff.r} }},'
            )
            continue
        diff_lines.append(
            f'                {{ id: {json.dumps(diff.id, ensure_ascii=False)}, '
            f'shape: "rect", x: {diff.x}, y: {diff.y}, w: {diff.w}, h: {diff.h} }},'
        )
    differences = "\n".join(diff_lines)
    return (
        "(function () {\n"
        "    const FOCUS_LEVELS = [\n"
        "        {\n"
        f"            id: {json.dumps(payload.id, ensure_ascii=False)},\n"
        f"            difficulty: {json.dumps(payload.difficulty, ensure_ascii=False)},\n"
        f"            enabled: {str(payload.enabled).lower()},\n"
        f"            image: {json.dumps(payload.image, ensure_ascii=False)},\n"
        "            differences: [\n"
        f"{differences}\n"
        "            ],\n"
        "        },\n"
        "    ];\n\n"
        "    window.FOCUS_LEVELS = FOCUS_LEVELS;\n"
        "})();\n"
    )


@router.post("/focus-level-image")
async def upload_focus_level_image(image: UploadFile = File(...)) -> dict[str, str]:
    if image.content_type and not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")
    safe_name = sanitize_focus_image_filename(image.filename)
    destination = unique_focus_image_path(safe_name)
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    destination.write_bytes(content)
    return {
        "image": f"{FOCUS_IMAGE_URL_PREFIX}{quote(destination.name)}",
        "filename": destination.name,
    }


@router.post("/focus-levels")
async def update_focus_levels(payload: FocusLevelsUpdateRequest) -> dict[str, Any]:
    validate_focus_levels_payload(payload)
    FOCUS_LEVELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    backup_path = backup_focus_levels_file()
    tmp_path = FOCUS_LEVELS_PATH.with_suffix(".js.tmp")
    tmp_path.write_text(render_focus_levels(payload.levels), encoding="utf-8")
    tmp_path.replace(FOCUS_LEVELS_PATH)
    return {
        "ok": True,
        "path": str(FOCUS_LEVELS_PATH),
        "backup_path": backup_path,
        "count": sum(len(level.differences) for level in payload.levels),
        "level_count": len(payload.levels),
        "active_id": payload.active_id,
    }


@router.post("/sessions", response_model=models.SessionCreateResponse)
async def create_session(payload: models.SessionCreateRequest) -> models.SessionCreateResponse:
    session_id = str(uuid.uuid4())
    storage.create_session(session_id, payload.patient_id, payload.instrument, payload.config)
    return models.SessionCreateResponse(session_id=session_id)


@router.get("/sessions")
async def list_sessions(
    patient_id: str | None = None,
    patient_name: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    rows = storage.list_sessions(patient_id=patient_id, patient_name=patient_name, limit=limit)
    output: list[dict[str, Any]] = []
    for row in rows:
        config_raw = row.get("config_json")
        try:
            config = json.loads(config_raw) if config_raw else {}
        except json.JSONDecodeError:
            config = {}

        resolved_name = config.get("name") or row.get("patient_id")
        output.append(
            {
                "session_id": row.get("id"),
                "patient_id": row.get("patient_id"),
                "patient_name": resolved_name,
                "patient_gender": config.get("gender"),
                "created_at": row.get("created_at"),
            }
        )
    return output


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
    return models.QuestionResponse(question_no=index + 1, **question)


@router.post("/sessions/{session_id}/responses", response_model=models.ResponseCreateResponse)
async def submit_response(
    session_id: str,
    question_id: str,
    reaction_time_vad_ms: float | None = None,
    manual_confirmed: bool | None = None,
    answer_text: str | None = None,
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

    transcript = str(answer_text).strip() if answer_text is not None else None
    if transcript == "":
        transcript = None
    transcription_payload: dict[str, Any] | None = None
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if transcript and not recording_disabled:
        transcription_payload = None
    elif openai_api_key and not recording_disabled:
        transcription_payload = transcribe_audio(
            str(audio_path),
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
        transcript = transcription_payload.get("text") if transcription_payload else None
    elif not openai_api_key and not recording_disabled:
        logger.warning(
            "OPENAI_API_KEY missing; skipping transcription for session_id=%s question_id=%s",
            session_id,
            question_id,
        )

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
            llm_expected = []
            raw_expected = prepared_rule.get("expected", [])
            if isinstance(raw_expected, list):
                for item in raw_expected:
                    text = str(item).strip()
                    if not text:
                        continue
                    if text.startswith("__") and text.endswith("__"):
                        continue
                    llm_expected.append(text)
            llm_judge = judge_answer(
                transcript,
                llm_expected,
                prepared_rule.get("type", "exact"),
                question_text=str(question.get("text") or ""),
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
