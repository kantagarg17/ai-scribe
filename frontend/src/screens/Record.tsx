import { useRef, useState } from "react";
import { api, VisitSummary } from "../api";
import { addLocalVisit } from "../localRecord";
import { IconMicLarge, IconStop } from "../icons";

type Phase = "idle" | "recording" | "processing" | "done" | "error";

const DEMO_TRANSCRIPT =
  "Dr. Mauro: Good to see you today. Your scan and biopsy came back and it does show " +
  "an early-stage breast cancer, stage two, that is hormone driven, ER and PR positive, " +
  "HER2 negative. The next step is to see the surgeon, so please call the surgery office " +
  "this week to schedule. Watch for any fever over 100.4 and call the oncology line right " +
  "away if that happens. It helps to bring a family member to your next visit.";

export default function Record({
  patientId,
  onSaved,
}: {
  patientId: number;
  onSaved: (v: VisitSummary) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<VisitSummary | null>(null);
  const [error, setError] = useState("");
  const [useText, setUseText] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");

  const today = new Date().toISOString().slice(0, 10);

  // Pick a container the browser can record AND Groq Whisper accepts. Chrome/
  // Firefox produce webm/ogg; Safari produces mp4/m4a. Hardcoding webm broke
  // Safari, so negotiate here.
  function pickMimeType(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/mpeg",
    ];
    const MR = (window as any).MediaRecorder;
    if (MR && typeof MR.isTypeSupported === "function") {
      for (const c of candidates) if (MR.isTypeSupported(c)) return c;
    }
    return "";
  }

  function extFor(mime: string): string {
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("mpeg")) return "mp3";
    return "webm";
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chosen = pickMimeType();
      const recorder = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      // The actual type the recorder settled on (may differ from requested).
      mimeRef.current = recorder.mimeType || chosen || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (mimeRef.current || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type });
        await processAudio(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
    } catch {
      // No mic permission or unsupported: fall back to typing the visit.
      setUseText(true);
      setError("Microphone unavailable. You can paste or type the visit instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setPhase("processing");
  }

  async function processAudio(blob: Blob) {
    setPhase("processing");
    try {
      const ext = extFor(mimeRef.current);
      const v = await api.recordAudio(patientId, blob, {
        title: "Clinic visit",
        doc_date: today,
        filename: `visit.${ext}`,
      });
      // No raw transcript on the audio path (transcribed server-side); store
      // the summary text as the record content so it reads well in the record.
      finish(v, v.summary);
    } catch (e) {
      // Transcription failed; guide the user to the reliable text path.
      setUseText(true);
      setPhase("idle");
      setError((e as Error).message + " - you can type or paste the visit instead.");
    }
  }

  async function submitText() {
    if (!transcript.trim()) return;
    setPhase("processing");
    setError("");
    try {
      const v = await api.recordTranscript(patientId, {
        transcript,
        title: "Clinic visit",
        doc_date: today,
      });
      finish(v, transcript);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function finish(v: VisitSummary, content: string) {
    // Persist locally so the visit appears on the Record home page and
    // survives reloads (the hosted backend is stateless).
    addLocalVisit(v, content);
    setResult(v);
    setPhase("done");
    onSaved(v);
  }

  function reset() {
    setResult(null);
    setTranscript("");
    setPhase("idle");
    setError("");
  }

  if (phase === "done" && result) {
    return (
      <div className="screen">
        <div className="scroll">
          <div className="card card-accent">
            <div className="card-label">Visit summary ready</div>
            <h3 className="card-title">{result.title}</h3>
            <div className="card-meta" style={{ marginTop: 4 }}>
              {result.doc_date}
            </div>
            <p className="body-text">{result.summary}</p>
          </div>

          {result.next_steps.length > 0 && (
            <div className="card">
              <div className="card-label">Next steps</div>
              <ul className="steps">
                {result.next_steps.map((s, i) => (
                  <li className="step" key={i}>
                    <span className="check">✓</span>
                    <span className="step-text">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.caregiver_update && (
            <div className="card">
              <div className="card-label">Share with a caregiver</div>
              <p className="body-text">{result.caregiver_update}</p>
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 14 }}
                onClick={() => navigator.clipboard?.writeText(result.caregiver_update)}
              >
                Copy update
              </button>
            </div>
          )}

          <button className="btn btn-primary btn-block" onClick={reset}>
            Capture another visit
          </button>
          <p className="disclaimer">
            AI-Scribe is a research prototype, not a medical device, and does not give medical
            advice.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="capture">
        <h2>Capture this visit</h2>
        <p className="lede">
          With your consent, AI-Scribe listens and turns the visit into plain language you can keep.
        </p>

        {!useText ? (
          <>
            <div className={`mic-wrap ${phase === "recording" ? "breathing" : ""}`}>
              <span className="ring r1" />
              <span className="ring r2" />
              <button
                className={`mic ${phase === "recording" ? "recording" : ""}`}
                onClick={phase === "recording" ? stopRecording : startRecording}
                disabled={phase === "processing"}
                aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
              >
                {phase === "recording" ? <IconStop /> : <IconMicLarge />}
              </button>
            </div>

            {phase === "idle" && (
              <div className="consent">
                Recording only starts when you tap. Your record stays yours.
              </div>
            )}
            {phase === "recording" && <p className="hint">Listening… tap to stop.</p>}
            {phase === "processing" && (
              <p className="hint">
                <span className="spinner" /> Writing your summary…
              </p>
            )}

            <button
              className="btn btn-ghost"
              style={{ marginTop: 16 }}
              onClick={() => setUseText(true)}
            >
              Type or paste instead
            </button>
          </>
        ) : (
          <div className="live-transcript">
            <textarea
              className="transcript-input"
              placeholder="Paste or type what was said during the visit…"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setTranscript(DEMO_TRANSCRIPT)} type="button">
                Use example
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={submitText}
                disabled={!transcript.trim() || phase === "processing"}
              >
                {phase === "processing" ? <span className="spinner" /> : "Summarize visit"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="hint error">{error}</p>}
      </div>
    </div>
  );
}
