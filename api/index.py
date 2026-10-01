"""AI-Scribe serverless backend (Vercel).

A stateless FastAPI app that serves the record demo with REAL AI via Groq
(OpenAI-compatible): grounded chat and visit summaries from an open LLM, plus
Whisper transcription. Vercel functions are ephemeral and the filesystem is
read-only, so there is no database: the seeded record lives in memory and
retrieval is computed per request. Create/delete are reflected optimistically
by the frontend (not persisted server-side) — fine for a shared demo.

Env (set in the Vercel dashboard):
  GROQ_API_KEY          required — https://console.groq.com/keys
  GROQ_BASE_URL         default https://api.groq.com/openai/v1
  AISCRIBE_LLM_MODEL    default openai/gpt-oss-20b
  AISCRIBE_TRANSCRIBE_MODEL  default whisper-large-v3
  AISCRIBE_CORS_ORIGINS comma-separated allowed origins (default *)
"""
from __future__ import annotations

import hashlib
import math
import os
import re

import httpx
from fastapi import FastAPI, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_MODEL = os.environ.get("AISCRIBE_LLM_MODEL", "openai/gpt-oss-20b")
TRANSCRIBE_MODEL = os.environ.get("AISCRIBE_TRANSCRIBE_MODEL", "whisper-large-v3")
CORS = os.environ.get("AISCRIBE_CORS_ORIGINS", "*")
_TIMEOUT = httpx.Timeout(60.0)

# --------------------------------------------------------------------------
# Seed record (mirrors backend/app/seed.py — the demo patient "Dana")
# --------------------------------------------------------------------------
PATIENT = {"id": 1, "name": "Dana"}

DOCUMENTS = [
    {
        "id": 1,
        "kind": "scan",
        "title": "Right breast ultrasound",
        "doc_date": "2025-09-10",
        "created_at": "2025-09-10T00:00:00Z",
        "content": (
            "Breast Ultrasound Report. There is a 1.8 cm irregular hypoechoic mass at the 10 o'clock "
            "position of the right breast, approximately 4 cm from the nipple. Margins are indistinct. "
            "No axillary lymph node enlargement is seen. ASSESSMENT: BI-RADS 4 - suspicious abnormality. "
            "Biopsy recommended. BI-RADS is a standard score radiologists use; a 4 means the finding "
            "looks suspicious enough that a biopsy is recommended to be sure."
        ),
    },
    {
        "id": 2,
        "kind": "lab",
        "title": "Biopsy pathology",
        "doc_date": "2025-09-15",
        "created_at": "2025-09-15T00:00:00Z",
        "content": (
            "Pathology Report - Core Needle Biopsy, Right Breast. DIAGNOSIS: Invasive ductal carcinoma, "
            "grade 2. Estrogen receptor (ER): POSITIVE (95%). Progesterone receptor (PR): POSITIVE (80%). "
            "HER2: NEGATIVE. Interpretation: Hormone-receptor-positive, HER2-negative invasive breast "
            "cancer. This subtype typically responds well to hormone (endocrine) therapy."
        ),
    },
    {
        "id": 3,
        "kind": "discharge",
        "title": "After-visit summary",
        "doc_date": "2025-09-22",
        "created_at": "2025-09-22T00:00:00Z",
        "content": (
            "After-Visit Summary. Diagnosis of early-stage (stage II), ER+/PR+, HER2- invasive breast "
            "cancer was discussed. Your next steps: 1. Call the breast surgery office this week to "
            "schedule a consultation. 2. A medical oncology follow-up will be scheduled to plan "
            "treatment after surgery. 3. Call the oncology line immediately for any fever of 100.4 F or "
            "higher. Consider bringing a family member to future appointments."
        ),
    },
    {
        "id": 4,
        "kind": "visit_note",
        "title": "Oncology visit with Dr. Mauro",
        "doc_date": "2025-09-22",
        "created_at": "2025-09-22T00:00:01Z",
        "content": (
            "Dr. Mauro: Your ultrasound and the biopsy came back, and it does show a breast cancer. The "
            "good news is we caught it at an early stage, stage two. The tumor is ER positive and PR "
            "positive, and HER2 negative - it is driven by hormones, which we have very good treatments "
            "for. The next step is to meet with the surgeon; call the surgery office this week to "
            "schedule. Watch for any fever over 100.4 degrees and call the oncology line right away. It "
            "helps to bring someone with you to the next appointments."
        ),
    },
]

