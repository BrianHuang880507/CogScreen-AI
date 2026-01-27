from __future__ import annotations

import json
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"

DEFAULT_SCORING_RULE: dict[str, Any] = {"type": "exact", "expected": []}


def load_question_file(filename: str, instrument: str) -> list[dict[str, Any]]:
    path = DATA_DIR / filename
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    questions = []
    for item in payload:
        question_id = item.get("id") or item.get("question_id")
        text = item.get("text")
        if not question_id or not text:
            continue
        questions.append(
            {
                "question_id": str(question_id),
                "text": str(text),
                "audio_url": f"/static/questions/{question_id}.mp3",
                "scoring_rule": dict(DEFAULT_SCORING_RULE),
                "instrument": instrument,
            }
        )
    return questions


def load_all_questions() -> list[dict[str, Any]]:
    return (
        load_question_file("MMSE_questions.json", "mmse")
        + load_question_file("AD8_questions.json", "ad8")
        + load_question_file("SPMSQ_questions.json", "spmsq")
    )


def filter_questions(questions: list[dict[str, Any]], instrument: str | None) -> list[dict[str, Any]]:
    if instrument:
        return [question for question in questions if question.get("instrument") == instrument]
    return questions


def build_question_map(questions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {question["question_id"]: question for question in questions}
