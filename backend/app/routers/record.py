"""The unified patient record: list and add documents (labs, scans, discharge,
visit notes) and read the full timeline.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session, delete, select

from ..db import get_session
from ..models import Chunk, Document, DocumentKind, Patient, VisitSummary
from ..schemas import DocumentCreate, DocumentOut
from ..services.ingestion import index_document

router = APIRouter(prefix="/api/patients/{patient_id}/documents", tags=["record"])


def _to_out(doc: Document) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        kind=doc.kind,
        title=doc.title,
        doc_date=doc.doc_date,
        content=doc.content,
        created_at=doc.created_at.isoformat(),
    )


@router.get("", response_model=list[DocumentOut])
def list_documents(
    patient_id: int,
    kind: DocumentKind | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[DocumentOut]:
    stmt = select(Document).where(Document.patient_id == patient_id)
    if kind is not None:
        stmt = stmt.where(Document.kind == kind)
    docs = session.exec(stmt).all()
    # Newest first by document date, then creation time.
    docs.sort(key=lambda d: (d.doc_date, d.created_at.isoformat()), reverse=True)
    return [_to_out(d) for d in docs]


@router.post("", response_model=DocumentOut)
def add_document(
    patient_id: int,
    body: DocumentCreate,
    session: Session = Depends(get_session),
) -> DocumentOut:
    if not session.get(Patient, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    doc = Document(
        patient_id=patient_id,
        kind=body.kind,
        title=body.title.strip(),
        doc_date=body.doc_date.strip(),
        content=body.content.strip(),
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    # Make it retrievable for grounded chat immediately.
    index_document(session, doc)
    return _to_out(doc)


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    patient_id: int,
    document_id: int,
    session: Session = Depends(get_session),
) -> DocumentOut:
    doc = session.get(Document, document_id)
    if not doc or doc.patient_id != patient_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return _to_out(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    patient_id: int,
    document_id: int,
    session: Session = Depends(get_session),
) -> Response:
    """Delete a record and everything derived from it.

    Removes the document plus any visit summary and all retrieval chunks, so a
    note captured by accident leaves nothing behind in the patient's record or
    in grounded chat.
    """
    doc = session.get(Document, document_id)
    if not doc or doc.patient_id != patient_id:
        raise HTTPException(status_code=404, detail="Document not found")

    session.exec(delete(Chunk).where(Chunk.document_id == document_id))
    session.exec(delete(VisitSummary).where(VisitSummary.document_id == document_id))
    session.delete(doc)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
