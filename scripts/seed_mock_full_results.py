from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "app.db"
QUESTION_PATH = PROJECT_ROOT / "data" / "SPMSQ_questions.json"

PATIENT_ID = "mock-patient-001"
PATIENT_NAME = "王小明(模擬)"
PATIENT_GENDER = "male"
PATIENT_AGE = 72

SESSIONS = [
    {
        "session_id": "mock-full-20260319-001",
        "created_at": "2026-03-19 10:27:00",
        "wrong_question_numbers": {4, 8, 10},
        "severity": "mild",
        "note": "第一次測試：輕度風險，建議追蹤。",
    },
    {
        "session_id": "mock-full-20260320-001",
        "created_at": "2026-03-20 10:27:00",
        "wrong_question_numbers": {2, 4, 7, 8, 10},
        "severity": "moderate",
        "note": "第二次測試：中度風險，建議進一步評估。",
    },
]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            instrument TEXT,
            config_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS responses (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question_id TEXT NOT NULL,
            transcript TEXT,
            reaction_time_whisper_ms REAL,
            reaction_time_vad_ms REAL,
            manual_confirmed INTEGER,
            rule_score_json TEXT,
            llm_judge_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS instrument_scores (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            instrument TEXT NOT NULL,
            score REAL NOT NULL,
            interpretation_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def load_questions() -> list[dict]:
    payload = json.loads(QUESTION_PATH.read_text(encoding="utf-8"))
    questions: list[dict] = []
    for item in payload:
        qid = item.get("id") or item.get("question_id")
        text = item.get("text")
        if not qid or not text:
            continue
        questions.append({"question_id": str(qid), "text": str(text)})
    return questions


def build_answer(question_no: int, is_correct: bool) -> str:
    if not is_correct:
        return f"模擬錯誤回答 {question_no}"

    answer_map = {
        1: "2026年03月20日",
        2: "星期五",
        3: "台北市醫院",
        4: "02-1234-5678",
        5: "72",
        6: "1953年10月10日",
        7: "現任總統",
        8: "前任總統",
        9: "王媽媽",
        10: "17, 14, 11, 8, 5",
        11: "台北市中正區",
    }
    return answer_map.get(question_no, f"模擬正確回答 {question_no}")


def reset_session(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute("DELETE FROM responses WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM instrument_scores WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


def seed_session(conn: sqlite3.Connection, spec: dict, questions: list[dict]) -> None:
    session_id = spec["session_id"]
    created_at = datetime.strptime(spec["created_at"], "%Y-%m-%d %H:%M:%S")
    wrong_numbers = set(spec["wrong_question_numbers"])

    reset_session(conn, session_id)

    config = {
        "name": PATIENT_NAME,
        "gender": PATIENT_GENDER,
        "age": PATIENT_AGE,
        "seed_tag": "mock_full",
    }

    conn.execute(
        """
        INSERT INTO sessions (id, patient_id, instrument, config_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (session_id, PATIENT_ID, "spmsq", json.dumps(config, ensure_ascii=False), spec["created_at"]),
    )

    for idx, question in enumerate(questions, start=1):
        is_correct = idx not in wrong_numbers
        rt_vad = 1080 + idx * 37
        rt_whisper = rt_vad + 420 + (idx % 4) * 33
        response_time = created_at + timedelta(seconds=idx * 41)

        rule_score = {
            "type": "mock",
            "is_correct": is_correct,
            "score": 1 if is_correct else 0,
            "details": f"SPMSQ 模擬題 {idx}",
            "matched": [build_answer(idx, True)] if is_correct else [],
        }
        llm_judge = {
            "is_correct": is_correct,
            "confidence": 0.94 if is_correct else 0.58,
            "reason": "seeded mock",
            "matched_expected": [build_answer(idx, True)] if is_correct else [],
        }

        conn.execute(
            """
            INSERT INTO responses (
                id,
                session_id,
                question_id,
                transcript,
                reaction_time_whisper_ms,
                reaction_time_vad_ms,
                manual_confirmed,
                rule_score_json,
                llm_judge_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                session_id,
                question["question_id"],
                build_answer(idx, is_correct),
                rt_whisper,
                rt_vad,
                1 if is_correct else 0,
                json.dumps(rule_score, ensure_ascii=False),
                json.dumps(llm_judge, ensure_ascii=False),
                response_time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )

    errors = len(wrong_numbers)
    interpretation = {
        "severity": spec["severity"],
        "severity_band": spec["severity"],
        "adjusted_errors": errors,
        "education_level": "high_school",
        "error_adjustment": 0,
        "notes": spec.get("note", ""),
    }
    conn.execute(
        """
        INSERT INTO instrument_scores (id, session_id, instrument, score, interpretation_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            session_id,
            "SPMSQ",
            errors,
            json.dumps(interpretation, ensure_ascii=False),
            spec["created_at"],
        ),
    )


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    questions = load_questions()
    if not questions:
        raise RuntimeError("No SPMSQ questions found.")

    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(conn)
        for spec in SESSIONS:
            seed_session(conn, spec, questions)
        conn.commit()
    finally:
        conn.close()

    print("Seed completed.")
    print(f"patient_id: {PATIENT_ID}")
    print(f"patient_name: {PATIENT_NAME}")
    for spec in SESSIONS:
        print(f"session: {spec['session_id']} @ {spec['created_at']}")


if __name__ == "__main__":
    main()
