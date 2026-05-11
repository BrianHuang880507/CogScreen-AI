#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import httpx

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional runtime helper
    load_dotenv = None


DEFAULT_VOICE = "zh-CN-XiaoxiaoDialectsNeural"
DEFAULT_LANG = "nan-CN"
DEFAULT_PROVIDER = "hapsing"
DEFAULT_DIALECT = "south"
DEFAULT_SANDHI = "none"
HAPSING_ENDPOINT = "https://hapsing.ithuan.tw/bangtsam"
TAILO_NUMBER_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*[1-9]\b")
DEFAULT_TEXT_FIELDS = ["tts_text", "audio_text", "tailo", "poj", "text"]
DEFAULT_QUESTIONS_OUTPUT = Path("static/questions")
AZURE_MP3_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
AZURE_WAV_FORMAT = "riff-24khz-16bit-mono-pcm"


def find_project_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").exists():
            return candidate
    return current


def load_env(env_path: str | None = None) -> None:
    if load_dotenv is None:
        return

    path = Path(env_path) if env_path else find_project_root() / ".env"
    if path.exists():
        load_dotenv(path)


def azure_credentials() -> tuple[str, str]:
    key = os.getenv("SPEECH_KEY") or os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("SPEECH_REGION") or os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        raise RuntimeError(
            "Missing Azure Speech credentials. Set SPEECH_KEY and SPEECH_REGION in .env."
        )
    return key, region


