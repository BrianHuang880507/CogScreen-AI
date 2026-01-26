from __future__ import annotations

from typing import Any


def score_spmsq(errors: int, education_level: str | None = None) -> dict[str, Any]:
    adjusted_errors = errors
    if education_level == "grade_school_or_less":
        adjusted_errors = max(0, errors - 1)
    elif education_level == "high_school_or_more":
        adjusted_errors = errors + 1

    if adjusted_errors <= 2:
        severity = "normal"
    elif adjusted_errors <= 4:
        severity = "mild"
    elif adjusted_errors <= 7:
        severity = "moderate"
    else:
        severity = "severe"

    interpretation = {
        "adjusted_errors": adjusted_errors,
        "severity": severity,
        "notes": "SPMSQ scoring may be adjusted for education level.",
    }
    return {"score": errors, "interpretation": interpretation}
