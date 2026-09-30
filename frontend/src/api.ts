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
    meta: { title?: string; doc_date: string }
  ): Promise<VisitSummary>;
  ask(patientId: number, question: string): Promise<ChatResponse>;
}

const liveApi: AiScribeApi = {
  async listPatients(): Promise<Patient[]> {
    return json(await fetch("/api/patients"));
  },

  async getPatient(id: number): Promise<Patient> {
    return json(await fetch(`/api/patients/${id}`));
  },

  async listDocuments(patientId: number, kind?: DocumentKind): Promise<DocumentItem[]> {
    const q = kind ? `?kind=${kind}` : "";
    return json(await fetch(`/api/patients/${patientId}/documents${q}`));
  },

  async listVisits(patientId: number): Promise<VisitSummary[]> {
    return json(await fetch(`/api/patients/${patientId}/visits`));
  },

  async deleteDocument(patientId: number, documentId: number): Promise<void> {
    const res = await fetch(`/api/patients/${patientId}/documents/${documentId}`, {
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
      await fetch(`/api/patients/${patientId}/visits/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async recordAudio(
    patientId: number,
    audio: Blob,
    meta: { title?: string; doc_date: string }
  ): Promise<VisitSummary> {
    const form = new FormData();
    form.append("audio", audio, "visit.webm");
    if (meta.title) form.append("title", meta.title);
    form.append("doc_date", meta.doc_date);
    return json(
      await fetch(`/api/patients/${patientId}/visits/record`, {
        method: "POST",
        body: form,
      })
    );
  },

  async ask(patientId: number, question: string): Promise<ChatResponse> {
    return json(
      await fetch(`/api/patients/${patientId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })
    );
  },
};

// In the static GitHub Pages build there is no backend, so use the bundled
// demo adapter. Local dev and self-hosted builds use the live HTTP API.
import { demoApi, IS_DEMO } from "./demo";

export const api: AiScribeApi = IS_DEMO ? demoApi : liveApi;
