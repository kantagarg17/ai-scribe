// Self-contained demo backend for the static GitHub Pages build.
//
// When AI-Scribe is hosted as a static site there is no FastAPI server and no
// local model. This module implements the same surface as the live API using
// bundled data, so every screen works from a link. It mirrors the seeded demo
// patient "Dana" and does lightweight, honest, keyword-grounded answering — it
// is NOT a language model, and the UI shows a banner making that clear.

import type {
  ChatResponse,
  DocumentItem,
  DocumentKind,
  Patient,
  Source,
  VisitSummary,
} from "./api";

const PATIENT: Patient = { id: 1, name: "Dana" };

// In-memory record, seeded to match backend/app/seed.py. Mutable so delete and
// capture work within a session (resets on reload — it's a demo).
let nextId = 100;
let documents: DocumentItem[] = [
  {
    id: 1,
    kind: "scan",
    title: "Right breast ultrasound",
    doc_date: "2025-09-10",
    created_at: "2025-09-10T00:00:00Z",
    content:
      "Breast Ultrasound Report. There is a 1.8 cm irregular hypoechoic mass at the 10 o'clock " +
      "position of the right breast, approximately 4 cm from the nipple. Margins are indistinct. " +
      "No axillary lymph node enlargement is seen. ASSESSMENT: BI-RADS 4 - suspicious abnormality. " +
      "Biopsy recommended. BI-RADS is a standard score radiologists use; a 4 means the finding looks " +
      "suspicious enough that a biopsy is recommended to be sure.",
  },
  {
    id: 2,
    kind: "lab",
    title: "Biopsy pathology",
    doc_date: "2025-09-15",
    created_at: "2025-09-15T00:00:00Z",
    content:
      "Pathology Report - Core Needle Biopsy, Right Breast. DIAGNOSIS: Invasive ductal carcinoma, " +
      "grade 2. Estrogen receptor (ER): POSITIVE (95%). Progesterone receptor (PR): POSITIVE (80%). " +
      "HER2: NEGATIVE. Interpretation: Hormone-receptor-positive, HER2-negative invasive breast " +
      "cancer. This subtype typically responds well to hormone (endocrine) therapy.",
  },
  {
    id: 3,
    kind: "discharge",
    title: "After-visit summary",
    doc_date: "2025-09-22",
    created_at: "2025-09-22T00:00:00Z",
    content:
      "After-Visit Summary. Diagnosis of early-stage (stage II), ER+/PR+, HER2- invasive breast " +
      "cancer was discussed. Your next steps: 1. Call the breast surgery office this week to schedule " +
      "a consultation. 2. A medical oncology follow-up will be scheduled to plan treatment after " +
      "surgery. 3. Call the oncology line immediately for any fever of 100.4 F or higher. Consider " +
      "bringing a family member to future appointments.",
  },
  {
    id: 4,
    kind: "visit_note",
    title: "Oncology visit with Dr. Mauro",
    doc_date: "2025-09-22",
    created_at: "2025-09-22T00:00:01Z",
    content:
      "Dr. Mauro: Your ultrasound and the biopsy came back, and it does show a breast cancer. The " +
      "good news is we caught it at an early stage, stage two. The tumor is ER positive and PR " +
      "positive, and HER2 negative - it is driven by hormones, which we have very good treatments " +
      "for. The next step is to meet with the surgeon; call the surgery office this week to schedule. " +
      "Watch for any fever over 100.4 degrees and call the oncology line right away. It helps to " +
      "bring someone with you to the next appointments.",
  },
];

const visitSummaries: Record<number, VisitSummary> = {
  4: {
    document_id: 4,
    title: "Oncology visit with Dr. Mauro",
    doc_date: "2025-09-22",
    summary:
      "This visit confirmed an early-stage (stage two) breast cancer. It is hormone-driven " +
      "(ER positive and PR positive) and HER2 negative, which means it responds well to hormone " +
      "(endocrine) treatments. The next step is to meet with a surgeon.",
    next_steps: [
      "Call the breast surgery office this week to schedule a consultation",
      "Watch for any fever over 100.4°F and call the oncology line right away",
      "Bring a family member to the next appointment",
    ],
    caregiver_update:
      "Dana's results confirmed an early-stage, hormone-driven breast cancer that responds well to " +
      "treatment. The next step is meeting a surgeon. You can help by keeping track of appointments " +
      "and coming along to take notes.",
  },
};

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

