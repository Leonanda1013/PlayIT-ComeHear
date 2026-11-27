import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

# Unit test menyatakan SQLite secara eksplisit; aplikasi produksi tetap mewajibkan DATABASE_URL.
os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import Settings
from app.db import Base, make_engine
from app.models import ClinicalNote, Location, Patient, Practitioner, User, Visit
from app.scribe.circuit_breaker import DEFAULT_BREAKER
from app.seed import seed


@pytest.fixture(autouse=True)
def _reset_llm_circuit_breaker():
    DEFAULT_BREAKER.reset()
    yield
    DEFAULT_BREAKER.reset()


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, database_url=f"sqlite:///{tmp_path / 't.db'}",
                    satusehat_mode="mock", llm_providers="mock", worker_interval_s=0.05)


@pytest.fixture
def session_factory(settings):
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    sf = sessionmaker(bind=engine, expire_on_commit=False)
    with sf() as db:
        seed(db, "pw")
    return sf


@pytest.fixture
def db(session_factory):
    with session_factory() as s:
        yield s


@pytest.fixture
def doctor(db):
    return db.scalar(select(User).where(User.username == "dokter"))


@pytest.fixture
def medical_records_user(db):
    return db.scalar(select(User).where(User.role == "perawat"))


@pytest.fixture
def admin(db):
    return db.scalar(select(User).where(User.role == "admin"))


@pytest.fixture
def visit_with_note(db):
    t0 = datetime(2026, 10, 28, 3, 0, tzinfo=timezone.utc)
    v = Visit(code="ANAK-20261028-001",
              patient_id=db.scalar(select(Patient.id).limit(1)),
              practitioner_id=db.scalar(select(Practitioner.id).limit(1)),
              location_id=db.scalar(select(Location.id).limit(1)),
              status="draft", arrived_at=t0, started_at=t0 + timedelta(minutes=10),
              ended_at=t0 + timedelta(minutes=30))
    db.add(v)
    db.flush()
    db.add(ClinicalNote(
        visit_id=v.id,
        subjective={"keluhan_utama": "Demam tinggi sejak kemarin pagi"},
        subjective_summary="Anak demam tinggi sejak kemarin pagi, nyeri kepala, lemas, mual.",
        vitals={"body_temperature": 38.9, "body_weight": 17.5},
        diagnoses=[{"code": "A90", "display": "Dengue fever [classical dengue]", "rank": 1}],
        assessment="Demam hari ke-2 dengan nyeri kepala; suspek dengue.",
        prescriptions=[{"kfa_code": "93001926", "dose_value": 7.5, "frequency": 1, "period": 4,
                        "period_max": 6, "period_unit": "h", "as_needed_text": "demam",
                        "as_needed_fever": True, "duration_days": 3, "quantity": 1,
                        "patient_instruction": "Parasetamol 7,5 ml tiap 4-6 jam bila demam"}],
    ))
    db.commit()
    db.refresh(v)
    return v
