from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any
from contextlib import asynccontextmanager

from backend.app import question_bank, storage
import httpx

BASE_DIR = Path(__file__).resolve().parents[2]

REPORT_VERSION = "1.0"
DEFAULT_RULESET_VERSION = dt.date.today().isoformat()
DEFAULT_DISCLAIMER = (
    "This is a research/assisted screening prototype. It must not be used for "
    "diagnosis or as a substitute for clinical assessment. Qualified clinicians "
    "must interpret all results using authorized, validated instruments."
)


def _parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def _severity_level(band: str | None) -> int | None:
    if not band:
        return None
    mapping = {
        "normal": 0,
        "none": 0,
        "mild": 1,
        "moderate": 2,
        "severe": 3,
    }
    return mapping.get(band)


def _severity_from_level(level: int | None) -> str | None:
    if level is None:
        return None
    mapping = {0: "none", 1: "mild", 2: "moderate", 3: "severe"}
    return mapping.get(level, "none")


def _format_rule_score(rule_score: dict[str, Any]) -> dict[str, Any]:
    if not rule_score:
        return {}
    matched = rule_score.get("matched") or []
    detail = None
    if matched:
        detail = f"{rule_score.get('type')} matched: {', '.join(matched)}"
    elif rule_score.get("type") == "numeric_range":
        detail = f"value: {rule_score.get('value')} in range {rule_score.get('range')}"
    return {
        "is_correct": rule_score.get("is_correct", False),
        "score": rule_score.get("score", 1 if rule_score.get("is_correct") else 0),
        "details": detail,
    }


def _build_instrument_scores(rows: list[dict[str, Any]]) -> dict[str, Any]:
    scores: dict[str, Any] = {}
    for row in rows:
        instrument = str(row.get("instrument", "")).upper()
        interpretation = _parse_json(row.get("interpretation_json")) or {}
        score_value = row.get("score")
        if instrument == "AD8":
            scores[instrument] = {
                "score": score_value,
                "max_score": 8,
                "screen_positive": bool(interpretation.get("screen_positive")),
                "cutoff": 2,
                "interpretation": interpretation.get("notes"),
            }
        elif instrument == "SPMSQ":
            severity = interpretation.get("severity") or interpretation.get("severity_band")
            scores[instrument] = {
                "errors": score_value,
                "adjustment": {
                    "education_level": interpretation.get("education_level"),
                    "error_adjustment": interpretation.get("error_adjustment"),
                },
                "adjusted_errors": interpretation.get("adjusted_errors"),
                "severity_band": severity,
                "severity_level": _severity_level(severity),
                "interpretation": interpretation.get("notes"),
            }
        elif instrument == "MMSE":
            severity = interpretation.get("severity") or interpretation.get("severity_band")
            scores[instrument] = {
                "score": score_value,
                "max_score": 30,
                "cutoff_used": interpretation.get("cutoff_used"),
                "severity_band": severity,
                "severity_level": _severity_level(severity),
                "interpretation": interpretation.get("notes"),
                "license_note": interpretation.get("license_note"),
            }
        elif instrument == "MOCA":
            severity = interpretation.get("severity") or interpretation.get("severity_band")
            if severity is None and interpretation.get("screen_positive") is True:
                severity = "mild"
            scores[instrument] = {
                "score": score_value,
                "max_score": 30,
                "education_years": interpretation.get("education_years"),
                "education_bonus_applied": interpretation.get("education_bonus_applied"),
                "severity_band": severity,
                "severity_level": _severity_level(severity),
                "interpretation": interpretation.get("notes"),
            }
        else:
            scores[instrument] = {
                "score": score_value,
                "interpretation": interpretation,
            }
    return scores


def _build_summary(instrument_scores: dict[str, Any]) -> dict[str, Any]:
    derived_from = sorted(instrument_scores.keys())
    max_level = None
    screen_positive = False
    for instrument, score in instrument_scores.items():
        severity = score.get("severity_band")
        level = _severity_level(severity)
        if level is not None:
            max_level = level if max_level is None else max(max_level, level)
            if level > 0:
                screen_positive = True
        if instrument == "AD8" and score.get("screen_positive") is True:
            screen_positive = True
        if instrument == "MOCA" and score.get("severity_level") is not None:
            if score.get("severity_level", 0) > 0:
                screen_positive = True

    risk_level = max_level if max_level is not None else 0
    risk_band = _severity_from_level(risk_level) or "none"

    return {
        "screening_risk_band": risk_band,
        "screening_risk_level": risk_level,
        "screen_positive": screen_positive,
        "derived_from": derived_from,
        "needs_followup": screen_positive,
        "notes": [
            "Auto-generated summary for research screening only.",
        ],
    }


def build_report(session_id: str) -> dict[str, Any]:
    session = storage.get_session(session_id)
    if not session:
        raise ValueError("Session not found")

    responses = storage.list_responses(session_id)
    instrument_scores_rows = storage.list_instrument_scores(session_id)
    questions = question_bank.load_all_questions()
    question_map = question_bank.build_question_map(questions)

    response_items = []
    for row in responses:
        question_id = row.get("question_id")
        question = question_map.get(question_id, {})
        rt_vad = row.get("reaction_time_vad_ms")
        rt_whisper = row.get("reaction_time_whisper_ms")
        method_preferred = None
        if rt_whisper is not None:
            method_preferred = "whisper"
        elif rt_vad is not None:
            method_preferred = "vad"
        quality_flags: list[str] = []
        if rt_whisper is not None and rt_vad is not None:
            if abs(rt_whisper - rt_vad) > 500:
                quality_flags.append("vad_whisper_gap_large")

        rule_score = _parse_json(row.get("rule_score_json"))
        llm_judge = _parse_json(row.get("llm_judge_json"))
        scoring: dict[str, Any] = {}
        if rule_score:
            scoring["rule_based"] = _format_rule_score(rule_score)
        if llm_judge:
            scoring["llm_judge"] = llm_judge

        response_items.append(
            {
                "question_id": question_id,
                "instrument": session.get("instrument") or question.get("instrument"),
                "asked_at": row.get("created_at"),
                "audio_url": question.get("audio_url") or f"/static/questions/{question_id}.mp3",
                "transcript": row.get("transcript"),
                "reaction_time": {
                    "vad_ms": rt_vad,
                    "whisper_ms": rt_whisper,
                    "method_preferred": method_preferred,
                    "quality_flags": quality_flags,
                },
                "scoring": scoring,
            }
        )

    instrument_scores = _build_instrument_scores(instrument_scores_rows)
    summary = _build_summary(instrument_scores)

    return {
        "version": REPORT_VERSION,
        "ruleset_version": os.getenv("COGSCREEN_RULESET_VERSION", DEFAULT_RULESET_VERSION),
        "session_id": session_id,
        "patient_id": session.get("patient_id"),
        "created_at": session.get("created_at"),
        "summary": summary,
        "instrument_scores": instrument_scores,
        "responses": response_items,
        "disclaimer": os.getenv("COGSCREEN_DISCLAIMER", DEFAULT_DISCLAIMER),
    }


def save_report(report: dict[str, Any], session_id: str) -> Path:
    report_dir = Path(os.getenv("COGSCREEN_REPORT_DIR", BASE_DIR / "data" / "reports"))
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"{session_id}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


@asynccontextmanager
async def http_client() -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        yield client
