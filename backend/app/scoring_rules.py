from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any
import datetime as dt
from zoneinfo import ZoneInfo
import os
import re


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


def score_contains_all(answer: str, expected: list[str]) -> dict[str, Any]:
    norm_answer = normalize(answer)
    missing = [exp for exp in expected if normalize(exp) not in norm_answer]
    matched = [exp for exp in expected if normalize(exp) in norm_answer]
    return {
        "type": "contains_all",
        "is_correct": len(missing) == 0 and len(expected) > 0,
        "matched": matched,
        "missing": missing,
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


def score_sequence_subtract(
    answer: str,
    start: float,
    step: float,
    count: int = 5,
    min_correct: int | None = None,
) -> dict[str, Any]:
    numbers = [float(match.group()) for match in re.finditer(r"-?\\d+(?:\\.\\d+)?", answer)]
    expected = [start + (step * i) for i in range(count)]
    correct = 0
    for idx, value in enumerate(numbers[:count]):
        if idx >= len(expected):
            break
        if value == expected[idx]:
            correct += 1
    required = min_correct if min_correct is not None else count
    return {
        "type": "sequence_subtract",
        "is_correct": correct >= required,
        "correct_count": correct,
        "required": required,
        "expected": expected,
        "observed": numbers[:count],
    }


def _weekday_labels(weekday_index: int) -> list[str]:
    labels = ["一", "二", "三", "四", "五", "六", "日"]
    day = labels[weekday_index]
    return [f"星期{day}", f"週{day}", f"禮拜{day}"]


def _season_label(month: int) -> str:
    if 3 <= month <= 5:
        return "春天"
    if 6 <= month <= 8:
        return "夏天"
    if 9 <= month <= 11:
        return "秋天"
    return "冬天"


def _expand_token(token: str, context: dict[str, Any]) -> list[str]:
    tz_name = context.get("timezone") or os.getenv("COGSCREEN_TIMEZONE", "Asia/Taipei")
    now = context.get("now") or dt.datetime.now(ZoneInfo(tz_name))
    if token == "__TODAY_YEAR__":
        year = str(now.year)
        return [year, f"{year}年"]
    if token == "__TODAY_MONTH__":
        month = str(now.month)
        return [month, f"{now.month:02d}", f"{month}月", f"{now.month:02d}月"]
    if token == "__TODAY_DAY__":
        day = str(now.day)
        return [
            day,
            f"{now.day:02d}",
            f"{day}日",
            f"{now.day:02d}日",
            f"{day}號",
            f"{now.day:02d}號",
        ]
    if token == "__TODAY_WEEKDAY__":
        return _weekday_labels(now.weekday())
    if token == "__SEASON__":
        return [_season_label(now.month)]
    if token == "__TODAY_DATE__":
        y = now.year
        m = now.month
        d = now.day
        return [
            f"{y}年{m}月{d}日",
            f"{y}/{m}/{d}",
            f"{y}-{m:02d}-{d:02d}",
            f"{y}.{m}.{d}",
        ]
    if token == "__PATIENT_PHONE__":
        value = context.get("patient_phone")
        return [str(value)] if value else []
    if token == "__PATIENT_ADDRESS__":
        value = context.get("patient_address")
        return [str(value)] if value else []
    if token == "__PATIENT_BIRTHDAY__":
        value = context.get("patient_birthday")
        return [str(value)] if value else []
    if token == "__PATIENT_MOTHER_NAME__":
        value = context.get("patient_mother_name")
        return [str(value)] if value else []
    if token == "__PATIENT_AGE__":
        value = context.get("patient_age")
        if value is None:
            return []
        value_str = str(value)
        return [value_str, f"{value_str}歲"]
    if token == "__PRESIDENT_CURRENT__":
        value = context.get("president_current") or os.getenv("COGSCREEN_PRESIDENT_CURRENT")
        return [str(value)] if value else []
    if token == "__PRESIDENT_PREVIOUS__":
        value = context.get("president_previous") or os.getenv("COGSCREEN_PRESIDENT_PREVIOUS")
        return [str(value)] if value else []
    return [token]


def prepare_rule(rule: dict[str, Any], context: dict[str, Any] | None = None) -> tuple[dict[str, Any], bool]:
    if not rule:
        return {}, False
    context = context or {}
    expected = rule.get("expected")
    if not expected:
        return dict(rule), False
    resolved: list[str] = []
    for token in expected:
        resolved.extend(_expand_token(str(token), context))
    deduped = []
    seen = set()
    for item in resolved:
        norm = normalize(item)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        deduped.append(item)
    if not deduped:
        return dict(rule), True
    updated = dict(rule)
    updated["expected"] = deduped
    return updated, False


def score_answer(answer: str, rule: dict[str, Any]) -> dict[str, Any]:
    rule_type = rule.get("type")
    expected = rule.get("expected") or []
    if rule_type == "exact":
        return score_exact(answer, expected)
    if rule_type == "contains_any":
        return score_contains_any(answer, expected)
    if rule_type == "contains_all":
        return score_contains_all(answer, expected)
    if rule_type == "fuzzy":
        threshold = float(rule.get("threshold", 0.85))
        return score_fuzzy(answer, expected, threshold)
    if rule_type == "numeric_range":
        return score_numeric_range(answer, rule.get("min_value"), rule.get("max_value"))
    if rule_type == "sequence_subtract":
        return score_sequence_subtract(
            answer,
            float(rule.get("start", 0)),
            float(rule.get("step", -1)),
            int(rule.get("count", 5)),
            rule.get("min_correct"),
        )
    return {
        "type": "unknown",
        "is_correct": False,
        "reason": "Unsupported scoring rule",
    }
