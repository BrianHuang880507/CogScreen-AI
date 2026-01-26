from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any


def normalize(text: str) -> str:
    return " ".join(text.strip().lower().split())


def score_exact(answer: str, expected: list[str]) -> dict[str, Any]:
    norm_answer = normalize(answer)
    matches = [exp for exp in expected if normalize(exp) == norm_answer]
    return {
        "type": "exact",
        "is_correct": bool(matches),
        "matched": matches,
    }


def score_contains_any(answer: str, expected: list[str]) -> dict[str, Any]:
    norm_answer = normalize(answer)
    matches = [exp for exp in expected if normalize(exp) in norm_answer]
    return {
        "type": "contains_any",
        "is_correct": bool(matches),
        "matched": matches,
    }


def score_fuzzy(answer: str, expected: list[str], threshold: float = 0.85) -> dict[str, Any]:
    norm_answer = normalize(answer)
    best_match = None
    best_score = 0.0
    for exp in expected:
        score = SequenceMatcher(None, norm_answer, normalize(exp)).ratio()
        if score > best_score:
            best_match = exp
            best_score = score
    return {
        "type": "fuzzy",
        "is_correct": best_score >= threshold,
        "matched": [best_match] if best_match else [],
        "score": best_score,
        "threshold": threshold,
    }


def score_numeric_range(answer: str, min_value: float | None, max_value: float | None) -> dict[str, Any]:
    try:
        value = float(answer.strip())
    except ValueError:
        return {
            "type": "numeric_range",
            "is_correct": False,
            "value": None,
            "range": [min_value, max_value],
        }
    in_range = True
    if min_value is not None and value < min_value:
        in_range = False
    if max_value is not None and value > max_value:
        in_range = False
    return {
        "type": "numeric_range",
        "is_correct": in_range,
        "value": value,
        "range": [min_value, max_value],
    }


def score_answer(answer: str, rule: dict[str, Any]) -> dict[str, Any]:
    rule_type = rule.get("type")
    expected = rule.get("expected") or []
    if rule_type == "exact":
        return score_exact(answer, expected)
    if rule_type == "contains_any":
        return score_contains_any(answer, expected)
    if rule_type == "fuzzy":
        threshold = float(rule.get("threshold", 0.85))
        return score_fuzzy(answer, expected, threshold)
    if rule_type == "numeric_range":
        return score_numeric_range(answer, rule.get("min_value"), rule.get("max_value"))
    return {
        "type": "unknown",
        "is_correct": False,
        "reason": "Unsupported scoring rule",
    }
