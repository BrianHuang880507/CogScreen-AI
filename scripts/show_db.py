from __future__ import annotations

import json
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "app.db"


def print_tables(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    tables = [row[0] for row in cursor.fetchall()]
    if not tables:
        print("No tables found.")
        return

    print("Tables:")
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  - {table}: {count}")


def print_recent_sessions(conn: sqlite3.Connection, limit: int = 10) -> None:
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, patient_id, instrument, config_json, created_at
        FROM sessions
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cursor.fetchall()
    if not rows:
        print("\nNo sessions found.")
        return

    print(f"\nRecent sessions ({len(rows)}):")
    for row in rows:
        config = {}
        if row[3]:
            try:
                config = json.loads(row[3])
            except json.JSONDecodeError:
                config = {}
        patient_name = config.get("name") or "-"
        print(
            f"  - session_id={row[0]} | patient_id={row[1]} | "
            f"name={patient_name} | instrument={row[2] or '-'} | created_at={row[4]}",
        )


def main() -> None:
    print(f"DB path: {DB_PATH}")
    if not DB_PATH.exists():
        print("Database file does not exist.")
        return

    conn = sqlite3.connect(DB_PATH)
    try:
        print_tables(conn)
        print_recent_sessions(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
