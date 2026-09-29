"""SQLModel data models for the patient-owned record.

The record is a single timeline of ``Document`` rows for one ``Patient``.
Documents come in a few kinds (visit note, lab, scan, discharge). A visit
note may have a structured ``VisitSummary`` derived from its transcript.
Every document is split into ``Chunk`` rows for grounded retrieval.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DocumentKind(str, enum.Enum):
    VISIT_NOTE = "visit_note"
    LAB = "lab"
    SCAN = "scan"
    DISCHARGE = "discharge"


class Patient(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=utcnow)


class Document(SQLModel, table=True):
    """A single item in the patient's record timeline."""

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patient.id", index=True)
    kind: DocumentKind = Field(index=True)
    title: str
    # ISO date the document pertains to (e.g. the visit or collection date).
    doc_date: str
    # Full plain-text content used for display and retrieval.
    content: str
    # Optional path to a source file (audio, PDF) kept on disk.
    source_path: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class VisitSummary(SQLModel, table=True):
    """Plain-language output derived from a visit transcript."""

    id: int | None = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="document.id", index=True, unique=True)
    summary: str
    # Newline-separated action items.
    next_steps: str
    # A shareable update written for a caregiver.
    caregiver_update: str
    created_at: datetime = Field(default_factory=utcnow)


class Chunk(SQLModel, table=True):
    """A retrievable slice of a document, with a stored embedding."""

    id: int | None = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="document.id", index=True)
    patient_id: int = Field(foreign_key="patient.id", index=True)
    ordinal: int
    text: str
    # Embedding stored as JSON-encoded list[float].
    embedding: str
