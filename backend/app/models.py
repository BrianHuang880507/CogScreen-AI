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


class ReportResponse(BaseModel):
    version: str
    ruleset_version: str
    session_id: str
    patient_id: str | None
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


class SubmitResponse(BaseModel):
    session_id: str
    status_code: int
    response_text: str
    report_path: str
    report: dict[str, Any]


class RuleType(str):
    pass


class ScoringRule(BaseModel):
    type: Literal["exact", "contains_any", "fuzzy", "numeric_range"]
    expected: list[str] | None = None
    min_value: float | None = None
    max_value: float | None = None
    threshold: float | None = None
