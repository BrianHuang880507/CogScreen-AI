from __future__ import annotations

import os
from typing import Any


def transcribe_audio(
    audio_path: str,
    model: str | None = None,
    language: str | None = None,
    response_format: str = "verbose_json",
    timestamp_granularities: list[str] | None = None,
) -> dict[str, Any]:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    model_name = model or os.getenv("OPENAI_TRANSCRIBE_MODEL", "whisper-1")
    with open(audio_path, "rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            file=audio_file,
            model=model_name,
            response_format=response_format,
            language=language,
            timestamp_granularities=timestamp_granularities or ["word"],
        )
    if hasattr(transcription, "model_dump"):
        return transcription.model_dump()
    if isinstance(transcription, dict):
        return transcription
    return dict(transcription)
