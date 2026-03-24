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
            "is_correct": {"type": ["boolean", "null"]},
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


def judge_answer(
    transcript: str,
    expected: list[str],
    rule_type: str,
    question_text: str = "",
) -> dict[str, Any]:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    model = os.getenv("OPENAI_JUDGE_MODEL", "gpt-4o-mini")
    prompt = (
        "You are an evaluator for cognitive screening Q&A. "
        "Primary goal: detect whether the response is on-topic, coherent, and not nonsensical. "
        "Do not over-penalize minor wording/ASR variations.\n"
        "Rules:\n"
        "1) If expected answers are provided, use them as anchor but allow semantic equivalence and minor variations.\n"
        "2) If expected answers are missing, judge by topical relevance and logical coherence.\n"
        "3) For orientation/president-name questions: if answer gives a plausible person name and stays on topic, prefer true; if clearly off-topic or gibberish, false.\n"
        "4) Use null only when evidence is truly insufficient to decide.\n"
        "5) Keep reason concise and specific."
    )
    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Question: {question_text}\n"
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
                "is_correct": None,
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
            "is_correct": None,
            "confidence": 0.0,
            "reason": "Fallback",
            "matched_expected": [],
        }

    return {
        "normalized_answer": "",
        "is_correct": None,
        "confidence": 0.0,
        "reason": "No output",
        "matched_expected": [],
    }
