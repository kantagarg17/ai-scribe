import { useEffect, useState } from "react";
import { api, Patient } from "./api";
import { IconChat, IconHome, IconMic } from "./icons";
import Home from "./screens/Home";
import Record from "./screens/Record";
import Ask from "./screens/Ask";

type Tab = "home" | "record" | "ask";

export default function App() {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [homeKey, setHomeKey] = useState(0); // force Home refetch after a new visit
  const [error, setError] = useState("");

  useEffect(() => {
    // Use the first patient (the seeded demo "Dana"), or create one.
    api
      .listPatients()
      .then(async (patients) => {
        if (patients.length > 0) return patients[0];
        return api.listPatients().then(async (p) =>
          p.length ? p[0] : fetch("/api/patients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "You" }),
          }).then((r) => r.json())
        );
      })
      .then(setPatient)
      .catch((e) =>
        setError(
          "Couldn't reach the AI-Scribe backend. Start it with `uvicorn app.main:app` on port 8000. (" +
            (e as Error).message +
            ")"
        )
      );
  }, []);

  const header = (() => {
    switch (tab) {
      case "record":
        return { eyebrow: "Ambient visit notes", title: "Record" };
      case "ask":
        return { eyebrow: "Perfect memory", title: "Ask" };
      default:
        return { eyebrow: "My health record", title: patient ? `Hi, ${patient.name}` : "My record" };
    }
  })();

  return (
    <div className="device">
      <div className="header">
        <div className="eyebrow">{header.eyebrow}</div>
        <h1 className="greeting">{header.title}</h1>
      </div>

      {error && <div className="center-muted">{error}</div>}

      {patient && !error && (
        <>
          {tab === "home" && <Home key={homeKey} patientId={patient.id} />}
          {tab === "record" && (
            <Record
              patientId={patient.id}
              onSaved={() => setHomeKey((k) => k + 1)}
            />
          )}
          {tab === "ask" && <Ask patientId={patient.id} />}
        </>
      )}

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
  );
}
