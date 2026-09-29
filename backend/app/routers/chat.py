"""Ask-it-anything: grounded Q&A over the patient's own record."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Patient
from ..schemas import ChatRequest, ChatResponse, SourceOut
from ..services.rag import answer_question

router = APIRouter(prefix="/api/patients/{patient_id}/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def ask(
    patient_id: int,
    body: ChatRequest,
    session: Session = Depends(get_session),
) -> ChatResponse:
    if not session.get(Patient, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is required")

    result = answer_question(session, patient_id, question)
    return ChatResponse(
        answer=result["answer"],
        sources=[SourceOut(**s) for s in result["sources"]],
    )
