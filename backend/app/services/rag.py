"""Grounded 'ask it anything' over the patient's own record.

Retrieves the most relevant chunks by cosine similarity, then asks the LLM to
answer using ONLY those chunks and to cite the source documents. Returns the
answer plus the source documents so the UI can show a citation chip like
"From your Sep 22 visit".
"""
from __future__ import annotations

import json

import numpy as np
from sqlmodel import Session, select

from ..models import Chunk, Document
from ..providers import get_embedding_provider, get_llm_provider

_TOP_K = 5

_SYSTEM = (
    "You are AI-Scribe. You answer a patient's questions using ONLY the "
    "excerpts from their own health record provided below. Write in plain, "
    "warm language at a 6th-grade reading level. "
    "If the answer is not in the excerpts, say you don't see that in their "
    "record and suggest they ask their care team. Never invent medical facts. "
    "When you use information from an excerpt, refer to where it came from "
    "(for example, 'from your Sep 22 visit'). This is not medical advice."
)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) or 1.0
    return float(np.dot(a, b) / denom)


def retrieve(session: Session, patient_id: int, query: str, top_k: int = _TOP_K):
    """Return a list of (Chunk, score) sorted by relevance."""
    chunks = session.exec(select(Chunk).where(Chunk.patient_id == patient_id)).all()
    if not chunks:
        return []

    embedder = get_embedding_provider()
    q_vec = np.array(embedder.embed_one(query), dtype=np.float32)

    scored = []
    for chunk in chunks:
        vec = np.array(json.loads(chunk.embedding), dtype=np.float32)
        scored.append((chunk, _cosine(q_vec, vec)))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top_k]


def answer_question(session: Session, patient_id: int, question: str) -> dict:
    """Return {"answer", "sources": [{document_id, title, kind, doc_date}]}."""
    top = retrieve(session, patient_id, question)
    if not top:
        return {
            "answer": (
                "I don't see anything in your record yet to answer that. "
                "Once your visits, labs, and scans are added, I can help."
            ),
            "sources": [],
        }

    # Build the grounding context and collect unique source documents.
    doc_ids = list({chunk.document_id for chunk, _ in top})
    docs = session.exec(select(Document).where(Document.id.in_(doc_ids))).all()
    doc_by_id = {d.id: d for d in docs}

    context_blocks = []
    for chunk, _score in top:
        doc = doc_by_id.get(chunk.document_id)
        label = f"{doc.title} ({doc.doc_date})" if doc else "record"
        context_blocks.append(f"[Source: {label}]\n{chunk.text}")
    context = "\n\n".join(context_blocks)

    llm = get_llm_provider()
    messages = [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                f"Excerpts from your record:\n\n{context}\n\n"
                f"Question: {question}"
            ),
        },
    ]
    answer = llm.chat(messages, temperature=0.2).strip()

    # Preserve retrieval order for sources (most relevant first).
    seen: set[int] = set()
    sources = []
    for chunk, _score in top:
        doc = doc_by_id.get(chunk.document_id)
        if doc and doc.id not in seen:
            seen.add(doc.id)
            sources.append(
                {
                    "document_id": doc.id,
                    "title": doc.title,
                    "kind": doc.kind.value,
                    "doc_date": doc.doc_date,
                }
            )

    return {"answer": answer, "sources": sources}
