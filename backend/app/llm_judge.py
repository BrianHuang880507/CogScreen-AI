from __future__ import annotations

import os
import json
from typing import Any

JUDGE_SCHEMA: dict[str, Any] = {
    "name": "judge_result",
    "schema": {
        "type": "object",
        "properties": {
            "normalized_answer": {"type": "string"},
            "is_correct": {"type": "boolean"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
            "matched_expected": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "normalized_answer",
            "is_correct",
            "confidence",
            "reason",
            "matched_expected",
        ],
        "additionalProperties": False,
    },
}


def judge_answer(transcript: str, expected: list[str], rule_type: str) -> dict[str, Any]:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    model = os.getenv("OPENAI_JUDGE_MODEL", "gpt-4o-mini")
    prompt = (
        "You are a strict evaluator for a cognitive Q&A screening prototype. "
        "Given the spoken transcript and expected answers, decide correctness. "
        "Return normalized_answer, is_correct, confidence (0-1), reason, matched_expected."
    )
    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Transcript: {transcript}\n"
                f"Expected answers: {expected}\n"
                f"Rule type: {rule_type}\n"
                "Return JSON only with keys: normalized_answer, is_correct, confidence, reason, matched_expected."
            ),
        },
    ]
    try:
        response = client.responses.create(
            model=model,
            input=messages,
            response_format={
                "type": "json_schema",
                "json_schema": JUDGE_SCHEMA,
            },
        )
        parsed = None
        for item in getattr(response, "output", []):
            for content in getattr(item, "content", []):
                parsed = getattr(content, "parsed", None) or parsed
        if parsed is not None:
            return parsed
        if isinstance(getattr(response, "output_text", None), str):
            return {
                "normalized_answer": response.output_text,
                "is_correct": False,
                "confidence": 0.0,
                "reason": "Fallback",
                "matched_expected": [],
            }
    except TypeError:
        # Fallback for older OpenAI SDKs without responses.create response_format
        chat = client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        content = chat.choices[0].message.content if chat.choices else ""
        try:
            parsed = json.loads(content) if content else None
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            return parsed
        return {
            "normalized_answer": content or "",
            "is_correct": False,
            "confidence": 0.0,
            "reason": "Fallback",
            "matched_expected": [],
        }

    return {
        "normalized_answer": "",
        "is_correct": False,
        "confidence": 0.0,
        "reason": "No output",
        "matched_expected": [],
    }
