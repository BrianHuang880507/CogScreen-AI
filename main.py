# python3 main.py --session-id <session_id>

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import requests


def fetch_report(base_url: str, session_id: str) -> dict:
    base_url = base_url.rstrip("/")
    report_url = f"{base_url}/api/sessions/{session_id}/report"
    response = requests.get(report_url, timeout=30)
    response.raise_for_status()
    return response.json()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch report and forward JSON payload.")
    parser.add_argument("--session-id", required=True, help="Session ID from the web test.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("COGSCREEN_BASE_URL", "http://localhost:8000"),
        help="Base URL for the FastAPI server.",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("COGSCREEN_API_URL", "https://play-game-api.azurewebsites.net/v1.0/telemetry/info"),
        help="Destination API URL for posting JSON.",
    )
    parser.add_argument(
        "--output",
        default=os.getenv("COGSCREEN_REPORT_PATH", "result.json"),
        help="Path to write the report JSON.",
    )
    args = parser.parse_args()

    report = fetch_report(args.base_url, args.session_id)
    output_path = Path(args.output)
    write_json(output_path, report)

    response = requests.post(
        args.api_url,
        json=report,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    print("Report saved to:", output_path)
    print("POST status:", response.status_code)
    print("Response:", response.text)


if __name__ == "__main__":
    main()
