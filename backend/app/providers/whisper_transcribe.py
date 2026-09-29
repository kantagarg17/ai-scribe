"""Local, on-device transcription via faster-whisper.

faster-whisper is an open-source (MIT) reimplementation of OpenAI's Whisper.
Imported lazily so the app starts even when it isn't installed; the error
only surfaces if you actually select this provider without installing it.
"""
from __future__ import annotations

from functools import lru_cache

from ..config import Settings
from .base import TranscriptionProvider


@lru_cache(maxsize=2)
def _load_model(model_size: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on optional install
        raise RuntimeError(
            "faster-whisper is not installed. Install it with "
            "`pip install faster-whisper`, or set "
            "AISCRIBE_TRANSCRIBE_PROVIDER=openai to use a hosted endpoint."
        ) from exc
    # int8 on CPU keeps this runnable on a laptop.
    return WhisperModel(model_size, device="cpu", compute_type="int8")


class FasterWhisperTranscriber(TranscriptionProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def transcribe(self, audio_path: str) -> str:
        model = _load_model(self.settings.whisper_model)
        segments, _info = model.transcribe(audio_path, beam_size=5)
        return " ".join(seg.text.strip() for seg in segments).strip()
