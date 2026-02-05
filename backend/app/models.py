from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    patient_id: str = Field(..., description="Anonymous patient identifier")
    instrument: str | None = Field(None, description="Instrument ID (ad8/spmsq/mmse/moca)")
    config: dict[str, Any] = Field(default_factory=dict)


class SessionCreateResponse(BaseModel):
    session_id: str


class QuestionResponse(BaseModel):
    question_id: str
    text: str
    audio_url: str
    scoring_rule: dict[str, Any]
    image_url: str | None = None
    manual_confirm: bool | None = None
    recording_disabled: bool | None = None
    exclude_from_scoring: bool | None = None


class ResponseCreateRequest(BaseModel):
    question_id: str
    reaction_time_vad_ms: float | None = None
    client_started_at: float | None = None


class ResponseCreateResponse(BaseModel):
    response_id: str
    transcript: str | None
    reaction_time_whisper_ms: float | None
    reaction_time_vad_ms: float | None
    rule_score: dict[str, Any] | None
    llm_judge: dict[str, Any] | None
    manual_confirmed: bool | None = None


class ReportResponse(BaseModel):
    session_id: str
    created_at: str | None
    summary: dict[str, Any]
    instrument_scores: dict[str, Any]
    responses: list[dict[str, Any]]
    disclaimer: str


class ProgressResponse(BaseModel):
    session_id: str
    answered: int
    total_questions: int
    is_complete: bool


class SubmitResponse(ReportResponse):
    pass


class RuleType(str):
    pass


class ScoringRule(BaseModel):
    type: Literal["exact", "contains_any", "contains_all", "fuzzy", "numeric_range", "sequence_subtract"]
    expected: list[str] | None = None
    min_value: float | None = None
    max_value: float | None = None
    threshold: float | None = None
    start: float | None = None
    step: float | None = None
    count: int | None = None
    min_correct: int | None = None
