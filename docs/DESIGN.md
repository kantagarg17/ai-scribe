# AI-Scribe - Design Document

A build-from-scratch guide to the patient's AI scribe: an interactive, patient-owned
health record with ambient visit notes, a unified record timeline, and grounded Q&A.

This document is written so someone can **recreate the app (and website) from
zero**. It covers the product, the architecture, the design system, the data
model, the full API, the AI-provider abstraction, and a step-by-step build order.
Where a decision has a "why", it's called out, because the reasoning is the part
worth copying, not just the code.

> Context: built for Team 19's "How might we improve how conditions get diagnosed?"
> around breast cancer, from the first lump to a confirmed diagnosis. AI-Scribe is
> Idea 3 - a patient-owned record patients can actually read and ask questions of.
> It is a **research prototype, not a medical device**, and gives no medical advice.

---

## 1. Product overview

Three capabilities, each tied to something real patients told us in 15+ interviews:

| Feature | Problem it answers | What it does |
| --- | --- | --- |
| **Ambient visit notes** | "Too much to take in" - patients absorb news only after leaving | With consent, record a visit, transcribe it, and write a plain-language summary, a next-steps checklist, and a shareable caregiver update. |
| **One patient-owned record** | "Records are scattered" - CDs hand-carried between hospitals | Join visit notes, labs, scan reports, and discharge summaries into one timeline the patient owns. Swipe to delete an accidental note. |
| **Ask it anything** | "Notes patients can't use" - portal notes are too technical | A chat that answers only from the patient's own record and cites the source ("From your Sep 22 visit"). |

Design values that shape every decision:

- **Calm over clinical.** A person facing a diagnosis needs reassurance, not a dense dashboard.
- **Consent-first.** Recording only starts on an explicit tap.
- **Grounded and cited.** The AI answers only from the patient's record and links back to the source. It never invents medical facts and never gives advice.
- **Patient-owned and local by default.** Data lives in a local store; nothing is sent to a third party unless the operator opts in.
- **Open and vendor-neutral.** Every AI capability sits behind an interface, so it runs on local open-source models or any OpenAI-compatible endpoint.

---

## 2. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | **FastAPI** (Python) | Best ecosystem for the audio + ML + RAG pieces; fast to build typed APIs. |
| Storage | **SQLite** via **SQLModel** | Zero-setup, file-based, patient-owned. SQLModel = Pydantic + SQLAlchemy in one. |
| Frontend | **React 18 + Vite + TypeScript** | Fast dev server, small output, no framework lock-in. Hand-styled CSS (no UI kit) for full control of the calm aesthetic. |
| LLM | **Ollama** (e.g. `llama3.1`) *or* any OpenAI-compatible API | Local + open by default; swappable. |
| Transcription | **faster-whisper** *or* OpenAI-compatible `/audio` | On-device Whisper; swappable. |
| Embeddings | **sentence-transformers** (`all-MiniLM-L6-v2`) *or* OpenAI-compatible | On-device semantic vectors; swappable. |
| Offline demo | Built-in **mock** providers | The app runs with no models, no keys, no network - great for first run, tests, and a static demo. |

Pin note: use Python **3.13** (not 3.14 - `pydantic-core` had no 3.14 wheel at build time and tried to compile from Rust).

---

## 3. Repository layout

```
ai-scribe/
├── backend/
│   ├── requirements.txt
│   ├── .env.example              # provider selection + config
│   └── app/
│       ├── main.py               # FastAPI app + CORS + router wiring
│       ├── config.py             # env-driven settings (AISCRIBE_*)
│       ├── db.py                 # engine + session
│       ├── models.py             # Patient, Document, VisitSummary, Chunk
│       ├── schemas.py            # request/response models
│       ├── seed.py               # demo patient "Dana"
│       ├── reindex.py            # rebuild embeddings after model change
│       ├── providers/            # the AI abstraction (see §7)
│       │   ├── base.py           #   interfaces
│       │   ├── mock.py           #   offline stand-ins
│       │   ├── ollama_llm.py     #   local LLM
│       │   ├── whisper_transcribe.py
│       │   ├── st_embed.py       #   local embeddings
│       │   └── openai_compat.py  #   any OpenAI-compatible endpoint
│       ├── services/
│       │   ├── ingestion.py      # chunk + embed documents
│       │   ├── summarize.py      # transcript -> summary/next steps/caregiver
│       │   └── rag.py            # retrieve + grounded answer + citations
│       └── routers/
│           ├── patients.py
│           ├── record.py         # documents CRUD (+ delete cascade)
│           ├── visits.py         # ambient capture (audio + transcript)
│           └── chat.py           # ask-it-anything
└── frontend/
    ├── index.html                # fonts (Fraunces + Inter), viewport
    ├── vite.config.ts            # dev proxy /api + /health -> :8000
    └── src/
        ├── main.tsx
        ├── App.tsx               # app shell (stable grid) + bottom nav
        ├── api.ts                # typed client
        ├── styles.css            # the design system (tokens + components)
        ├── icons.tsx             # inline SVG icons
        ├── SwipeCard.tsx         # swipe-to-delete row
        └── screens/
            ├── Home.tsx          # record timeline
            ├── Record.tsx        # capture
            └── Ask.tsx           # chat
```

