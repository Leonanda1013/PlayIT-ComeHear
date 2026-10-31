"""Data master demo. Semua ID berasal dari data dummy sandbox SATUSEHAT (bukan data pasien asli)."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Location, Patient, Practitioner, User
from app.security import hash_password


def seed(db: Session, demo_password: str) -> None:
    if db.scalar(select(User).limit(1)):
        return
    dr = Practitioner(name="dr. Demo, Sp.A", nik=None, satusehat_id="100009880728")
    db.add(dr)
    db.flush()
    db.add_all([
        User(username="dokter", name=dr.name, role="dokter",
             password_hash=hash_password(demo_password), practitioner_id=dr.id),
        User(username="perawat", name="Perawat Demo", role="perawat", password_hash=hash_password(demo_password)),
        User(username="admin", name="Admin Rekam Medis", role="admin", password_hash=hash_password(demo_password)),
        Location(name="Ruang Poli Anak", satusehat_location_id="b22b4bc9-abbc-4cde-80e8-089ec10bcaea",
                 service_type_code="394537008", service_type_display="Pediatrics"),
        Patient(name="Pasien Dummy Sandbox 1", nik=None, birth_date=date(2022, 3, 1), gender="male",
                ihs_number="P02478375538"),
        Patient(name="Pasien Dummy Sandbox 2", nik=None, birth_date=date(2020, 7, 15), gender="female",
                ihs_number="P02029538176"),
    ])
    db.commit()
