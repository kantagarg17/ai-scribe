import { useRef, useState } from "react";
import { api, VisitSummary } from "../api";
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

  const today = new Date().toISOString().slice(0, 10);

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
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
      const v = await api.recordAudio(patientId, blob, { title: "Clinic visit", doc_date: today });
      finish(v);
    } catch (e) {
      // Audio transcription needs a real provider; guide the user to text.
      setUseText(true);
      setPhase("idle");
      setError(
        (e as Error).message +
          " - tip: in demo mode, use the text option below to summarize a visit."
      );
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
      finish(v);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function finish(v: VisitSummary) {
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
