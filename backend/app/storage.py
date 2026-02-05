from __future__ import annotations

import csv
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("DATABASE_PATH", "./data/app.db"))


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
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
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
            """
        )
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(responses)").fetchall()]
        if "manual_confirmed" not in columns:
            conn.execute("ALTER TABLE responses ADD COLUMN manual_confirmed INTEGER")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS instrument_scores (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                instrument TEXT NOT NULL,
                score REAL NOT NULL,
                interpretation_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
            """
        )


def create_session(session_id: str, patient_id: str, instrument: str | None, config: dict[str, Any]) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, patient_id, instrument, config_json) VALUES (?, ?, ?, ?)",
            (session_id, patient_id, instrument, json.dumps(config)),
        )


def get_session(session_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def save_response(
    response_id: str,
    session_id: str,
    question_id: str,
    transcript: str | None,
    reaction_time_whisper_ms: float | None,
    reaction_time_vad_ms: float | None,
    manual_confirmed: bool | None,
    rule_score: dict[str, Any] | None,
    llm_judge: dict[str, Any] | None,
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO responses (
                id, session_id, question_id, transcript, reaction_time_whisper_ms,
                reaction_time_vad_ms, manual_confirmed, rule_score_json, llm_judge_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                response_id,
                session_id,
                question_id,
                transcript,
                reaction_time_whisper_ms,
                reaction_time_vad_ms,
                1 if manual_confirmed else 0 if manual_confirmed is not None else None,
                json.dumps(rule_score) if rule_score else None,
                json.dumps(llm_judge) if llm_judge else None,
            ),
        )


def list_responses(session_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM responses WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_instrument_score(
    score_id: str,
    session_id: str,
    instrument: str,
    score: float,
    interpretation: dict[str, Any],
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO instrument_scores (id, session_id, instrument, score, interpretation_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (score_id, session_id, instrument, score, json.dumps(interpretation)),
        )


def list_instrument_scores(session_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM instrument_scores WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def export_responses_csv(session_id: str, output_path: str) -> None:
    rows = list_responses(session_id)
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
