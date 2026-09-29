import { useEffect, useRef, useState } from "react";
import { api, Source } from "../api";

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
}

const SUGGESTIONS = [
  "What do I do if I get a fever?",
  "Explain my ultrasound in plain language.",
  "What are my next steps?",
  "What does ER positive mean?",
];

export default function Ask({ patientId }: { patientId: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await api.ask(patientId, q);
      setTurns((t) => [...t, { role: "assistant", text: res.answer, sources: res.sources }]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: "assistant", text: "Sorry, something went wrong: " + (e as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <>
            <div className="card">
              <div className="card-label">Ask it anything</div>
              <p className="body-text">
                Ask about your visits, labs, and scans. Answers come only from your own record, with
                a link back to the source.
              </p>
            </div>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {turns.length > 0 && (
          <div className="chat-stream">
            {turns.map((t, i) => (
              <div key={i} className={`bubble ${t.role}`}>
                {t.text}
                {t.sources && t.sources.length > 0 && (
                  <div className="sources">
                    {t.sources.map((s) => (
                      <span className="source-chip" key={s.document_id}>
                        From your {s.title} · {s.doc_date}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="bubble assistant">
                <span className="spinner" /> Looking through your record…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Ask about your care…"
        />
        <button className="send" onClick={() => send(input)} disabled={busy || !input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
