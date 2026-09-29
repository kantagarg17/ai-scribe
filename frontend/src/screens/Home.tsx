import { useEffect, useState } from "react";
import { api, DocumentItem, DocumentKind, VisitSummary } from "../api";
import { IconVisit, IconLab, IconScan, IconDischarge } from "../icons";
import SwipeCard from "../SwipeCard";

type Filter = "all" | DocumentKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "visit_note", label: "Visit notes" },
  { key: "lab", label: "Labs" },
  { key: "scan", label: "Scans" },
  { key: "discharge", label: "Discharge" },
];

const KIND_LABEL: Record<DocumentKind, string> = {
  visit_note: "Visit",
  lab: "Lab",
  scan: "Scan",
  discharge: "Discharge",
};

function KindIcon({ kind }: { kind: DocumentKind }) {
  if (kind === "visit_note") return <IconVisit />;
  if (kind === "lab") return <IconLab />;
  if (kind === "scan") return <IconScan />;
  return <IconDischarge />;
}

/** "2025-09-22" -> "Mon, Sep 22, 2025" for a calm, readable day label. */
function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Home({ patientId }: { patientId: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [visits, setVisits] = useState<VisitSummary[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.listDocuments(patientId), api.listVisits(patientId)])
      .then(([d, v]) => {
        if (!alive) return;
        setDocs(d);
        setVisits(v);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [patientId]);

  async function handleDelete(doc: DocumentItem) {
    // Optimistically remove from the timeline and any visit summary.
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    setVisits((prev) => prev.filter((v) => v.document_id !== doc.id));
    try {
      await api.deleteDocument(patientId, doc.id);
    } catch {
      // Reload from source on failure so the UI stays truthful.
      const [d, v] = await Promise.all([
        api.listDocuments(patientId),
        api.listVisits(patientId),
      ]);
      setDocs(d);
      setVisits(v);
    }
  }

  const latestVisit = visits[0];
  const shown = docs.filter((d) => filter === "all" || d.kind === filter);

  // Group the timeline by day (docs already arrive newest-first).
  const groups: { day: string; items: DocumentItem[] }[] = [];
  for (const d of shown) {
    const last = groups[groups.length - 1];
    if (last && last.day === d.doc_date) last.items.push(d);
    else groups.push({ day: d.doc_date, items: [d] });
  }

  return (
    <div className="screen">
      <div className="subbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="scroll">
        {loading ? (
          <div className="state">
            <span className="spinner" /> Loading your record…
          </div>
        ) : (
          <>
            {filter === "all" && latestVisit && (
              <div className="hero">
                <div className="card-label">Latest visit summary</div>
                <h3 className="card-title">{latestVisit.title}</h3>
                <div className="card-meta" style={{ marginTop: 4 }}>
                  {formatDay(latestVisit.doc_date)} · {latestVisit.next_steps.length} next steps
                </div>
                <p className="body-text">{latestVisit.summary}</p>
                {latestVisit.next_steps.length > 0 && (
                  <ul className="steps">
                    {latestVisit.next_steps.map((s, i) => (
                      <li className="step" key={i}>
                        <span className="check">✓</span>
                        <span className="step-text">{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {shown.length === 0 && (
              <div className="state">Nothing here yet. Capture a visit or add a record.</div>
            )}

            {groups.map((g) => (
              <div className="day-group" key={g.day}>
                <div className="day-label">
                  <span className="dot" />
                  <span className="txt">{formatDay(g.day)}</span>
                  <span className="rule" />
                </div>
                {g.items.map((d) => (
                  <SwipeCard key={d.id} onDelete={() => handleDelete(d)}>
                    <button
                      className="card card-button"
                      onClick={() => setOpen(open === d.id ? null : d.id)}
                    >
                      <div className="card-row">
                        <span className={`kind-ic ${d.kind}`}>
                          <KindIcon kind={d.kind} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="card-head">
                            <span className="kind-badge">{KIND_LABEL[d.kind]}</span>
                            <span className="card-meta">{d.doc_date}</span>
                          </div>
                          <h3 className="card-title" style={{ marginTop: 8 }}>
                            {d.title}
                          </h3>
                          <p className="body-text">
                            {open === d.id
                              ? d.content
                              : d.content.slice(0, 96).trim() + (d.content.length > 96 ? "…" : "")}
                          </p>
                        </div>
                      </div>
                    </button>
                  </SwipeCard>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
