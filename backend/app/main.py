from __future__ import annotations

from pathlib import Path
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from backend.app import api, storage

load_dotenv()

app = FastAPI(title="Cognitive Q&A Screening")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"] ,
    allow_headers=["*"],
)

app.include_router(api.router, prefix="/api")

base_dir = Path(__file__).resolve().parents[2]
frontend_path = base_dir / "frontend"
static_questions = base_dir / "static"

if static_questions.exists():
    app.mount("/static", StaticFiles(directory=static_questions), name="static")
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")


@app.on_event("startup")
async def startup() -> None:
    storage.init_db()