def default_output_path(audio_format: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    project_root = find_project_root()
    return (
        project_root
        / "output"
        / "jupyter-notebook"
        / "audio"
        / f"tailo-tts-{timestamp}.{audio_format}"
    )


def collect_tailo_text(args: argparse.Namespace) -> str:
    if args.text_file:
        return Path(args.text_file).read_text(encoding="utf-8").strip()
    if args.text:
        return args.text.strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return input("請輸入台羅拼音或台語漢字：").strip()


def parse_text_fields(raw: str | None) -> list[str]:
    if not raw:
        return DEFAULT_TEXT_FIELDS
    fields = [field.strip() for field in raw.split(",") if field.strip()]
    return fields or DEFAULT_TEXT_FIELDS


def load_question_items(
    questions_path: Path,
    text_fields: list[str],
) -> list[dict[str, str]]:
    data = json.loads(questions_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Questions JSON must be a list of objects.")

    items: list[dict[str, str]] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Question item #{index} must be an object.")

        question_id = item.get("id") or item.get("question_id")
        if not question_id:
            raise ValueError(f"Question item #{index} is missing id/question_id.")

        source_field = ""
        source_text = ""
        for field in text_fields:
            value = item.get(field)
            if value and str(value).strip():
                source_field = field
                source_text = str(value).strip()
                break

        if not source_text:
            raise ValueError(
                f"Question {question_id!r} has no text in fields: "
                f"{', '.join(text_fields)}"
            )

        items.append(
            {
                "id": str(question_id),
                "source_field": source_field,
                "source_text": source_text,
                "audio_url": str(item.get("audio_url") or ""),
            }
        )
    return items


def question_output_path(
    question_id: str,
    output_dir: Path,
    audio_format: str,
) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", question_id).strip("._")
    if not safe_id:
        raise ValueError(f"Cannot build a safe filename for question id {question_id!r}.")
    return output_dir / f"{safe_id}.{audio_format}"


def normalize_tailo_for_hapsing(
    text: str,
    dialect: str = DEFAULT_DIALECT,
    sandhi: str = DEFAULT_SANDHI,
) -> str:
    """Convert Han text or Tai-lo with tone marks into Hapsing's number-tone Tai-lo."""
    if not text.strip():
        raise ValueError("Tai-lo text cannot be empty.")

    if TAILO_NUMBER_RE.search(text):
        return text.lower()

    try:
        from taibun import Converter
    except ImportError as exc:  # pragma: no cover - runtime guidance
        raise RuntimeError(
            "Missing dependency: taibun. Install it in the current Python/kernel "
            "with: python -m pip install taibun"
        ) from exc

    converter = Converter(
        system="Tailo",
        dialect=dialect,
        format="number",
        sandhi=sandhi,
        convert_non_cjk=True,
    )
    return converter.get(text).lower()


def _tls_verify_value(mode: str) -> bool:
    if mode == "true":
        return True
    if mode == "false":
        return False
    raise ValueError("tls_verify must be one of: auto, true, false")


def fetch_hapsing_audio(
    normalized_tailo: str,
    endpoint: str = HAPSING_ENDPOINT,
    tls_verify: str = "auto",
) -> bytes:
    if tls_verify not in {"auto", "true", "false"}:
        raise ValueError("tls_verify must be one of: auto, true, false")

    params = {"taibun": normalized_tailo}
    verify = True if tls_verify == "auto" else _tls_verify_value(tls_verify)
    try:
        response = httpx.get(
            endpoint,
            params=params,
            timeout=60,
            follow_redirects=True,
            verify=verify,
        )
    except httpx.ConnectError as exc:
        if tls_verify == "auto" and "CERTIFICATE_VERIFY_FAILED" in str(exc):
            response = httpx.get(
                endpoint,
                params=params,
                timeout=60,
                follow_redirects=True,
                verify=False,
            )
        else:
            raise

    if response.status_code != 200:
        raise RuntimeError(
            f"Hapsing TTS failed with HTTP {response.status_code}: "
            f"{response.text.strip()}"
        )
    if not response.content:
        raise RuntimeError("Hapsing TTS returned an empty response.")
    return response.content


def synthesize_hapsing_to_file(
    text: str,
    output_path: Path,
    dialect: str = DEFAULT_DIALECT,
    sandhi: str = DEFAULT_SANDHI,
    tls_verify: str = "auto",
) -> Path:
    normalized_tailo = normalize_tailo_for_hapsing(
        text,
        dialect=dialect,
        sandhi=sandhi,
    )
    audio_bytes = fetch_hapsing_audio(normalized_tailo, tls_verify=tls_verify)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(audio_bytes)
    return output_path


def build_ssml(tailo_text: str, voice: str, lang: str) -> str:
    escaped_text = html.escape(tailo_text, quote=False)
    escaped_voice = html.escape(voice, quote=True)
    escaped_lang = html.escape(lang, quote=True)
    return f"""
<speak version="1.0"
       xmlns="http://www.w3.org/2001/10/synthesis"
       xml:lang="zh-CN">
  <voice name="{escaped_voice}">
    <lang xml:lang="{escaped_lang}">{escaped_text}</lang>
  </voice>
</speak>
""".strip()


def synthesize_tailo_to_file(
    tailo_text: str,
    output_path: Path,
    provider: str = DEFAULT_PROVIDER,
    dialect: str = DEFAULT_DIALECT,
    sandhi: str = DEFAULT_SANDHI,
    voice: str = DEFAULT_VOICE,
    lang: str = DEFAULT_LANG,
    azure_output_format: str = AZURE_MP3_FORMAT,
    tls_verify: str = "auto",
) -> Path:
    if not tailo_text:
        raise ValueError("Tailo text cannot be empty.")

    if provider == "hapsing":
        return synthesize_hapsing_to_file(
            tailo_text,
            output_path=output_path,
            dialect=dialect,
            sandhi=sandhi,
            tls_verify=tls_verify,
        )
    if provider != "azure":
        raise ValueError("provider must be hapsing or azure")

    key, region = azure_credentials()
    ssml = build_ssml(tailo_text, voice=voice, lang=lang)
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": azure_output_format,
        "User-Agent": "cogscreen-ai-tailo-tts-download",
    }

    response = httpx.post(
        url,
        headers=headers,
        content=ssml.encode("utf-8"),
        timeout=60,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Azure TTS failed with HTTP {response.status_code}: "
            f"{response.text.strip()}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(response.content)
    return output_path


def synthesize_question_items(
    questions_path: Path,
    output_dir: Path,
    text_fields: list[str],
    provider: str = DEFAULT_PROVIDER,
    dialect: str = DEFAULT_DIALECT,
    sandhi: str = DEFAULT_SANDHI,
    audio_format: str = "mp3",
    voice: str = DEFAULT_VOICE,
    lang: str = DEFAULT_LANG,
    azure_output_format: str | None = None,
    tls_verify: str = "auto",
    skip_existing: bool = False,
    show_normalized: bool = False,
    continue_on_error: bool = False,
) -> list[dict[str, str]]:
    if provider == "hapsing" and audio_format != "mp3":
        raise ValueError("Hapsing provider returns mp3; use --format mp3.")

    output_dir.mkdir(parents=True, exist_ok=True)
    questions = load_question_items(questions_path, text_fields)
    resolved_azure_format = azure_output_format or (
        AZURE_WAV_FORMAT if audio_format == "wav" else AZURE_MP3_FORMAT
    )
    manifest: list[dict[str, str]] = []
    errors: list[str] = []

    for item in questions:
        question_id = item["id"]
        output_path = question_output_path(question_id, output_dir, audio_format)
        normalized_tailo = ""
        if provider == "hapsing":
            normalized_tailo = normalize_tailo_for_hapsing(
                item["source_text"],
                dialect=dialect,
                sandhi=sandhi,
            )

        row = {
            "id": question_id,
            "source_field": item["source_field"],
            "source_text": item["source_text"],
            "normalized_tailo": normalized_tailo,
            "output_path": str(output_path),
            "audio_url": item["audio_url"],
            "status": "pending",
            "error": "",
        }

        if skip_existing and output_path.exists():
            row["status"] = "skipped"
            manifest.append(row)
            print(f"Skipped existing {output_path}")
            continue

        try:
            synthesize_tailo_to_file(
                tailo_text=item["source_text"],
                output_path=output_path,
                provider=provider,
                dialect=dialect,
                sandhi=sandhi,
                voice=voice,
                lang=lang,
                azure_output_format=resolved_azure_format,
                tls_verify=tls_verify,
            )
            row["status"] = "saved"
            if show_normalized and normalized_tailo:
                print(f"{question_id}: {normalized_tailo}")
            print(f"Saved {output_path}")
        except Exception as exc:
            row["status"] = "error"
            row["error"] = str(exc)
            errors.append(f"{question_id}: {exc}")
            print(f"Error {question_id}: {exc}", file=sys.stderr)
            if not continue_on_error:
                manifest.append(row)
                raise

        manifest.append(row)

    if errors:
        print(f"Completed with {len(errors)} error(s).", file=sys.stderr)
    return manifest


def write_manifest(path: Path, manifest: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert Tai-lo romanization or Taigi Han text to a downloadable audio file."
    )
    parser.add_argument(
        "text",
        nargs="?",
        help="Tai-lo romanization text. If omitted, stdin or an interactive prompt is used.",
    )
    parser.add_argument(
        "--text-file",
        help="UTF-8 text file containing Tai-lo romanization input.",
    )
    parser.add_argument(
        "--questions-json",
        help="Batch mode: path to a questions JSON file such as data/SPMSQ_questions.json.",
    )
    parser.add_argument(
        "--questions-output",
        default=str(DEFAULT_QUESTIONS_OUTPUT),
        help=f"Batch mode output directory. Default: {DEFAULT_QUESTIONS_OUTPUT}.",
    )
    parser.add_argument(
        "--text-fields",
        default=",".join(DEFAULT_TEXT_FIELDS),
        help="Batch mode comma-separated source fields, in priority order.",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="Optional JSON manifest path for batch mode.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Batch mode: do not regenerate files that already exist.",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Batch mode: continue generating the remaining files after one item fails.",
    )
    parser.add_argument(
        "--output",
        help="Output audio path. Defaults to output/jupyter-notebook/audio/tailo-tts-<timestamp>.",
    )
    parser.add_argument(
        "--format",
        default="mp3",
        choices=["mp3", "wav"],
        help="Output file format. Hapsing supports mp3 only. Default: mp3.",
    )
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        choices=["hapsing", "azure"],
        help="TTS provider. Default: hapsing, which does not require an API key.",
    )
    parser.add_argument(
        "--dialect",
        default=DEFAULT_DIALECT,
        choices=["south", "north", "singapore"],
        help="Taibun dialect used before calling Hapsing. Default: south.",
    )
    parser.add_argument(
        "--sandhi",
        default=DEFAULT_SANDHI,
        choices=["none", "auto", "exc_last", "incl_last"],
        help="Taibun tone sandhi mode used before calling Hapsing. Default: none.",
    )
    parser.add_argument(
        "--tls-verify",
        default="auto",
        choices=["auto", "true", "false"],
        help="TLS verification for Hapsing. auto retries without verification only on certificate-chain failure.",
    )
    parser.add_argument(
        "--show-normalized",
        action="store_true",
        help="Print the number-tone Tai-lo sent to Hapsing.",
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"Azure voice name. Default: {DEFAULT_VOICE}.",
    )
    parser.add_argument(
        "--lang",
        default=DEFAULT_LANG,
        help=f"SSML language tag for Tai-lo input. Default: {DEFAULT_LANG}.",
    )
    parser.add_argument(
        "--azure-output-format",
        default=None,
        help="Override Azure X-Microsoft-OutputFormat.",
    )
    parser.add_argument(
        "--env",
        default=None,
        help="Optional .env path. Defaults to project-root .env when python-dotenv is installed.",
    )
    args = parser.parse_args()

    load_env(args.env)
    if args.questions_json:
        manifest = synthesize_question_items(
            questions_path=Path(args.questions_json),
            output_dir=Path(args.questions_output),
            text_fields=parse_text_fields(args.text_fields),
            provider=args.provider,
            dialect=args.dialect,
            sandhi=args.sandhi,
            audio_format=args.format,
            voice=args.voice,
            lang=args.lang,
            azure_output_format=args.azure_output_format,
            tls_verify=args.tls_verify,
            skip_existing=args.skip_existing,
            show_normalized=args.show_normalized,
            continue_on_error=args.continue_on_error,
        )
        manifest_path = Path(args.manifest) if args.manifest else (
            Path(args.questions_output) / "tailo_tts_manifest.json"
        )
        write_manifest(manifest_path, manifest)
        saved_count = sum(1 for item in manifest if item["status"] == "saved")
        skipped_count = sum(1 for item in manifest if item["status"] == "skipped")
        error_count = sum(1 for item in manifest if item["status"] == "error")
        print(
            f"Batch complete: saved={saved_count}, "
            f"skipped={skipped_count}, errors={error_count}"
        )
        print(f"Manifest: {manifest_path}")
        return

    tailo_text = collect_tailo_text(args)
    if args.provider == "hapsing" and args.format != "mp3":
        raise ValueError("Hapsing provider returns mp3; use --format mp3.")

    output_path = Path(args.output) if args.output else default_output_path(args.format)
    if (
        args.provider == "hapsing"
        and output_path.suffix
        and output_path.suffix.lower() != ".mp3"
    ):
        raise ValueError("Hapsing provider returns mp3; use an .mp3 output path.")
    azure_output_format = args.azure_output_format or (
        AZURE_WAV_FORMAT if args.format == "wav" else AZURE_MP3_FORMAT
    )

    if args.provider == "hapsing" and args.show_normalized:
        normalized = normalize_tailo_for_hapsing(
            tailo_text,
            dialect=args.dialect,
            sandhi=args.sandhi,
        )
        print(f"Hapsing Tai-lo: {normalized}")

    saved_path = synthesize_tailo_to_file(
        tailo_text=tailo_text,
        output_path=output_path,
        provider=args.provider,
        dialect=args.dialect,
        sandhi=args.sandhi,
        voice=args.voice,
        lang=args.lang,
        azure_output_format=azure_output_format,
        tls_verify=args.tls_verify,
    )
    print(f"Saved audio: {saved_path}")


if __name__ == "__main__":
    main()
