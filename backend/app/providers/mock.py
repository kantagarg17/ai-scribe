"""Built-in offline providers for demos, tests, and first-run.

These require no models, no network, and no API keys, so AI-Scribe is
runnable the moment you clone it. They are deterministic and clearly not a
real model - set real providers (ollama / faster_whisper /
sentence_transformers / openai) for genuine output.

Select with AISCRIBE_*_PROVIDER=mock.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

from ..config import Settings
from .base import EmbeddingProvider, LLMProvider, TranscriptionProvider

_DIM = 256


class MockLLM(LLMProvider):
    """Extractive, rule-based stand-in for a chat model.

    For visit summarization it returns valid JSON built from the transcript.
    For grounded chat it answers from the provided record excerpts. It never
    invents facts - it only reflects text it was given.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def chat(self, messages: list[dict], *, temperature: float = 0.2) -> str:
        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")

        if "Return ONLY the JSON object" in user or '"caregiver_update"' in user:
            return self._summarize(user)
        return self._answer(user)

    @staticmethod
    def _sentences(text: str) -> list[str]:
        parts = re.split(r"(?<=[.!?])\s+|\n+", text)
        return [p.strip() for p in parts if len(p.strip()) > 3]

    def _summarize(self, user: str) -> str:
        transcript = user.split("TRANSCRIPT:", 1)[-1].strip()
        sentences = self._sentences(transcript)
        summary = " ".join(sentences[:4]) or "This visit was recorded."

        step_cues = ("should", "need to", "make sure", "follow up", "call", "schedule",
                     "take", "avoid", "watch for", "come back", "return")
        steps = [s for s in sentences if any(c in s.lower() for c in step_cues)][:5]

        caregiver = (
            "Here's a quick update from the visit: "
            + (sentences[0] if sentences else "everything was reviewed.")
            + " You can help by keeping track of the next steps and appointments."
        )
        return json.dumps(
            {"summary": summary, "next_steps": steps, "caregiver_update": caregiver}
        )

    def _answer(self, user: str) -> str:
        # Pull the excerpts block out of the grounding prompt.
        excerpts = user
        if "Excerpts from your record:" in user:
            excerpts = user.split("Excerpts from your record:", 1)[1]
        excerpts = excerpts.split("Question:", 1)[0].strip()
        if not excerpts:
            return (
                "I don't see anything in your record about that yet. "
                "Please ask your care team."
            )
        first = self._sentences(excerpts)[:3]
        body = " ".join(first)
        return (
            f"Based on your record: {body} "
            "If anything here is unclear, please check with your care team. "
            "(This is not medical advice.)"
        )


class MockTranscriber(TranscriptionProvider):
    """Returns a note pointing at the real providers.

    Real audio transcription needs a real model; for offline demos use the
    /visits/transcript endpoint with text instead.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def transcribe(self, audio_path: str) -> str:
        return (
            "[mock transcriber] Audio was received but the mock provider does not "
            "transcribe. Set AISCRIBE_TRANSCRIBE_PROVIDER=faster_whisper (local) or "
            "=openai, or submit a transcript via the /visits/transcript endpoint."
        )


class MockEmbedder(EmbeddingProvider):
    """Deterministic hashing embedder.

    Maps token hashes into a fixed-dimension vector (a bag-of-words hashing
    trick). Good enough to make retrieval work offline; not semantic.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def embed_one(self, text: str) -> list[float]:
        vec = [0.0] * _DIM
        for token in re.findall(r"[a-z0-9]+", text.lower()):
            h = int(hashlib.md5(token.encode()).hexdigest(), 16)
            vec[h % _DIM] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_one(t) for t in texts]
