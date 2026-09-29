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

export const api = {
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
