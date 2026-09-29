"""Pydantic request/response schemas for the API."""
from __future__ import annotations

from pydantic import BaseModel

from .models import DocumentKind


class PatientCreate(BaseModel):
    name: str


class PatientOut(BaseModel):
    id: int
    name: str


class DocumentCreate(BaseModel):
    kind: DocumentKind
    title: str
    doc_date: str
    content: str


class DocumentOut(BaseModel):
    id: int
    kind: DocumentKind
    title: str
    doc_date: str
    content: str
    created_at: str


class VisitSummaryOut(BaseModel):
    document_id: int
    title: str
    doc_date: str
    summary: str
    next_steps: list[str]
    caregiver_update: str


class ChatRequest(BaseModel):
    question: str


class SourceOut(BaseModel):
    document_id: int
    title: str
    kind: str
    doc_date: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceOut]
