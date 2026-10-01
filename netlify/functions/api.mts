// AI-Scribe backend as a Netlify Function — real AI via Groq.
//
// Serves the record demo with grounded chat + visit summaries from an open LLM
// (openai/gpt-oss-20b) and Whisper transcription (whisper-large-v3), all via
// Groq's OpenAI-compatible API. Stateless: the seeded record lives in memory
// and retrieval is computed per request. Create/delete are reflected
// optimistically by the frontend (not persisted) — fine for a shared demo.
//
// Env (set in the Netlify dashboard or via CLI):
//   GROQ_API_KEY   required — https://console.groq.com/keys
//   GROQ_BASE_URL  default https://api.groq.com/openai/v1
//   LLM_MODEL      default openai/gpt-oss-20b
//   WHISPER_MODEL  default whisper-large-v3

import type { Config, Context } from "@netlify/functions";

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "openai/gpt-oss-20b";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-large-v3";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

// --- Seed record (mirrors backend/app/seed.py — demo patient "Dana") ---
const PATIENT = { id: 1, name: "Dana" };

const DOCUMENTS = [
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
      "Watch for any fever over 100.4 degrees and call the oncology line right away. It helps to bring " +
      "someone with you to the next appointments.",
  },
];

const VISIT_SUMMARIES: Record<number, any> = {
  4: {
    document_id: 4,
    title: "Oncology visit with Dr. Mauro",
    doc_date: "2025-09-22",
    summary:
      "This visit confirmed an early-stage (stage two) breast cancer. It is hormone-driven (ER " +
      "positive and PR positive) and HER2 negative, which means it responds well to hormone " +
      "(endocrine) treatments. The next step is to meet with a surgeon.",
    next_steps: [
      "Call the breast surgery office this week to schedule a consultation",
      "Watch for any fever over 100.4\u00b0F and call the oncology line right away",
      "Bring a family member to the next appointment",
    ],
    caregiver_update:
      "Dana's results confirmed an early-stage, hormone-driven breast cancer that responds well to " +
      "treatment. The next step is meeting a surgeon. You can help by keeping track of appointments " +
      "and coming along to take notes.",
  },
};

// --- Lightweight in-memory retrieval (hashing embeddings; no deps) ---
const DIM = 256;

