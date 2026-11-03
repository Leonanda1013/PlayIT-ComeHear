"""Tingkatkan database lama ke UI baru tanpa menghapus data, lalu isi antrean demo hari ini.

  python scripts/upgrade_demo.py

Aman dijalankan berulang: kolom baru ditambahkan sekali, nomor RM/email hanya diisi bila kosong,
pasien demo hanya ditambahkan bila belum ada.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.migrate import add_missing_columns  # noqa: E402
from app.models import Location, Patient, Practitioner, User  # noqa: E402
from app.seed import (DEMO_PATIENTS, SANDBOX_LOCATION, SANDBOX_PATIENTS, next_rm_number,  # noqa: E402
                      seed_today_queue)


def main():
    Base.metadata.create_all(engine)
    print("Kolom baru:", add_missing_columns(engine) or "tidak ada")
    with SessionLocal() as db:
        for u in db.scalars(select(User)):
            if not u.email:
                u.email = {"dokter": "rian@rumahsakit.id"}.get(u.username, f"{u.username}@rumahsakit.id")
            if u.username == "dokter":
                u.name = "dr. Rian Sp.PD"
                if u.practitioner:
                    u.practitioner.name = "dr. Rian, Sp.PD"
        if not db.scalar(select(Location).where(Location.poli == "Poli Penyakit Dalam")):
            db.add(Location(name="Bilik Konsultasi 03", poli="Poli Penyakit Dalam", satusehat_location_id=SANDBOX_LOCATION,
                            service_type_code="419192003", service_type_display="Internal medicine"))
        for loc in db.scalars(select(Location).where(Location.poli.is_(None))):
            loc.poli = "Poli Anak" if loc.service_type_code == "394537008" else "Poli Umum"
        db.flush()
        names = set(db.scalars(select(Patient.name)))
        for i, (name, born, gender) in enumerate(DEMO_PATIENTS):
            if name not in names:
                db.add(Patient(name=name, birth_date=born, gender=gender, ihs_number=SANDBOX_PATIENTS[i % 2]))
                db.flush()
        for p in db.scalars(select(Patient).where(Patient.rm_number.is_(None)).order_by(Patient.id)):
            p.rm_number = next_rm_number(db)
            db.flush()
        if not db.scalar(select(Practitioner)):
            raise SystemExit("Tidak ada praktisi; jalankan server sekali dulu agar data awal dibuat.")
        db.commit()
        print("Antrean demo ditambahkan:", seed_today_queue(db), "pasien")


if __name__ == "__main__":
    main()
