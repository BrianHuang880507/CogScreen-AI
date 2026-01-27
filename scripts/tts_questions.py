#!/usr/bin/env python3
import argparse
import asyncio
import json
from pathlib import Path

try:
    import edge_tts
except ImportError as exc:  # pragma: no cover - runtime guidance
    raise SystemExit(
        "Missing dependency: edge-tts. Install with: pip install edge-tts"
    ) from exc


DEFAULT_VOICE = "zh-TW-HsiaoChenNeural"
DEFAULT_FORMAT = "mp3"


def load_questions(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("Questions JSON must be a list of objects.")
    items: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Each question must be an object.")
        question_id = item.get("id") or item.get("question_id")
        text = item.get("text")
        if not question_id or not text:
            raise ValueError("Each question must include id/question_id and text.")
        items.append({"id": str(question_id), "text": str(text)})
    return items


def convert_to_wav(src_path: Path, dst_path: Path) -> None:
    import subprocess

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


async def synthesize(
    question_id: str, text: str, out_dir: Path, voice: str, fmt: str
) -> None:
    if fmt not in ("mp3", "wav"):
        raise ValueError("format must be mp3 or wav")

    mp3_path = out_dir / f"{question_id}.mp3"
    communicator = edge_tts.Communicate(text, voice=voice)
    await communicator.save(str(mp3_path))

    if fmt == "wav":
        wav_path = out_dir / f"{question_id}.wav"
        convert_to_wav(mp3_path, wav_path)
    else:
        wav_path = None

    if wav_path:
        print(f"Saved {wav_path.name}")
    else:
        print(f"Saved {mp3_path.name}")


async def run(args: argparse.Namespace) -> None:
    questions_path = Path(args.questions)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    questions = load_questions(questions_path)

    for item in questions:
        await synthesize(item["id"], item["text"], out_dir, args.voice, args.format)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate question audio via Edge TTS.")
    parser.add_argument(
        "--questions",
        default="data/questions.json",
        help="Path to questions JSON (list of {id/text}).",
    )
    parser.add_argument(
        "--output",
        default="static/questions",
        help="Output directory for WAV files.",
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"Edge TTS voice name (default: {DEFAULT_VOICE}).",
    )
    parser.add_argument(
        "--format",
        default=DEFAULT_FORMAT,
        choices=["mp3", "wav"],
        help="Output format (default: mp3). WAV requires ffmpeg.",
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
