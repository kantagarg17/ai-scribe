import { useEffect, useState } from "react";
import { api, Patient } from "./api";
import { IS_DEMO } from "./demo";
import { IconChat, IconHome, IconMic } from "./icons";
import Home from "./screens/Home";
import Record from "./screens/Record";
import Ask from "./screens/Ask";

type Tab = "home" | "record" | "ask";

const HEADERS: Record<Tab, { eyebrow: string; title: (p: Patient | null) => string }> = {
  home: { eyebrow: "My health record", title: (p) => (p ? `Hi, ${p.name}` : "My record") },
  record: { eyebrow: "Ambient visit notes", title: () => "Record" },
  ask: { eyebrow: "Perfect memory", title: () => "Ask" },
};

export default function App() {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [homeKey, setHomeKey] = useState(0); // force Home refetch after a new visit
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listPatients()
      .then(async (patients) => {
        if (patients.length > 0) return patients[0];
        const created = await fetch("/api/patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "You" }),
        });
        return created.json();
      })
      .then(setPatient)
      .catch((e) =>
        setError(
          "Couldn't reach the AI-Scribe backend. Start it on port 8000. (" +
            (e as Error).message +
            ")"
        )
      );
  }, []);

  const header = HEADERS[tab];

  return (
    <div className="app">
      <div className="device">
        <header className="header">
          <div className="eyebrow">{header.eyebrow}</div>
          <h1 className="greeting">{header.title(patient)}</h1>
          {IS_DEMO && (
            <div className="demo-banner">
              Demo · answers come from the sample record, not a live AI model
            </div>
          )}
        </header>

        <main className="main">
          {error ? (
            <div className="state">{error}</div>
          ) : !patient ? (
            <div className="state">
              <span className="spinner" /> Connecting…
            </div>
          ) : tab === "home" ? (
            <Home key={homeKey} patientId={patient.id} />
          ) : tab === "record" ? (
            <Record patientId={patient.id} onSaved={() => setHomeKey((k) => k + 1)} />
          ) : (
            <Ask patientId={patient.id} />
          )}
        </main>

        <nav className="tabbar">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
            <span className="ic">
              <IconHome active={tab === "home"} />
            </span>
            Record
          </button>
          <button className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}>
            <span className="ic">
              <IconMic />
            </span>
            Capture
          </button>
          <button className={tab === "ask" ? "active" : ""} onClick={() => setTab("ask")}>
            <span className="ic">
              <IconChat />
            </span>
            Ask
          </button>
        </nav>
      </div>
    </div>
  );
}
