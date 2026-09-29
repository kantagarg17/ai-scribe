"""Local, on-device embeddings via sentence-transformers.

sentence-transformers is open-source (Apache-2.0). Models like
all-MiniLM-L6-v2 are small enough to run on a laptop CPU. Imported lazily so
the app starts without it installed.
"""
from __future__ import annotations

from functools import lru_cache

from ..config import Settings
from .base import EmbeddingProvider


@lru_cache(maxsize=2)
def _load_model(model_name: str):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:  # pragma: no cover - depends on optional install
        raise RuntimeError(
            "sentence-transformers is not installed. Install it with "
            "`pip install sentence-transformers`, or set "
            "AISCRIBE_EMBED_PROVIDER=openai to use a hosted endpoint."
        ) from exc
    return SentenceTransformer(model_name)


class SentenceTransformerEmbedder(EmbeddingProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        model = _load_model(self.settings.embed_model)
        vectors = model.encode(texts, normalize_embeddings=True)
        return [v.tolist() for v in vectors]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]
