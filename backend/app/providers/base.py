"""Abstract provider interfaces.

Keep these small and stable. Concrete providers (local open-source or any
OpenAI-compatible endpoint) implement them.
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class Message(dict):
    """A chat message: {"role": ..., "content": ...}."""

    def __init__(self, role: str, content: str) -> None:
        super().__init__(role=role, content=content)


class LLMProvider(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], *, temperature: float = 0.2) -> str:
        """Return the assistant's reply text for a list of chat messages."""


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str) -> str:
        """Return the transcript text for an audio file on disk."""


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text."""

    @abstractmethod
    def embed_one(self, text: str) -> list[float]:
        """Return a single embedding vector."""
