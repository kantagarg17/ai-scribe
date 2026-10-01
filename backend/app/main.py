"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routers import chat, patients, record, visits


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Hosted deployments have no shell to run the seed script, so optionally
    # seed the demo patient on first boot (no-op if "Dana" already exists).
    if get_settings().seed_on_start:
        try:
            from .seed import seed

            seed()
        except Exception as exc:  # pragma: no cover - best-effort on boot
            print(f"[seed_on_start] skipped: {exc}")
    yield


app = FastAPI(
    title="AI-Scribe",
    description="The patient's AI scribe: an interactive, patient-owned health record.",
    version="0.1.0",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patients.router)
app.include_router(record.router)
app.include_router(visits.router)
app.include_router(chat.router)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "llm_provider": _settings.llm_provider,
        "transcribe_provider": _settings.transcribe_provider,
        "embed_provider": _settings.embed_provider,
    }
