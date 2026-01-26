from __future__ import annotations

from typing import Any


def score_ad8(responses: list[int]) -> dict[str, Any]:
    total = sum(1 for value in responses if value)
    interpretation = {
        "screen_positive": total >= 2,
        "notes": "AD-8 is a screening tool; scores >=2 suggest follow-up assessment.",
    }
    return {"score": total, "interpretation": interpretation}
