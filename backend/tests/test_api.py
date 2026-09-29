"""End-to-end API tests over the offline mock providers."""
from __future__ import annotations


def _make_patient(client) -> int:
    resp = client.post("/api/patients", json={"name": "Test Patient"})
    assert resp.status_code == 200
    return resp.json()["id"]


def test_health_reports_providers(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llm_provider"] == "mock"


def test_add_and_list_documents(client):
    pid = _make_patient(client)
    resp = client.post(
        f"/api/patients/{pid}/documents",
        json={
            "kind": "lab",
            "title": "Biopsy pathology",
            "doc_date": "2025-09-15",
            "content": "ER positive, PR positive, HER2 negative invasive carcinoma.",
        },
    )
    assert resp.status_code == 200

    docs = client.get(f"/api/patients/{pid}/documents").json()
    assert len(docs) == 1
    assert docs[0]["kind"] == "lab"

    labs = client.get(f"/api/patients/{pid}/documents?kind=lab").json()
    assert len(labs) == 1
    scans = client.get(f"/api/patients/{pid}/documents?kind=scan").json()
    assert scans == []


def test_visit_transcript_produces_summary_and_steps(client):
    pid = _make_patient(client)
    resp = client.post(
        f"/api/patients/{pid}/visits/transcript",
        json={
            "transcript": (
                "Doctor: Your results are back. You should call the surgery office this "
                "week to schedule. Watch for any fever over 100.4 and call the oncology line."
            ),
            "title": "Oncology visit",
            "doc_date": "2025-09-22",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]
    # The mock summarizer extracts action-cue sentences as next steps.
    assert any("call" in s.lower() for s in body["next_steps"])

    visits = client.get(f"/api/patients/{pid}/visits").json()
    assert len(visits) == 1


def test_chat_is_grounded_and_cites_sources(client):
    pid = _make_patient(client)
    client.post(
        f"/api/patients/{pid}/documents",
        json={
            "kind": "discharge",
            "title": "After-visit summary",
            "doc_date": "2025-09-22",
            "content": "Call the oncology line immediately for any fever of 100.4 F or higher.",
        },
    )
    resp = client.post(
        f"/api/patients/{pid}/chat",
        json={"question": "What should I do about a fever?"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"]
    assert len(body["sources"]) >= 1
    assert body["sources"][0]["title"] == "After-visit summary"


def test_chat_without_record_declines_gracefully(client):
    pid = _make_patient(client)
    body = client.post(
        f"/api/patients/{pid}/chat", json={"question": "What are my results?"}
    ).json()
    assert body["sources"] == []
    assert "record" in body["answer"].lower()
