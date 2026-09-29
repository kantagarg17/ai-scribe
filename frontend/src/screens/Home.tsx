import { useEffect, useState } from "react";
import { api, DocumentItem, DocumentKind, VisitSummary } from "../api";

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

  const latestVisit = visits[0];
  const shown = docs.filter((d) => filter === "all" || d.kind === filter);

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
              <div className="card card-accent">
                <div className="card-label">Latest visit summary</div>
                <h3 className="card-title">{latestVisit.title}</h3>
                <div className="card-meta" style={{ marginTop: 4 }}>
                  {latestVisit.doc_date} · {latestVisit.next_steps.length} next steps
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

            {shown.map((d) => (
              <button
                key={d.id}
                className="card card-button"
                onClick={() => setOpen(open === d.id ? null : d.id)}
              >
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
                    : d.content.slice(0, 120).trim() + (d.content.length > 120 ? "…" : "")}
                </p>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
