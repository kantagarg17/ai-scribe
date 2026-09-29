"""Ambient visit notes.

Consent-first capture: the client records a visit and uploads the audio (or a
raw transcript when audio isn't available). We transcribe, write a
plain-language summary + next steps + caregiver update, store it as a visit
note document, and index it for grounded chat.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..models import Document, DocumentKind, Patient, VisitSummary
from ..providers import get_transcription_provider
from ..schemas import VisitSummaryOut
from ..services.ingestion import index_document
from ..services.summarize import summarize_transcript

router = APIRouter(prefix="/api/patients/{patient_id}/visits", tags=["visits"])


def _persist_visit(
    session: Session,
    patient_id: int,
    transcript: str,
    title: str,
    doc_date: str,
    source_path: str | None,
) -> VisitSummaryOut:
    result = summarize_transcript(transcript)

    doc = Document(
        patient_id=patient_id,
        kind=DocumentKind.VISIT_NOTE,
        title=title,
        doc_date=doc_date,
        content=transcript,
        source_path=source_path,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    summary = VisitSummary(
        document_id=doc.id,
        summary=result["summary"],
        next_steps="\n".join(result["next_steps"]),
        caregiver_update=result["caregiver_update"],
    )
    session.add(summary)
    session.commit()

    index_document(session, doc)

    return VisitSummaryOut(
        document_id=doc.id,
        title=doc.title,
        doc_date=doc.doc_date,
        summary=result["summary"],
        next_steps=result["next_steps"],
        caregiver_update=result["caregiver_update"],
    )


@router.post("/record", response_model=VisitSummaryOut)
async def record_visit(
    patient_id: int,
    audio: UploadFile,
    title: str = Form("Clinic visit"),
    doc_date: str = Form(...),
    session: Session = Depends(get_session),
) -> VisitSummaryOut:
    """Upload consented visit audio; get back a plain-language visit summary."""
    if not session.get(Patient, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")

    settings = get_settings()
    suffix = Path(audio.filename or "audio").suffix or ".wav"
    dest = settings.uploads_dir / f"{uuid.uuid4().hex}{suffix}"
    dest.write_bytes(await audio.read())

    transcriber = get_transcription_provider()
    try:
        transcript = transcriber.transcribe(str(dest))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not transcript.strip():
        raise HTTPException(status_code=422, detail="Could not transcribe audio.")

    return _persist_visit(session, patient_id, transcript, title, doc_date, str(dest))


@router.post("/transcript", response_model=VisitSummaryOut)
def record_visit_transcript(
    patient_id: int,
    body: dict,
    session: Session = Depends(get_session),
) -> VisitSummaryOut:
    """Submit a raw transcript directly (no audio) and get a visit summary.

    Useful for demos and for clients that transcribe on-device.
    """
    if not session.get(Patient, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")

    transcript = str(body.get("transcript", "")).strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="transcript is required")
    title = str(body.get("title", "Clinic visit")).strip() or "Clinic visit"
    doc_date = str(body.get("doc_date", "")).strip()
    if not doc_date:
        raise HTTPException(status_code=422, detail="doc_date is required")

    return _persist_visit(session, patient_id, transcript, title, doc_date, None)


@router.get("", response_model=list[VisitSummaryOut])
def list_visits(
    patient_id: int,
    session: Session = Depends(get_session),
) -> list[VisitSummaryOut]:
    """List every visit that has a plain-language summary, newest first."""
    docs = session.exec(
        select(Document).where(
            Document.patient_id == patient_id,
            Document.kind == DocumentKind.VISIT_NOTE,
        )
    ).all()
    docs.sort(key=lambda d: (d.doc_date, d.created_at.isoformat()), reverse=True)

    out: list[VisitSummaryOut] = []
    for doc in docs:
        summary = session.exec(
            select(VisitSummary).where(VisitSummary.document_id == doc.id)
        ).first()
        if not summary:
            continue
        out.append(
            VisitSummaryOut(
                document_id=doc.id,
                title=doc.title,
                doc_date=doc.doc_date,
                summary=summary.summary,
                next_steps=[s for s in summary.next_steps.split("\n") if s.strip()],
                caregiver_update=summary.caregiver_update,
            )
        )
    return out