function hashTok(tok: string): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    v[hashTok(tok) % DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function chunks(text: string, size = 500): string[] {
  const units = text.trim().split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if ((cur + " " + u).length <= size) cur = (cur + " " + u).trim();
    else {
      if (cur) out.push(cur);
      cur = u;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function retrieve(question: string, k = 4) {
  const qv = embed(question);
  const scored: { doc: any; chunk: string; score: number }[] = [];
  for (const d of DOCUMENTS) {
    for (const ch of chunks(d.content)) {
      scored.push({ doc: d, chunk: ch, score: cosine(qv, embed(`${d.title} ${ch}`)) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter((s) => s.score > 0);
}

// --- Groq calls ---
async function groqChat(messages: any[], temperature = 0.2): Promise<string> {
  if (!GROQ_API_KEY) throw new HttpError(503, "Server is missing GROQ_API_KEY.");
  const resp = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, messages, temperature }),
  });
  if (!resp.ok) throw new HttpError(502, `LLM error: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function groqTranscribe(file: File): Promise<string> {
  if (!GROQ_API_KEY) throw new HttpError(503, "Server is missing GROQ_API_KEY.");
  const form = new FormData();
  form.append("model", WHISPER_MODEL);
  form.append("file", file);
  const resp = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });
  if (!resp.ok) throw new HttpError(502, `Transcription error: ${(await resp.text()).slice(0, 200)}`);
  return (await resp.json()).text || "";
}

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function summarize(transcript: string): Promise<any> {
  const system =
    "You are AI-Scribe, a careful medical scribe writing for a patient at a 6th-grade reading level. " +
    "Turn the visit transcript into plain language. Never invent facts and give no new medical advice " +
    "beyond what was said.";
  const instr =
    'Return ONLY a JSON object with keys "summary" (3-6 plain sentences), "next_steps" (array of short ' +
    'action strings), and "caregiver_update" (2-4 sentences for a family member).\n\nTRANSCRIPT:\n' +
    transcript;
  const raw = await groqChat([
    { role: "system", content: system },
    { role: "user", content: instr },
  ]);
  let text = raw.trim().replace(/```[a-z]*/gi, "").replace(/```/g, "").trim();
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  try {
    const data = JSON.parse(text.slice(s, e + 1));
    let steps = data.next_steps ?? [];
    if (typeof steps === "string") steps = steps.split("\n").map((x: string) => x.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    return {
      summary: String(data.summary || "").trim() || raw.trim(),
      next_steps: (steps as any[]).map((x) => String(x).trim()).filter(Boolean),
      caregiver_update: String(data.caregiver_update || "").trim(),
    };
  } catch {
    return { summary: raw.trim(), next_steps: [], caregiver_update: "" };
  }
}

// --- Router ---
export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, "").replace(/\/$/, "") || "/";

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (path === "/health" || path === "/patients") {
      if (path === "/health") return jsonResp({ status: "ok", llm: LLM_MODEL, has_key: !!GROQ_API_KEY });
      return jsonResp([PATIENT]);
    }

    // /patients/1 ...
    const m = path.match(/^\/patients\/(\d+)(.*)$/);
    if (m) {
      const rest = m[2];

      if (rest === "" || rest === "/") return jsonResp(PATIENT);

      if (rest.startsWith("/documents")) {
        if (req.method === "DELETE") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
        const kind = url.searchParams.get("kind");
        const docs = DOCUMENTS.filter((d) => !kind || d.kind === kind).sort((a, b) =>
          a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.created_at.localeCompare(a.created_at)
        );
        return jsonResp(docs);
      }

      if (rest === "/visits") {
        const out = DOCUMENTS.filter((d) => d.kind === "visit_note" && VISIT_SUMMARIES[d.id])
          .sort((a, b) => (a.doc_date < b.doc_date ? 1 : -1))
          .map((d) => VISIT_SUMMARIES[d.id]);
        return jsonResp(out);
      }

      if (rest === "/visits/transcript" && req.method === "POST") {
        const body = await req.json();
        const t = String(body.transcript || "").trim();
        if (!t) return jsonResp({ detail: "transcript is required" }, 422);
        const r = await summarize(t);
        return jsonResp({ document_id: 9000, title: body.title || "Clinic visit", doc_date: body.doc_date, ...r });
      }

      if (rest === "/visits/record" && req.method === "POST") {
        const form = await req.formData();
        const audio = form.get("audio") as File | null;
        const docDate = String(form.get("doc_date") || "");
        const title = String(form.get("title") || "Clinic visit");
        if (!audio) return jsonResp({ detail: "audio is required" }, 422);
        const transcript = await groqTranscribe(audio);
        if (!transcript.trim()) return jsonResp({ detail: "Could not transcribe audio." }, 422);
        const r = await summarize(transcript);
        return jsonResp({ document_id: 9001, title, doc_date: docDate, ...r });
      }

      if (rest === "/chat" && req.method === "POST") {
        const body = await req.json();
        const q = String(body.question || "").trim();
        if (!q) return jsonResp({ detail: "question is required" }, 422);
        const hits = retrieve(q);
        if (hits.length === 0) {
          return jsonResp({
            answer: "I don't see anything about that in your record. Please ask your care team.",
            sources: [],
          });
        }
        const context = hits.map((h) => `[Source: ${h.doc.title} (${h.doc.doc_date})]\n${h.chunk}`).join("\n\n");
        const system =
          "You are AI-Scribe. Answer the patient's question using ONLY the excerpts from their own " +
          "health record below. Write in plain, warm language at a 6th-grade reading level. If the " +
          "answer is not in the excerpts, say you don't see it in their record and suggest they ask " +
          "their care team. Never invent medical facts. Refer to where information came from (for " +
          "example, 'from your Sep 22 visit'). This is not medical advice.";
        const answer = await groqChat([
          { role: "system", content: system },
          { role: "user", content: `Excerpts from your record:\n\n${context}\n\nQuestion: ${q}` },
        ]);
        const seen = new Set<number>();
        const sources: any[] = [];
        for (const h of hits) {
          if (!seen.has(h.doc.id)) {
            seen.add(h.doc.id);
            sources.push({ document_id: h.doc.id, title: h.doc.title, kind: h.doc.kind, doc_date: h.doc.doc_date });
          }
        }
        return jsonResp({ answer: answer.trim(), sources });
      }
    }

    return jsonResp({ detail: "Not Found" }, 404);
  } catch (err) {
    if (err instanceof HttpError) return jsonResp({ detail: err.message }, err.status);
    return jsonResp({ detail: `Server error: ${(err as Error).message}` }, 500);
  }
}

export const config: Config = {
  path: ["/api/*", "/health"],
};