/** Keyword overlap score between a query and a chunk of text. */
function score(query: string, text: string): number {
  const q = new Set(
    query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  );
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  let hits = 0;
  for (const w of words) if (q.has(w)) hits++;
  return hits;
}

/** Grounded, extractive answer over the bundled record. Honest, not an LLM. */
function answer(question: string): ChatResponse {
  const ranked = documents
    .map((d) => ({ doc: d, s: score(question, d.content) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (ranked.length === 0) {
    return {
      answer:
        "I don't see anything about that in your record. Please ask your care team. " +
        "(Demo mode uses your bundled record, not a live AI model.)",
      sources: [],
    };
  }

  // Pull the most relevant sentences from the top documents.
  const top = ranked.slice(0, 2);
  const picks: string[] = [];
  for (const { doc } of top) {
    const best = sentences(doc.content)
      .map((s) => ({ s, sc: score(question, s) }))
      .sort((a, b) => b.sc - a.sc)[0];
    if (best && best.sc > 0) picks.push(best.s);
  }

  const sources: Source[] = top.map(({ doc }) => ({
    document_id: doc.id,
    title: doc.title,
    kind: doc.kind,
    doc_date: doc.doc_date,
  }));

  return {
    answer:
      picks.join(" ") +
      "\n\n(Demo mode: this answer is pulled straight from your record, not written by a live AI " +
      "model. Run AI-Scribe locally for real, fluent answers.)",
    sources,
  };
}

export const demoApi = {
  async listPatients(): Promise<Patient[]> {
    await delay(120);
    return [PATIENT];
  },
  async getPatient(): Promise<Patient> {
    await delay(120);
    return PATIENT;
  },
  async listDocuments(_pid: number, kind?: DocumentKind): Promise<DocumentItem[]> {
    await delay();
    const list = kind ? documents.filter((d) => d.kind === kind) : documents;
    return [...list].sort((a, b) =>
      a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.created_at.localeCompare(a.created_at)
    );
  },
  async listVisits(): Promise<VisitSummary[]> {
    await delay();
    return documents
      .filter((d) => d.kind === "visit_note" && visitSummaries[d.id])
      .sort((a, b) => (a.doc_date < b.doc_date ? 1 : -1))
      .map((d) => visitSummaries[d.id]);
  },
  async deleteDocument(_pid: number, documentId: number): Promise<void> {
    await delay(200);
    documents = documents.filter((d) => d.id !== documentId);
    delete visitSummaries[documentId];
  },
  async recordTranscript(
    _pid: number,
    payload: { transcript: string; title?: string; doc_date: string }
  ): Promise<VisitSummary> {
    await delay(900);
    const id = ++nextId;
    const t = payload.transcript.trim();
    const steps = sentences(t)
      .filter((s) => /(should|call|schedule|watch|take|avoid|bring|follow)/i.test(s))
      .slice(0, 4);
    const summary: VisitSummary = {
      document_id: id,
      title: payload.title || "Clinic visit",
      doc_date: payload.doc_date,
      summary: sentences(t).slice(0, 3).join(" ") || "This visit was recorded.",
      next_steps: steps,
      caregiver_update:
        "Here's a quick update from the visit: " +
        (sentences(t)[0] || "everything was reviewed.") +
        " You can help by keeping track of the next steps and appointments.",
    };
    documents.push({
      id,
      kind: "visit_note",
      title: summary.title,
      doc_date: payload.doc_date,
      created_at: new Date().toISOString(),
      content: t,
    });
    visitSummaries[id] = summary;
    return summary;
  },
  async recordAudio(): Promise<VisitSummary> {
    // No transcription without a backend; guide the user to the text path.
    await delay(300);
    throw new Error(
      "Live audio transcription needs the local app. In this demo, use “Type or paste instead”."
    );
  },
  async ask(_pid: number, question: string): Promise<ChatResponse> {
    await delay(650);
    return answer(question);
  },
};

/**
 * True when running as the static demo (no backend to talk to).
 *
 * Demo mode is on when the build asked for it (VITE_DEMO=1) AND no backend URL
 * was provided. Setting VITE_API_BASE (e.g. the Render URL) switches the app to
 * the real hosted backend even if VITE_DEMO=1 is still set.
 */
export const IS_DEMO =
  import.meta.env.VITE_DEMO === "1" && !import.meta.env.VITE_API_BASE;
