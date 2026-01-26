from __future__ import annotations

from typing import Any


def score_mmse(raw_score: int, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    cutoffs = config.get("cutoffs", {"normal": 24, "mild": 18, "moderate": 10})
    if raw_score >= cutoffs.get("normal", 24):
        severity = "normal"
    elif raw_score >= cutoffs.get("mild", 18):
        severity = "mild"
    elif raw_score >= cutoffs.get("moderate", 10):
        severity = "moderate"
    else:
        severity = "severe"
    interpretation = {
        "severity": severity,
        "notes": "MMSE scoring must follow licensed materials and local norms.",
    }
    return {"score": raw_score, "interpretation": interpretation}
