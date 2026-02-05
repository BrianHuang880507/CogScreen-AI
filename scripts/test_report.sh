#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:8000"
INSTRUMENT="mmse"
PATIENT_ID="P001"
AUDIO_PATH="static/questions/MMSE_Q1.mp3"
OUTPUT_PATH="result.json"
API_URL="https://play-game-api.azurewebsites.net/v1.0/telemetry/info"
PAYLOAD_PATH="data/reports/mock_full_result.json"
SAVE_RESPONSE_PATH="result_api_response.json"
SUBMIT=0
DIRECT_POST=0

usage() {
  cat <<USAGE
Usage: $0 [--submit] [--direct-post] [--base-url URL] [--instrument mmse] [--patient-id P001]
          [--audio path] [--output path] [--api-url URL] [--payload path] [--save-response path]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --submit) SUBMIT=1; shift ;;
    --direct-post) DIRECT_POST=1; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --instrument) INSTRUMENT="$2"; shift 2 ;;
    --patient-id) PATIENT_ID="$2"; shift 2 ;;
    --audio) AUDIO_PATH="$2"; shift 2 ;;
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    --api-url) API_URL="$2"; shift 2 ;;
    --payload) PAYLOAD_PATH="$2"; shift 2 ;;
    --save-response) SAVE_RESPONSE_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

echo "Using BaseUrl: $BASE_URL"
echo "Using Instrument: $INSTRUMENT"

if [[ $DIRECT_POST -eq 1 ]]; then
  if [[ ! -f "$PAYLOAD_PATH" ]]; then
    echo "Payload JSON not found: $PAYLOAD_PATH" >&2
    exit 1
  fi
  echo "Direct POST -> $API_URL"
  response=$(curl -sS -w "\n%{http_code}" -H "Content-Type: application/json" \
    -d "$(jq -c '{info: .}' "$PAYLOAD_PATH")" \
    "$API_URL")
  status=$(echo "$response" | tail -n1 | tr -d '\r')
  body=$(echo "$response" | sed '$d')
  echo "Direct POST status: $status"
  echo "$body" > "$SAVE_RESPONSE_PATH"
  echo "API response saved to: $SAVE_RESPONSE_PATH"
  exit 0
fi

if [[ ! -f "$AUDIO_PATH" ]]; then
  echo "Audio file not found: $AUDIO_PATH" >&2
  exit 1
fi

payload=$(jq -n --arg pid "$PATIENT_ID" --arg inst "$INSTRUMENT" '{patient_id:$pid, instrument:$inst, config:{}}')
session=$(curl -sS -H "Content-Type: application/json" -d "$payload" "$BASE_URL/api/sessions")
session_id=$(echo "$session" | jq -r '.session_id')
if [[ -z "$session_id" || "$session_id" == "null" ]]; then
  echo "Failed to create session." >&2
  echo "$session" >&2
  exit 1
fi
echo "Session ID: $session_id"

question=$(curl -sS "$BASE_URL/api/sessions/$session_id/next")
question_id=$(echo "$question" | jq -r '.question_id')
if [[ -z "$question_id" || "$question_id" == "null" ]]; then
  echo "Failed to fetch question." >&2
  echo "$question" >&2
  exit 1
fi
echo "Question ID: $question_id"

upload_response=$(curl -sS -w "\n%{http_code}" -X POST \
  -F "audio=@$AUDIO_PATH" \
  -F "question_id=$question_id" \
  "$BASE_URL/api/sessions/$session_id/responses")
upload_status=$(echo "$upload_response" | tail -n1 | tr -d '\r')
if ! [[ "$upload_status" =~ ^[0-9]+$ ]]; then
  echo "Upload did not return a status code." >&2
  exit 1
fi
if [[ $upload_status -lt 200 || $upload_status -ge 300 ]]; then
  echo "Upload failed with status $upload_status" >&2
  exit 1
fi

sleep 0.3

if [[ $SUBMIT -eq 1 ]]; then
  report=$(curl -sS -X POST "$BASE_URL/api/sessions/$session_id/submit")
else
  report=$(curl -sS "$BASE_URL/api/sessions/$session_id/report")
fi

report_sid=$(echo "$report" | jq -r '.session_id')
if [[ "$report_sid" != "$session_id" ]]; then
  echo "Report session_id mismatch." >&2
  echo "$report" >&2
  exit 1
fi

echo "$report" | jq '.' > "$OUTPUT_PATH"
echo "Report saved to: $OUTPUT_PATH"
echo "OK"
