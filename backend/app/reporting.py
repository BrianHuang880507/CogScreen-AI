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

DEFAULT_DISCLAIMER = (
    "本結果為研究/輔助篩檢用途，不能用於失智症診斷，請由專業人員解讀。"
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


def _summary_message(band: str) -> str:
    mapping = {
        "none": "未見明顯認知風險（僅供篩檢參考，非診斷）",
        "mild": "輕度認知風險（僅供篩檢參考，非診斷）",
        "moderate": "中度認知風險（僅供篩檢參考，非診斷）",
        "severe": "高度認知風險（僅供篩檢參考，非診斷）",
    }
    return mapping.get(band, "篩檢結果未定（僅供參考）")


def _format_instrument_scores(instrument_scores: dict[str, Any]) -> dict[str, Any]:
    formatted: dict[str, Any] = {
        "AD8": {"score": None, "max_score": 8, "screen_positive": False},
        "SPMSQ": {"errors": None, "severity_band": None},
        "MMSE": {"score": None, "max_score": 30, "severity_band": None},
        "MoCA": {"score": None, "max_score": 30, "severity_band": None},
    }
    if "AD8" in instrument_scores:
        ad8 = instrument_scores["AD8"]
        formatted["AD8"] = {
            "score": ad8.get("score"),
            "max_score": ad8.get("max_score", 8),
            "screen_positive": ad8.get("screen_positive"),
        }
    if "SPMSQ" in instrument_scores:
        spmsq = instrument_scores["SPMSQ"]
        formatted["SPMSQ"] = {
            "errors": spmsq.get("errors"),
            "severity_band": spmsq.get("severity_band"),
        }
    if "MMSE" in instrument_scores:
        mmse = instrument_scores["MMSE"]
        formatted["MMSE"] = {
            "score": mmse.get("score"),
            "max_score": mmse.get("max_score", 30),
            "severity_band": mmse.get("severity_band"),
        }
    if "MOCA" in instrument_scores:
        moca = instrument_scores["MOCA"]
        formatted["MoCA"] = {
            "score": moca.get("score"),
            "max_score": moca.get("max_score", 30),
            "severity_band": moca.get("severity_band"),
        }
    return formatted


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

        rule_score = _parse_json(row.get("rule_score_json"))
        llm_judge = _parse_json(row.get("llm_judge_json"))
        manual_value = row.get("manual_confirmed")
        if manual_value is not None:
            is_correct = bool(manual_value)
        elif rule_score and "is_correct" in rule_score:
            is_correct = bool(rule_score.get("is_correct"))
        elif llm_judge and "is_correct" in llm_judge:
            is_correct = bool(llm_judge.get("is_correct"))
        else:
            is_correct = None

        instrument_raw = (session.get("instrument") or question.get("instrument") or "").lower()
        instrument_label = {
            "ad8": "AD8",
            "spmsq": "SPMSQ",
            "mmse": "MMSE",
            "moca": "MoCA",
        }.get(instrument_raw, instrument_raw.upper() or None)

        response_items.append(
            {
                "question_id": question_id,
                "instrument": instrument_label,
                "transcript": row.get("transcript"),
                "reaction_time_ms": {
                    "vad": rt_vad,
                    "whisper": rt_whisper,
                },
                "is_correct": is_correct,
            }
        )

    instrument_scores = _build_instrument_scores(instrument_scores_rows)
    summary_full = _build_summary(instrument_scores)
    summary = {
        "screening_risk_band": summary_full.get("screening_risk_band"),
        "screening_risk_level": summary_full.get("screening_risk_level"),
        "screen_positive": summary_full.get("screen_positive"),
        "needs_followup": summary_full.get("needs_followup"),
        "message": _summary_message(summary_full.get("screening_risk_band") or "none"),
    }

    return {
        "session_id": session_id,
        "created_at": session.get("created_at"),
        "summary": summary,
        "instrument_scores": _format_instrument_scores(instrument_scores),
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
