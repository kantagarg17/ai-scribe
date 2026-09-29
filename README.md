# AI-Scribe

**The patient's AI scribe** - an interactive, patient-owned health record that captures each visit (with consent) and joins it with labs and scans, in plain language.

> Built by Team 19 (Matthew Willer, Einav Kotler, Kanta Garg) around the question:
> *How might we improve how conditions get diagnosed?* Focus: breast cancer, from the first lump to a confirmed diagnosis.

AI-Scribe is **fully open source** (Apache-2.0) and **vendor-neutral**. It runs entirely on your own machine with local open-source models, or against any OpenAI-compatible API endpoint. No proprietary service is required.

## Why

From 15+ interviews with patients, survivors, and clinicians, three problems stood out:

- **Too much to take in.** Patients absorb news only after leaving the visit; post-op instructions don't stick.
- **Notes patients can't use.** Portal notes are too technical. One patient read "triple-positive" alone, after hours.
- **Records are scattered.** Patients hand-carry CDs between hospitals and get re-scanned when images don't transfer.

## What it does

1. **Ambient visit notes** - with consent, records a visit, transcribes it, and writes a plain-language summary, clear next steps, and a shareable caregiver update.
2. **One patient-owned record** - joins visit notes with labs, scan reports, and discharge summaries in a single timeline the patient owns.
3. **Ask it anything** - a chat that answers questions grounded *only* in the patient's own record, with citations back to the source document (e.g. "From your Sep 22 visit").

## Architecture

```
ai-scribe/
├── backend/          FastAPI + SQLite. Pluggable AI providers.
│   └── app/
│       ├── providers/    Transcription, LLM, and embedding provider interfaces
│       ├── services/     Visit summarization, RAG, ingestion
│       ├── routers/      HTTP API
│       └── models.py     SQLModel data models
└── frontend/         React + Vite + TypeScript. Matches the product mock.
```

### Pluggable AI providers

Everything AI-related sits behind an interface so the project stays open and portable:

| Capability     | Local / open-source default        | Alternative                          |
| -------------- | ----------------------------------- | ------------------------------------ |
| Transcription  | `faster-whisper` (runs on-device)   | Any OpenAI-compatible `/audio` API   |
| LLM            | Ollama (e.g. `llama3.1`)            | Any OpenAI-compatible `/chat` API    |
| Embeddings     | `sentence-transformers` (on-device) | Any OpenAI-compatible embeddings API |

Choose the provider with environment variables - see `backend/.env.example`.

## Quick start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit to pick your providers
uvicorn app.main:app --reload --port 8000
```

Seed the demo patient ("Dana"):

```bash
python -m app.seed
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

## Privacy & safety

- The record is **patient-owned** and stored locally by default (SQLite + on-disk files).
- Ambient capture is **consent-first**: recording only starts on an explicit action.
- AI answers are **grounded and cited**: the chat only uses the patient's own documents and links back to the source.
- This is a **prototype for research and demonstration**. It is not a medical device and does not provide medical advice.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 AI-Scribe contributors.