VISIT_SUMMARIES = {
    4: {
        "document_id": 4,
        "title": "Oncology visit with Dr. Mauro",
        "doc_date": "2025-09-22",
        "summary": (
            "This visit confirmed an early-stage (stage two) breast cancer. It is hormone-driven "
            "(ER positive and PR positive) and HER2 negative, which means it responds well to hormone "
            "(endocrine) treatments. The next step is to meet with a surgeon."
        ),
        "next_steps": [
            "Call the breast surgery office this week to schedule a consultation",
            "Watch for any fever over 100.4\u00b0F and call the oncology line right away",
            "Bring a family member to the next appointment",
        ],
        "caregiver_update": (
            "Dana's results confirmed an early-stage, hormone-driven breast cancer that responds well "
            "to treatment. The next step is meeting a surgeon. You can help by keeping track of "
            "appointments and coming along to take notes."
        ),
    }
}

# --------------------------------------------------------------------------
# Lightweight in-memory retrieval (hashing embeddings; no heavy deps)
# --------------------------------------------------------------------------
_DIM = 256


def _embed(text: str) -> list[float]:
    vec = [0.0] * _DIM
    for tok in re.findall(r"[a-z0-9]+", text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % _DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _chunks(text: str, size: int = 500) -> list[str]:
    units = re.split(r"(?<=[.!?])\s+", text.strip())
    out, cur = [], ""
    for u in units:
        if len(cur) + len(u) <= size:
            cur = f"{cur} {u}".strip()
        else:
            if cur:
                out.append(cur)
            cur = u
    if cur:
        out.append(cur)
    return out or [text]


def _retrieve(question: str, docs: list[dict], k: int = 4):
    qv = _embed(question)
    scored = []
    for d in docs:
        for ch in _chunks(d["content"]):
            scored.append((d, ch, _cosine(qv, _embed(f"{d['title']} {ch}"))))
    scored.sort(key=lambda t: t[2], reverse=True)
    return [(d, ch) for d, ch, s in scored[:k] if s > 0]


# --------------------------------------------------------------------------
# Groq (OpenAI-compatible) calls
# --------------------------------------------------------------------------
def _groq_chat(messages: list[dict], temperature: float = 0.2) -> str:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Server is missing GROQ_API_KEY.")
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            f"{GROQ_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={"model": LLM_MODEL, "messages": messages, "temperature": temperature},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"LLM error: {resp.text[:200]}")
    return resp.json()["choices"][0]["message"]["content"]


def _groq_transcribe(filename: str, data: bytes) -> str:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Server is missing GROQ_API_KEY.")
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            f"{GROQ_BASE_URL}/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            data={"model": TRANSCRIBE_MODEL},
            files={"file": (filename or "audio.webm", data)},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Transcription error: {resp.text[:200]}")
    return resp.json().get("text", "")


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------
app = FastAPI(title="AI-Scribe (serverless)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS.split(",")] if CORS != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatIn(BaseModel):
    question: str


class TranscriptIn(BaseModel):
    transcript: str
    title: str | None = "Clinic visit"
    doc_date: str


@app.get("/health")
def health():
    return {"status": "ok", "llm": LLM_MODEL, "has_key": bool(GROQ_API_KEY)}


@app.get("/api/patients")
def list_patients():
    return [PATIENT]


@app.get("/api/patients/{pid}")
def get_patient(pid: int):
    return PATIENT


@app.get("/api/patients/{pid}/documents")
def list_documents(pid: int, kind: str | None = None):
    docs = [d for d in DOCUMENTS if not kind or d["kind"] == kind]
    return sorted(docs, key=lambda d: (d["doc_date"], d["created_at"]), reverse=True)


@app.get("/api/patients/{pid}/visits")
def list_visits(pid: int):
    out = [VISIT_SUMMARIES[d["id"]] for d in DOCUMENTS if d["kind"] == "visit_note" and d["id"] in VISIT_SUMMARIES]
    return sorted(out, key=lambda v: v["doc_date"], reverse=True)


@app.delete("/api/patients/{pid}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(pid: int, doc_id: int):
    # Stateless: the frontend removes it optimistically; nothing to persist.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/patients/{pid}/chat")
def chat(pid: int, body: ChatIn):
    q = body.question.strip()
    if not q:
        raise HTTPException(status_code=422, detail="question is required")
    hits = _retrieve(q, DOCUMENTS)
    if not hits:
        return {
            "answer": "I don't see anything about that in your record. Please ask your care team.",
            "sources": [],
        }
    context = "\n\n".join(f"[Source: {d['title']} ({d['doc_date']})]\n{ch}" for d, ch in hits)
    system = (
        "You are AI-Scribe. Answer the patient's question using ONLY the excerpts from their own "
        "health record below. Write in plain, warm language at a 6th-grade reading level. If the "
        "answer is not in the excerpts, say you don't see it in their record and suggest they ask "
        "their care team. Never invent medical facts. Refer to where information came from (for "
        "example, 'from your Sep 22 visit'). This is not medical advice."
    )
    answer = _groq_chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Excerpts from your record:\n\n{context}\n\nQuestion: {q}"},
        ]
    )
    seen, sources = set(), []
    for d, _ in hits:
        if d["id"] not in seen:
            seen.add(d["id"])
            sources.append(
                {"document_id": d["id"], "title": d["title"], "kind": d["kind"], "doc_date": d["doc_date"]}
            )
    return {"answer": answer.strip(), "sources": sources}


def _summarize(transcript: str, title: str, doc_date: str) -> dict:
    system = (
        "You are AI-Scribe, a careful medical scribe writing for a patient at a 6th-grade reading "
        "level. Turn the visit transcript into plain language. Never invent facts and give no new "
        "medical advice beyond what was said."
    )
    instr = (
        'Return ONLY a JSON object with keys "summary" (3-6 plain sentences), "next_steps" (array of '
        'short action strings), and "caregiver_update" (2-4 sentences for a family member).\n\n'
        f"TRANSCRIPT:\n{transcript}"
    )
    raw = _groq_chat([{"role": "system", "content": system}, {"role": "user", "content": instr}])
    import json as _json

    text = raw.strip()
    if "```" in text:
        text = re.sub(r"```[a-z]*", "", text).strip("`").strip()
    s, e = text.find("{"), text.rfind("}")
    try:
        data = _json.loads(text[s : e + 1])
        steps = data.get("next_steps", [])
        if isinstance(steps, str):
            steps = [x.strip("-* ").strip() for x in steps.splitlines() if x.strip()]
        return {
            "summary": str(data.get("summary", "")).strip() or raw.strip(),
            "next_steps": [str(x).strip() for x in steps if str(x).strip()],
            "caregiver_update": str(data.get("caregiver_update", "")).strip(),
        }
    except Exception:
        return {"summary": raw.strip(), "next_steps": [], "caregiver_update": ""}


@app.post("/api/patients/{pid}/visits/transcript")
def record_transcript(pid: int, body: TranscriptIn):
    t = body.transcript.strip()
    if not t:
        raise HTTPException(status_code=422, detail="transcript is required")
    r = _summarize(t, body.title or "Clinic visit", body.doc_date)
    return {
        "document_id": 9000,
        "title": body.title or "Clinic visit",
        "doc_date": body.doc_date,
        **r,
    }


@app.post("/api/patients/{pid}/visits/record")
async def record_audio(pid: int, audio: UploadFile, doc_date: str = "", title: str = "Clinic visit"):
    data = await audio.read()
    transcript = _groq_transcribe(audio.filename or "audio.webm", data)
    if not transcript.strip():
        raise HTTPException(status_code=422, detail="Could not transcribe audio.")
    r = _summarize(transcript, title, doc_date)
    return {"document_id": 9001, "title": title, "doc_date": doc_date, **r}
