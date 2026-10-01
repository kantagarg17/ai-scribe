"""Application configuration, loaded from environment / .env.

All settings are prefixed with ``AISCRIBE_``. See ``.env.example``.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AISCRIBE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    data_dir: Path = Path("./data")
    cors_origins: str = "http://localhost:5173"
    # Seed the demo patient on startup if the DB is empty (useful for hosted
    # deployments where there's no shell to run `python -m app.seed`).
    seed_on_start: bool = False

    # LLM provider
    llm_provider: str = "ollama"  # "ollama" | "openai"
    llm_model: str = "llama3.1"
    ollama_base_url: str = "http://localhost:11434"

    # Shared OpenAI-compatible endpoint (used by any provider set to "openai")
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str = ""

    # Transcription provider
    transcribe_provider: str = "faster_whisper"  # "faster_whisper" | "openai"
    whisper_model: str = "base"
    transcribe_model: str = "whisper-1"

    # Embedding provider
    embed_provider: str = "sentence_transformers"  # "sentence_transformers" | "openai"
    embed_model: str = "all-MiniLM-L6-v2"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def db_path(self) -> Path:
        return self.data_dir / "aiscribe.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
