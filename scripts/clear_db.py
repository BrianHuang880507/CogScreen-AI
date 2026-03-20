from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "app.db"


def backup_database() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = DB_PATH.with_name(f"app_{timestamp}.db.bak")
    shutil.copy2(DB_PATH, backup_path)
    return backup_path


def clear_database() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM responses")
        cursor.execute("DELETE FROM instrument_scores")
        cursor.execute("DELETE FROM sessions")
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    print(f"DB path: {DB_PATH}")
    if not DB_PATH.exists():
        print("Database file does not exist.")
        return

    backup_path = backup_database()
    print(f"Backup created: {backup_path}")

    confirmation = input("Type CLEAR to remove all rows from app.db: ").strip()
    if confirmation != "CLEAR":
        print("Canceled. Backup kept, database unchanged.")
        return

    clear_database()
    print("Database cleared.")


if __name__ == "__main__":
    main()
