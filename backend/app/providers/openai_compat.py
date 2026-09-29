"""Providers backed by any OpenAI-compatible HTTP API.

Works with the official OpenAI API or any server that implements the same
routes (LM Studio, vLLM, LocalAI, llama.cpp server, etc.). Uses httpx
directly so there is no proprietary SDK dependency.
"""
from __future__ import annotations

import httpx

from ..config import Settings
from .base import EmbeddingProvider, LLMProvider, TranscriptionProvider

_TIMEOUT = httpx.Timeout(120.0)


def _headers(settings: Settings) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.openai_api_key:
        headers["Authorization"] = f"Bearer {settings.openai_api_key}"
    return headers


class OpenAICompatLLM(LLMProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def chat(self, messages: list[dict], *, temperature: float = 0.2) -> str:
        url = f"{self.settings.openai_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": self.settings.llm_model,
            "messages": messages,
            "temperature": temperature,
        }
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(url, json=payload, headers=_headers(self.settings))
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]


class OpenAICompatTranscriber(TranscriptionProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def transcribe(self, audio_path: str) -> str:
        url = f"{self.settings.openai_base_url.rstrip('/')}/audio/transcriptions"
        headers = {}
        if self.settings.openai_api_key:
            headers["Authorization"] = f"Bearer {self.settings.openai_api_key}"
        with open(audio_path, "rb") as fh, httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(
                url,
                headers=headers,
                data={"model": self.settings.transcribe_model},
                files={"file": (audio_path, fh)},
            )
            resp.raise_for_status()
            data = resp.json()
        return data.get("text", "")


class OpenAICompatEmbedder(EmbeddingProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        url = f"{self.settings.openai_base_url.rstrip('/')}/embeddings"
        payload = {"model": self.settings.embed_model, "input": texts}
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(url, json=payload, headers=_headers(self.settings))
            resp.raise_for_status()
            data = resp.json()
        # Preserve input order.
        items = sorted(data["data"], key=lambda d: d["index"])
        return [item["embedding"] for item in items]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]
