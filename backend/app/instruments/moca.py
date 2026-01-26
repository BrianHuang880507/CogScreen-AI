from __future__ import annotations

from typing import Any


def score_moca(raw_score: int, education_years: int | None = None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    cutoff = config.get("cutoff", 26)
    adjusted_score = raw_score
    if education_years is not None and education_years <= 12 and raw_score < 30:
        adjusted_score += 1
    interpretation = {
        "adjusted_score": adjusted_score,
        "screen_positive": adjusted_score < cutoff,
        "notes": "MoCA requires permission/training; cutoffs may vary by population.",
    }
    return {"score": raw_score, "interpretation": interpretation}
