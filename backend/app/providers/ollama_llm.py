"""Local, open-source LLM via Ollama (https://ollama.com).

Talks to the Ollama HTTP API. No proprietary dependency; the model itself
(e.g. llama3.1) is open weights served on your own machine.
"""
from __future__ import annotations

import httpx

from ..config import Settings
from .base import LLMProvider

_TIMEOUT = httpx.Timeout(180.0)


class OllamaLLM(LLMProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def chat(self, messages: list[dict], *, temperature: float = 0.2) -> str:
        url = f"{self.settings.ollama_base_url.rstrip('/')}/api/chat"
        payload = {
            "model": self.settings.llm_model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["message"]["content"]
