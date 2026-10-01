// Typed client for the AI-Scribe backend.

export type DocumentKind = "visit_note" | "lab" | "scan" | "discharge";

export interface Patient {
  id: number;
  name: string;
}

export interface DocumentItem {
  id: number;
  kind: DocumentKind;
  title: string;
  doc_date: string;
  content: string;
  created_at: string;
}

export interface VisitSummary {
  document_id: number;
  title: string;
  doc_date: string;
  summary: string;
  next_steps: string[];
  caregiver_update: string;
}

export interface Source {
  document_id: number;
  title: string;
  kind: string;
  doc_date: string;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export interface AiScribeApi {
  listPatients(): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient>;
  listDocuments(patientId: number, kind?: DocumentKind): Promise<DocumentItem[]>;
  listVisits(patientId: number): Promise<VisitSummary[]>;
  deleteDocument(patientId: number, documentId: number): Promise<void>;
  recordTranscript(
    patientId: number,
    payload: { transcript: string; title?: string; doc_date: string }
  ): Promise<VisitSummary>;
  recordAudio(
    patientId: number,
    audio: Blob,
    meta: { title?: string; doc_date: string; filename?: string }
  ): Promise<VisitSummary>;
  ask(patientId: number, question: string): Promise<ChatResponse>;
}

// Absolute backend origin for the hosted build (e.g. the Render URL), set via
// VITE_API_BASE at build time. Empty by default so local dev uses relative
// paths through the Vite proxy. Trailing slash is trimmed.
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const u = (path: string) => `${API_BASE}${path}`;

const liveApi: AiScribeApi = {
  async listPatients(): Promise<Patient[]> {
    return json(await fetch(u("/api/patients")));
  },

  async getPatient(id: number): Promise<Patient> {
    return json(await fetch(u(`/api/patients/${id}`)));
  },

  async listDocuments(patientId: number, kind?: DocumentKind): Promise<DocumentItem[]> {
    const q = kind ? `?kind=${kind}` : "";
    return json(await fetch(u(`/api/patients/${patientId}/documents${q}`)));
  },

  async listVisits(patientId: number): Promise<VisitSummary[]> {
    return json(await fetch(u(`/api/patients/${patientId}/visits`)));
  },

  async deleteDocument(patientId: number, documentId: number): Promise<void> {
    const res = await fetch(u(`/api/patients/${patientId}/documents/${documentId}`), {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to delete (${res.status})`);
    }
  },

  async recordTranscript(
    patientId: number,
    payload: { transcript: string; title?: string; doc_date: string }
  ): Promise<VisitSummary> {
    return json(
      await fetch(u(`/api/patients/${patientId}/visits/transcript`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async recordAudio(
    patientId: number,
    audio: Blob,
    meta: { title?: string; doc_date: string; filename?: string }
  ): Promise<VisitSummary> {
    const form = new FormData();
    form.append("audio", audio, meta.filename || "visit.webm");
    if (meta.title) form.append("title", meta.title);
    form.append("doc_date", meta.doc_date);
    return json(
      await fetch(u(`/api/patients/${patientId}/visits/record`), {
        method: "POST",
        body: form,
      })
    );
  },

  async ask(patientId: number, question: string): Promise<ChatResponse> {
    return json(
      await fetch(u(`/api/patients/${patientId}/chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })
    );
  },
};

// In the static demo there is no backend, so use the bundled demo adapter.
// Hosted (Netlify Function) and local dev use the live HTTP API.
import { demoApi, IS_DEMO } from "./demo";

const base: AiScribeApi = IS_DEMO ? demoApi : liveApi;

// ---------------------------------------------------------------------------
// Response cache — makes AI feel seamless.
//
// Chat answers are deterministic enough to reuse: the same question on the
// same record returns the same answer, so we memoize by normalized question
// and persist to localStorage. Repeat questions (and the suggested prompts,
// which we prime on load) return instantly instead of waiting on the model.
// ---------------------------------------------------------------------------
const CACHE_KEY = "aiscribe.chat.v1";

function loadCache(): Record<string, ChatResponse> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCache(c: Record<string, ChatResponse>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or unavailable — ignore, cache stays in-memory */
  }
}

const chatCache: Record<string, ChatResponse> = loadCache();
const inflight = new Map<string, Promise<ChatResponse>>();
const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

const cachedApi: AiScribeApi = {
  ...base,
  async ask(patientId: number, question: string): Promise<ChatResponse> {
    const key = norm(question);
    const hit = chatCache[key];
    if (hit) return hit;
    // De-dupe concurrent identical asks (e.g. priming + a fast click).
    const pending = inflight.get(key);
    if (pending) return pending;

    const p = base
      .ask(patientId, question)
      .then((res) => {
        chatCache[key] = res;
        saveCache(chatCache);
        inflight.delete(key);
        return res;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, p);
    return p;
  },
};

export const api: AiScribeApi = cachedApi;

/** Warm the cache for a set of questions in the background (fire-and-forget). */
export function primeChat(patientId: number, questions: string[]): void {
  for (const q of questions) {
    const key = norm(q);
    if (!chatCache[key] && !inflight.get(key)) {
      // Ignore errors while priming; a real ask will surface them.
      api.ask(patientId, q).catch(() => {});
    }
  }
}
