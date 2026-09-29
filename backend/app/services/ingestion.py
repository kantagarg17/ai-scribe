"""Turn documents into retrievable, embedded chunks.

Kept deliberately simple: split on paragraph/sentence boundaries into
overlapping windows, embed each, and store. This is the "one patient-owned
record" plumbing that also powers grounded Q&A.
"""
from __future__ import annotations

import json
import re

from sqlmodel import Session, delete, select

from ..models import Chunk, Document
from ..providers import get_embedding_provider

_MAX_CHARS = 700
_OVERLAP = 120


def chunk_text(text: str, max_chars: int = _MAX_CHARS, overlap: int = _OVERLAP) -> list[str]:
    """Split text into overlapping windows on sentence-ish boundaries."""
    text = text.strip()
    if not text:
        return []
    # Break into sentence-like units first so windows don't cut mid-sentence.
    units = re.split(r"(?<=[.!?])\s+|\n+", text)
    units = [u.strip() for u in units if u.strip()]

    chunks: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
        elif len(current) + 1 + len(unit) <= max_chars:
            current = f"{current} {unit}"
        else:
            chunks.append(current)
            # Start next window with a tail overlap for context continuity.
            tail = current[-overlap:] if overlap else ""
            current = f"{tail} {unit}".strip() if tail else unit
    if current:
        chunks.append(current)
    return chunks


def index_document(session: Session, document: Document) -> int:
    """(Re)build chunk+embedding rows for a single document. Returns count."""
    # Clear any existing chunks for this document (idempotent re-index).
    session.exec(delete(Chunk).where(Chunk.document_id == document.id))

    pieces = chunk_text(document.content)
    if not pieces:
        session.commit()
        return 0

    embedder = get_embedding_provider()
    # Prefix each chunk with the document title/date so retrieval has context.
    prefixed = [f"[{document.title} - {document.doc_date}] {p}" for p in pieces]
    vectors = embedder.embed(prefixed)

    for ordinal, (piece, vector) in enumerate(zip(pieces, vectors)):
        session.add(
            Chunk(
                document_id=document.id,
                patient_id=document.patient_id,
                ordinal=ordinal,
                text=piece,
                embedding=json.dumps(vector),
            )
        )
    session.commit()
    return len(pieces)


def reindex_patient(session: Session, patient_id: int) -> int:
    """Re-index every document for a patient. Returns total chunk count."""
    docs = session.exec(select(Document).where(Document.patient_id == patient_id)).all()
    total = 0
    for doc in docs:
        total += index_document(session, doc)
    return total
