from __future__ import annotations

from typing import Any


def _first_word_start(transcription: dict[str, Any]) -> float | None:
    words = transcription.get("words")
    if isinstance(words, list) and words:
        first = words[0]
        start = first.get("start") if isinstance(first, dict) else None
        if isinstance(start, (int, float)):
            return float(start)
    segments = transcription.get("segments")
    if isinstance(segments, list) and segments:
        first_segment = segments[0]
        start = first_segment.get("start") if isinstance(first_segment, dict) else None
        if isinstance(start, (int, float)):
            return float(start)
    return None


def reaction_time_whisper_ms(transcription: dict[str, Any]) -> float | None:
    start = _first_word_start(transcription)
    if start is None:
        return None
    return start * 1000.0
