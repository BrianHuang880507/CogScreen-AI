#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> tuple[str, str]:
    parser = ArgumentParser(
        description="Seed a mock SPMSQ session into SQLite for results page demo."
    )
    parser.add_argument(
        "--session-id",
        default="mock-20260319-001",
        help="Session ID used by /results.html?session_id=...",
    )
    parser.add_argument(
        "--db-path",
        default=os.getenv("DATABASE_PATH", "./data/app.db"),
        help="SQLite database path. Default reads DATABASE_PATH then ./data/app.db",
    )
    args = parser.parse_args()
    return args.session_id, args.db_path


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


def seed_mock(conn: sqlite3.Connection, session_id: str) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn.execute("DELETE FROM responses WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM instrument_scores WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    conn.execute(
        """
        INSERT INTO sessions (id, patient_id, instrument, config_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (session_id, "P-MOCK-001", "spmsq", json.dumps({"age": 72}), now),
    )

    mock_rows = [
        ("SPMSQ_Q1", "2026年3月19日", 1600.0, 1880.0, True),
        ("SPMSQ_Q2", "星期四", 1200.0, 1550.0, True),
        ("SPMSQ_Q3", "台北市某醫院", 1750.0, 2100.0, True),
        ("SPMSQ_Q4", "我不記得電話", 2400.0, 2720.0, False),
        ("SPMSQ_Q5", "72歲", 1500.0, 1800.0, True),
    ]

    for question_id, transcript, vad_ms, whisper_ms, is_correct in mock_rows:
        rule_score = {
            "type": "contains_any",
            "is_correct": is_correct,
            "matched": [transcript] if is_correct else [],
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                session_id,
                question_id,
                transcript,
                whisper_ms,
                vad_ms,
                None,
                json.dumps(rule_score, ensure_ascii=False),
                None,
                now,
            ),
        )

    interpretation = {
        "adjusted_errors": 2,
        "education_level": "high_school_or_more",
        "error_adjustment": 0,
        "severity": "mild",
        "notes": "mock result for UI demo",
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
            2,
            json.dumps(interpretation, ensure_ascii=False),
            now,
        ),
    )


def main() -> None:
    session_id, db_path = parse_args()
    db = Path(db_path)
    db.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db) as conn:
        ensure_schema(conn)
        seed_mock(conn, session_id)
        session_count = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()[0]
        response_count = conn.execute(
            "SELECT COUNT(*) FROM responses WHERE session_id = ?",
            (session_id,),
        ).fetchone()[0]
        score_count = conn.execute(
            "SELECT COUNT(*) FROM instrument_scores WHERE session_id = ?",
            (session_id,),
        ).fetchone()[0]

    print(f"Seeded session_id={session_id}")
    print(f"db_path={db}")
    print(
        f"sessions={session_count}, responses={response_count}, instrument_scores={score_count}"
    )


if __name__ == "__main__":
    main()