---

## 4. Data model

Four tables. The record is a single timeline of `Document` rows for one `Patient`.

```
Patient(id, name, created_at)

Document(id, patient_id -> Patient,
         kind: visit_note | lab | scan | discharge,
         title, doc_date (ISO string), content (plain text),
         source_path (optional audio/PDF on disk), created_at)

VisitSummary(id, document_id -> Document (unique),
             summary, next_steps (newline-joined), caregiver_update)

Chunk(id, document_id -> Document, patient_id -> Patient,
      ordinal, text, embedding (JSON-encoded list[float]))
```

Design notes:
- **One `Document` type for everything** (visit note, lab, scan, discharge) keeps the timeline and retrieval uniform; `kind` drives icon/label.
- **`VisitSummary` is derived**, only for visit notes. Keeping it separate from the raw transcript (`Document.content`) means the summary can be regenerated without losing the source.
- **`Chunk` stores the embedding as JSON** so SQLite stays dependency-free. For a bigger dataset, swap in a vector DB - the retrieval code is isolated in `services/rag.py`.

---

## 5. Backend API

Base path `/api`. All patient-scoped.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Status + which providers are active. |
| POST | `/api/patients` | Create a patient. |
| GET | `/api/patients` | List patients. |
| GET | `/api/patients/{id}` | Get a patient. |
| GET | `/api/patients/{id}/documents?kind=` | List record documents (newest first), optional kind filter. |
| POST | `/api/patients/{id}/documents` | Add a document (lab/scan/discharge/visit). Indexes it for chat. |
| GET | `/api/patients/{id}/documents/{doc_id}` | Get one document. |
| DELETE | `/api/patients/{id}/documents/{doc_id}` | **Delete a record** + its summary + its chunks (cascade). Returns 204. |
| POST | `/api/patients/{id}/visits/record` | Upload consented **audio** -> transcribe -> summarize -> store. |
| POST | `/api/patients/{id}/visits/transcript` | Submit a raw **transcript** (no audio) -> summarize -> store. |
| GET | `/api/patients/{id}/visits` | List visits that have a plain-language summary. |
| POST | `/api/patients/{id}/chat` | Ask a question; returns a grounded answer + source documents. |

Gotcha worth copying: a FastAPI `DELETE` returning **204** must return an explicit
`Response(status_code=204)` - annotating `-> None` trips a "status code 204 must
not have a response body" assertion.

---

## 6. Core flows

### Ambient visit notes
1. Client records audio (browser `MediaRecorder`) or submits a typed transcript.
2. Audio -> transcription provider -> transcript text.
3. Transcript -> LLM with a strict-JSON prompt -> `{summary, next_steps[], caregiver_update}`.
   - Parse defensively (strip code fences, grab the outer `{...}`); on failure, keep the raw text as the summary so nothing is lost.
   - System prompt pins a 6th-grade reading level, "define medical terms in parentheses", and "never invent facts or give new advice".
4. Store a `visit_note` `Document` + a `VisitSummary`, then index for chat.

### Grounded Q&A (RAG)
1. Embed the question; cosine-similarity against the patient's `Chunk` rows; take top-k (5).
2. Build a context block of the top chunks, each tagged with its source doc + date.
3. LLM answers using **only** those excerpts; return the answer plus the unique source documents (most-relevant first) so the UI can show "From your {title} · {date}" chips.
4. If there are no chunks, decline gracefully ("I don't see that in your record…").

