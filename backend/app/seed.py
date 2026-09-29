"""Seed a demo patient ("Dana") with a realistic breast-cancer diagnosis
journey: a visit note, labs, a scan report, and a discharge summary.

Run:  python -m app.seed
Idempotent-ish: it creates a fresh "Dana" each run only if none exists.
"""
from __future__ import annotations

from sqlmodel import Session, select

from .db import get_engine, init_db
from .models import Document, DocumentKind, Patient, VisitSummary
from .services.ingestion import index_document
from .services.summarize import summarize_transcript

VISIT_TRANSCRIPT = """\
Dr. Mauro: Hi Dana, thanks for coming in today, September 22nd. Let's talk through
your results. Your ultrasound and the biopsy we did came back, and it does show a
breast cancer. I know that's a lot to hear. The good news is we caught it at an early
stage, stage two. The tumor is what we call ER positive and PR positive, and HER2
negative. In plain terms, that means the cancer is driven by hormones, which we have
very good treatments for.

Dana: Okay. What happens now?

Dr. Mauro: The next step is to meet with the surgeon to talk about removing it. You
should call the surgery office this week to schedule that. We'll also get you set up
with a medical oncologist, that's me, to plan any treatment after surgery. I want you
to watch for any fever over 100.4 degrees, and if that happens, call the oncology line
right away, don't wait. Otherwise, keep eating normally and stay active as you feel able.

Dana: Should I tell my sister?

Dr. Mauro: Yes, it really helps to have someone with you at the next appointments to
take notes. Bring her along if you can.
"""

LAB_REPORT = """\
Pathology Report - Core Needle Biopsy, Right Breast
Collected: 2025-09-15

DIAGNOSIS: Invasive ductal carcinoma, grade 2.
Receptor status:
  Estrogen receptor (ER): POSITIVE (95%)
  Progesterone receptor (PR): POSITIVE (80%)
  HER2: NEGATIVE (IHC 1+)
Ki-67 proliferation index: 15% (intermediate).

Interpretation: Hormone-receptor-positive, HER2-negative invasive breast cancer.
This subtype typically responds well to hormone (endocrine) therapy.
"""

SCAN_REPORT = """\
Breast Ultrasound Report
Exam date: 2025-09-10

FINDINGS: There is a 1.8 cm irregular hypoechoic mass at the 10 o'clock position of
the right breast, approximately 4 cm from the nipple. Margins are indistinct.
No axillary lymph node enlargement is seen.

ASSESSMENT: BI-RADS 4 - suspicious abnormality. Biopsy recommended.

Note: BI-RADS is a standard score radiologists use. A 4 means the finding looks
suspicious enough that a biopsy is recommended to be sure.
"""

DISCHARGE_SUMMARY = """\
After-Visit Summary
Date: 2025-09-22
Provider: Dr. Lauren Mauro, Medical Oncology

Reason for visit: Review of biopsy results.
Summary: Diagnosis of early-stage (stage II), ER+/PR+, HER2- invasive breast cancer
was discussed. Treatment planning is underway.

Your next steps:
  1. Call the breast surgery office this week to schedule a consultation.
  2. A medical oncology follow-up will be scheduled to plan treatment after surgery.
  3. Call the oncology line immediately for any fever of 100.4 F or higher.

Support: Consider bringing a family member to future appointments.
"""


def seed() -> Patient:
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        existing = session.exec(select(Patient).where(Patient.name == "Dana")).first()
        if existing:
            print(f"Demo patient 'Dana' already exists (id={existing.id}). Skipping.")
            return existing

        dana = Patient(name="Dana")
        session.add(dana)
        session.commit()
        session.refresh(dana)

        # Non-visit documents.
        docs = [
            Document(
                patient_id=dana.id,
                kind=DocumentKind.SCAN,
                title="Right breast ultrasound",
                doc_date="2025-09-10",
                content=SCAN_REPORT,
            ),
            Document(
                patient_id=dana.id,
                kind=DocumentKind.LAB,
                title="Biopsy pathology",
                doc_date="2025-09-15",
                content=LAB_REPORT,
            ),
            Document(
                patient_id=dana.id,
                kind=DocumentKind.DISCHARGE,
                title="After-visit summary",
                doc_date="2025-09-22",
                content=DISCHARGE_SUMMARY,
            ),
        ]
        for doc in docs:
            session.add(doc)
            session.commit()
            session.refresh(doc)
            index_document(session, doc)

        # Visit note with a generated plain-language summary.
        result = summarize_transcript(VISIT_TRANSCRIPT)
        visit = Document(
            patient_id=dana.id,
            kind=DocumentKind.VISIT_NOTE,
            title="Oncology visit with Dr. Mauro",
            doc_date="2025-09-22",
            content=VISIT_TRANSCRIPT,
        )
        session.add(visit)
        session.commit()
        session.refresh(visit)
        session.add(
            VisitSummary(
                document_id=visit.id,
                summary=result["summary"],
                next_steps="\n".join(result["next_steps"]),
                caregiver_update=result["caregiver_update"],
            )
        )
        session.commit()
        index_document(session, visit)

        print(f"Seeded demo patient 'Dana' (id={dana.id}) with 4 documents.")
        return dana


if __name__ == "__main__":
    seed()
