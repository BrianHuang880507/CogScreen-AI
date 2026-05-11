#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import subprocess
from pathlib import Path

import httpx

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional runtime helper
    load_dotenv = None


DEFAULT_EDGE_VOICE = "zh-TW-HsiaoChenNeural"
DEFAULT_AZURE_VOICE = "zh-CN-XiaoxiaoDialectsNeural"
DEFAULT_AZURE_LANG = "nan-CN"
DEFAULT_FORMAT = "mp3"
DEFAULT_TEXT_FIELDS = ["tts_text", "audio_text", "text"]
AZURE_MP3_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
AZURE_WAV_FORMAT = "riff-24khz-16bit-mono-pcm"


def find_project_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").exists():
            return candidate
    return current


def load_env(env_path: str | None) -> None:
    if load_dotenv is None:
        return
    path = Path(env_path) if env_path else find_project_root() / ".env"
    if path.exists():
        load_dotenv(path)


def parse_text_fields(raw: str | None) -> list[str]:
    if not raw:
        return DEFAULT_TEXT_FIELDS
    fields = [field.strip() for field in raw.split(",") if field.strip()]
    return fields or DEFAULT_TEXT_FIELDS


def load_questions(path: Path, text_fields: list[str]) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("Questions JSON must be a list of objects.")

    items: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Each question must be an object.")
        question_id = item.get("id") or item.get("question_id")
        text = next(
            (
                str(item[field]).strip()
                for field in text_fields
                if item.get(field) and str(item[field]).strip()
            ),
            "",
        )
        if not question_id or not text:
            raise ValueError(
                "Each question must include id/question_id and at least one text field."
            )
        items.append({"id": str(question_id), "text": text})
    return items


def convert_to_wav(src_path: Path, dst_path: Path) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src_path), str(dst_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "ffmpeg conversion failed. Install ffmpeg or use --format mp3.\n"
            + result.stderr.strip()
        )


async def synthesize_edge(
    question_id: str,
    text: str,
    out_dir: Path,
    voice: str,
    fmt: str,
) -> None:
    try:
        import edge_tts
    except ImportError as exc:  # pragma: no cover - runtime guidance
        raise SystemExit(
            "Missing dependency: edge-tts. Install with: pip install edge-tts"
        ) from exc

    mp3_path = out_dir / f"{question_id}.mp3"
    communicator = edge_tts.Communicate(text, voice=voice)
    await communicator.save(str(mp3_path))

    if fmt == "wav":
        wav_path = out_dir / f"{question_id}.wav"
        convert_to_wav(mp3_path, wav_path)
        print(f"Saved {wav_path.name}")
        return
    print(f"Saved {mp3_path.name}")


def azure_credentials() -> tuple[str, str]:
    key = os.getenv("SPEECH_KEY") or os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("SPEECH_REGION") or os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        raise RuntimeError(
            "Missing Azure Speech credentials. Set SPEECH_KEY and SPEECH_REGION in .env."
        )
    return key, region


def synthesize_azure(
    question_id: str,
    text: str,
    out_dir: Path,
    voice: str,
    lang: str,
    fmt: str,
    output_format: str | None,
) -> None:
    key, region = azure_credentials()
    audio_format = output_format or (AZURE_WAV_FORMAT if fmt == "wav" else AZURE_MP3_FORMAT)
    suffix = "wav" if fmt == "wav" else "mp3"
    output_path = out_dir / f"{question_id}.{suffix}"
    tts_url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    ssml = f"""
<speak version="1.0"
       xmlns="http://www.w3.org/2001/10/synthesis"
       xml:lang="zh-CN">
  <voice name="{html.escape(voice)}">
    <lang xml:lang="{html.escape(lang)}">{html.escape(text)}</lang>
  </voice>
</speak>
""".strip()
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": audio_format,
        "User-Agent": "cogscreen-ai-tts-questions",
    }

    response = httpx.post(
        tts_url,
        headers=headers,
        content=ssml.encode("utf-8"),
        timeout=60,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Azure TTS failed for {question_id} with HTTP {response.status_code}: "
            f"{response.text.strip()}"
        )

    output_path.write_bytes(response.content)
    print(f"Saved {output_path.name}")


async def run(args: argparse.Namespace) -> None:
    if args.format not in ("mp3", "wav"):
        raise ValueError("format must be mp3 or wav")

    load_env(args.env)
    questions_path = Path(args.questions)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    questions = load_questions(questions_path, parse_text_fields(args.text_fields))

    for item in questions:
        if args.provider == "azure":
            synthesize_azure(
                item["id"],
                item["text"],
                out_dir,
                args.azure_voice,
                args.azure_lang,
                args.format,
                args.azure_output_format,
            )
            continue
        await synthesize_edge(item["id"], item["text"], out_dir, args.edge_voice, args.format)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate question audio.")
    parser.add_argument(
        "--questions",
        default="data/questions.json",
        help="Path to questions JSON.",
    )
    parser.add_argument(
        "--output",
        default="static/questions",
        help="Output directory for generated audio files.",
    )
    parser.add_argument(
        "--provider",
        default="edge",
        choices=["edge", "azure"],
        help="TTS provider (default: edge). Use azure with --azure-lang nan-CN for Taigi.",
    )
    parser.add_argument(
        "--text-fields",
        default=",".join(DEFAULT_TEXT_FIELDS),
        help="Comma-separated fields to use for synthesis, in priority order.",
    )
    parser.add_argument(
        "--edge-voice",
        "--voice",
        dest="edge_voice",
        default=DEFAULT_EDGE_VOICE,
        help=f"Edge TTS voice name (default: {DEFAULT_EDGE_VOICE}).",
    )
    parser.add_argument(
        "--azure-voice",
        default=DEFAULT_AZURE_VOICE,
        help=f"Azure voice name (default: {DEFAULT_AZURE_VOICE}).",
    )
    parser.add_argument(
        "--azure-lang",
        default=DEFAULT_AZURE_LANG,
        help=f"Azure SSML lang for the text (default: {DEFAULT_AZURE_LANG}).",
    )
    parser.add_argument(
        "--azure-output-format",
        default=None,
        help="Azure X-Microsoft-OutputFormat override.",
    )
    parser.add_argument(
        "--env",
        default=None,
        help="Optional .env path. Defaults to project-root .env when python-dotenv is installed.",
    )
    parser.add_argument(
        "--format",
        default=DEFAULT_FORMAT,
        choices=["mp3", "wav"],
        help="Output format (default: mp3).",
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