### Ingestion / indexing
- Split document text into ~700-char overlapping windows on sentence boundaries.
- Prefix each chunk with `[title - date]` before embedding so retrieval has context.
- Re-index is idempotent (delete existing chunks first). After changing the embedding model, run `python -m app.reindex` (vectors from different models aren't comparable).

---

## 7. The AI-provider abstraction (the key idea to copy)

Everything AI sits behind three small interfaces (`providers/base.py`):

```python
class LLMProvider:            def chat(messages, temperature) -> str
class TranscriptionProvider:  def transcribe(audio_path) -> str
class EmbeddingProvider:      def embed(texts) -> list[list[float]]; embed_one(text)
```

A factory picks the concrete class from config at runtime:

```
AISCRIBE_LLM_PROVIDER        = mock | ollama | openai
AISCRIBE_TRANSCRIBE_PROVIDER = mock | faster_whisper | openai
AISCRIBE_EMBED_PROVIDER      = mock | sentence_transformers | openai
```

Why this matters:
- **Open + portable.** Local open models by default; any OpenAI-compatible endpoint by config; no proprietary SDK.
- **Runnable out of the box.** The `mock` providers need no models/keys/network - deterministic, extractive stand-ins so every screen works on first clone and in tests.
- **Lazy imports.** `faster-whisper` / `sentence-transformers` are imported only when selected, so the app starts without them installed.

---

## 8. Design system (calm, meditation-inspired)

References: meditation/wellness apps (soft surfaces, gradients, whitespace, breathing motion) and clean schedule apps (date-grouped timeline rows). Keeps the team deck's plum + coral identity, softened, with a sage accent.

### Tokens (CSS custom properties in `frontend/src/styles.css`)

```
Canvas      --paper #f6f4ef   --paper-2 #efeae2   --card #fffefb
Ink         --ink #2c2033     --ink-2 #6a5c6e     --ink-3 #9b8f9e
Brand       --plum #3a2742    --coral #e8927c      --coral-deep #d9765e
Calm accent --sage #7fa68c    --sage-tint #e6efe7
Lines       --line #ece5db    --line-2 #e2d9cd     --good #6fae87
Gradients   --grad-hero (coral->sage), --grad-calm, --grad-mic (radial coral)
Radius      --r-lg 26  --r-md 20  --r-sm 14
Type        --serif "Fraunces" (headings)  --sans "Inter" (body)
```

Typography: **Fraunces** serif for greetings/titles (warm, editorial), **Inter** for body. Load both from Google Fonts in `index.html`.

### The app shell (why proportions never jump)
The frame is a **CSS Grid** with three fixed rows: `header / main / footer`
(`grid-template-rows: var(--header-h) 1fr var(--footer-h)`). The grid tracks never
change size, so switching tabs, scrolling, or resizing can't reflow the shell.
Only a single inner `.scroll` element scrolls (`flex:1; min-height:0; overflow-y:auto`).
The `min-height:0` is the critical bit that lets a flex/grid child scroll instead
of growing its parent.

Responsive: full-bleed `100dvh` on mobile; on `min-width: 600px` it becomes a
centered, phone-proportioned card (`min(936px, 100dvh - 56px)`) on a soft backdrop.
`dvh` (not `vh`) so the mobile address bar showing/hiding doesn't resize the frame.

### Signature components
- **Timeline**: entries grouped under day labels ("Wed, Sep 10, 2025"), each a soft card led by a color-coded kind tile (visit=sage, lab=purple, scan=coral, discharge=gold).
- **Hero**: the latest visit summary in a gradient card with a next-steps checklist.
- **Capture**: a large gradient mic with concentric **breathing rings** while recording; consent copy; a type/paste fallback.
- **Ask**: soft chat bubbles, sage source chips, dotted suggestion rows, a docked composer above the nav.
- **Swipe-to-delete**: left-swipe a timeline row (pointer events, touch + mouse) to reveal Delete; **confirm before deleting** ("Sure?"); optimistic removal with reload-on-failure rollback. Confirm-first is deliberate - losing a health record by accident is worse than a little friction.

---

## 9. Build order (from scratch)

1. **Backend skeleton**: FastAPI app, `config.py` (env `AISCRIBE_*`), SQLite via SQLModel, `/health`.
2. **Data model + patients/record routers**: `Patient`, `Document`; list/add/get/delete documents.
3. **Provider interfaces + mock providers**: build `mock` first so everything is testable offline.
4. **Ingestion + RAG + chat**: chunk/embed, cosine retrieval, grounded answer with citations.
5. **Visits**: transcript endpoint first (no audio needed), then audio upload.
6. **Real providers**: Ollama, faster-whisper, sentence-transformers; add `reindex`.
7. **Seed data**: demo patient "Dana" (ultrasound, biopsy, discharge, visit).
8. **Frontend shell**: the fixed grid + bottom nav + typed API client.
9. **Screens**: Home timeline, Capture, Ask.
10. **Design pass**: tokens, gradients, breathing mic, swipe-to-delete.
11. **Tests**: pytest over the mock providers (docs CRUD, summarize, grounded chat, delete cascade).

Run locally:

```bash
# backend
cd backend && python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # default = offline mock mode; edit for real models
python -m app.seed
uvicorn app.main:app --port 8000

# frontend (new terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Real local models (optional): `brew install ollama && ollama serve && ollama pull llama3.1`,
`pip install faster-whisper sentence-transformers`, set the three `AISCRIBE_*_PROVIDER`
vars, then `python -m app.reindex`.

---

## 10. Making it a shareable website

The app depends on models that run on the operator's machine, so hosting needs one of:

- **Static demo (free, permanent, no secrets)** - build the frontend and host on
  GitHub Pages, backed by a bundled "demo mode" data layer (seeded record + canned
  answers). Every screen works from a link; no live LLM. Best for classmates.
- **Full hosted app (real AI, needs a host + a model API key)** - deploy FastAPI +
  frontend to Render/Railway/Fly and point the LLM at a hosted OpenAI-compatible
  endpoint (e.g. Groq's free Llama tier). Real inference, but an always-on server,
  a key to manage, and quota/cost.

Avoid rebuilding the UI in Streamlit: it would discard the mobile design, the app
shell, and swipe-to-delete, and still can't run a multi-GB local LLM on a free tier.

---

## 11. Safety & scope

- Not a medical device; no medical advice. The chat is instructed to defer to the care team and never invent facts.
- Consent-first capture; patient-owned local storage; grounded, cited answers.
- Treat any hosted deployment's data as sensitive; don't commit real patient data or `.env` secrets (both are gitignored).

---

## 12. License

Apache-2.0. Copyright 2026 AI-Scribe contributors.
