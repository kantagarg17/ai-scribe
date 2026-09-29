"""Database engine and session helpers."""
from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()
_engine = create_engine(
    f"sqlite:///{_settings.db_path}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create tables. Imports models so they register on SQLModel.metadata."""
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(_engine)


def get_engine():
    return _engine


def get_session() -> Iterator[Session]:
    with Session(_engine) as session:
        yield session
