"""Perbarui data master ke Poli Umum. Antrean demo hanya diisi dalam mode mock."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.migrate import add_missing_columns, ensure_practitioner_default_location  # noqa: E402
from app.models import Patient  # noqa: E402
from app.seed import (DEMO_PATIENTS, SANDBOX_PATIENTS, configure_general_clinic,  # noqa: E402
                      next_rm_number, seed_today_queue)


def main(clinic_only: bool = False):
    settings = get_settings()
    is_mock = settings.satusehat_mode == "mock"
    Base.metadata.create_all(engine)
    if clinic_only or not is_mock:
        if ensure_practitioner_default_location(engine):
            print("Kolom baru: practitioners.default_location_id")
    else:
        print("Kolom baru:", add_missing_columns(engine) or "tidak ada")
    with SessionLocal() as db:
        configure_general_clinic(db, settings.demo_password, mock_references=is_mock)
        if clinic_only or not is_mock:
            db.commit()
            print("Data master Poli Umum siap.")
            return
        names = set(db.scalars(select(Patient.name)))
        for i, (name, born, gender) in enumerate(DEMO_PATIENTS):
            if name not in names:
                db.add(Patient(name=name, birth_date=born, gender=gender, ihs_number=SANDBOX_PATIENTS[i % 2]))
                db.flush()
        for p in db.scalars(select(Patient).where(Patient.rm_number.is_(None)).order_by(Patient.id)):
            p.rm_number = next_rm_number(db)
            db.flush()
        db.commit()
        print("Antrean demo ditambahkan:", seed_today_queue(db), "pasien")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clinic-only", action="store_true", help="Hanya perbarui data master klinik")
    main(parser.parse_args().clinic_only)
