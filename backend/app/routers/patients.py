"""Patient endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import Patient
from ..schemas import PatientCreate, PatientOut

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.post("", response_model=PatientOut)
def create_patient(body: PatientCreate, session: Session = Depends(get_session)) -> PatientOut:
    patient = Patient(name=body.name.strip() or "Patient")
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return PatientOut(id=patient.id, name=patient.name)


@router.get("", response_model=list[PatientOut])
def list_patients(session: Session = Depends(get_session)) -> list[PatientOut]:
    patients = session.exec(select(Patient)).all()
    return [PatientOut(id=p.id, name=p.name) for p in patients]


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(patient_id: int, session: Session = Depends(get_session)) -> PatientOut:
    patient = session.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return PatientOut(id=patient.id, name=patient.name)
