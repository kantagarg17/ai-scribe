"""Rebuild all chunk embeddings for every patient.

Run this after changing the embedding provider/model, since vectors from
different models are not comparable. Usage:

    python -m app.reindex
"""
from __future__ import annotations

from sqlmodel import Session, select

from .db import get_engine, init_db
from .models import Patient
from .services.ingestion import reindex_patient


def main() -> None:
    init_db()
    with Session(get_engine()) as session:
        patients = session.exec(select(Patient)).all()
        if not patients:
            print("No patients to re-index.")
            return
        for patient in patients:
            count = reindex_patient(session, patient.id)
            print(f"Re-indexed patient {patient.name!r} (id={patient.id}): {count} chunks.")


if __name__ == "__main__":
    main()
