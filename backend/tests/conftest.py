"""Test fixtures. Forces offline mock providers and an isolated temp DB so
tests need no models, network, or API keys.
"""
from __future__ import annotations

import importlib
import os

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Offline, deterministic providers.
    monkeypatch.setenv("AISCRIBE_LLM_PROVIDER", "mock")
    monkeypatch.setenv("AISCRIBE_TRANSCRIBE_PROVIDER", "mock")
    monkeypatch.setenv("AISCRIBE_EMBED_PROVIDER", "mock")
    # Isolated data dir + DB per test run.
    monkeypatch.setenv("AISCRIBE_DATA_DIR", str(tmp_path / "data"))

    # Reload config and modules that captured settings at import time.
    from app import config

    config.get_settings.cache_clear()
    import app.db as db_module

    importlib.reload(db_module)
    import app.main as main_module

    importlib.reload(main_module)

    from fastapi.testclient import TestClient

    with TestClient(main_module.app) as c:
        yield c
