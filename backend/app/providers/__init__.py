"""Pluggable AI providers.

Everything AI-related sits behind a small interface so the project stays
open-source and vendor-neutral. Concrete providers are selected at runtime
from configuration by the factory functions below.
"""
from __future__ import annotations

from ..config import Settings, get_settings
from .base import EmbeddingProvider, LLMProvider, TranscriptionProvider


def get_llm_provider(settings: Settings | None = None) -> LLMProvider:
    settings = settings or get_settings()
    if settings.llm_provider == "mock":
        from .mock import MockLLM

        return MockLLM(settings)
    if settings.llm_provider == "ollama":
        from .ollama_llm import OllamaLLM

        return OllamaLLM(settings)
    if settings.llm_provider == "openai":
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM(settings)
    raise ValueError(f"Unknown LLM provider: {settings.llm_provider!r}")


def get_transcription_provider(settings: Settings | None = None) -> TranscriptionProvider:
    settings = settings or get_settings()
    if settings.transcribe_provider == "mock":
        from .mock import MockTranscriber

        return MockTranscriber(settings)
    if settings.transcribe_provider == "faster_whisper":
        from .whisper_transcribe import FasterWhisperTranscriber

        return FasterWhisperTranscriber(settings)
    if settings.transcribe_provider == "openai":
        from .openai_compat import OpenAICompatTranscriber

        return OpenAICompatTranscriber(settings)
    raise ValueError(f"Unknown transcription provider: {settings.transcribe_provider!r}")


def get_embedding_provider(settings: Settings | None = None) -> EmbeddingProvider:
    settings = settings or get_settings()
    if settings.embed_provider == "mock":
        from .mock import MockEmbedder

        return MockEmbedder(settings)
    if settings.embed_provider == "sentence_transformers":
        from .st_embed import SentenceTransformerEmbedder

        return SentenceTransformerEmbedder(settings)
    if settings.embed_provider == "openai":
        from .openai_compat import OpenAICompatEmbedder

        return OpenAICompatEmbedder(settings)
    raise ValueError(f"Unknown embedding provider: {settings.embed_provider!r}")


__all__ = [
    "EmbeddingProvider",
    "LLMProvider",
    "TranscriptionProvider",
    "get_llm_provider",
    "get_transcription_provider",
    "get_embedding_provider",
]
