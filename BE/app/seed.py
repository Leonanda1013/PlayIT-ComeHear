"""Data master demo. Semua ID SATUSEHAT berasal dari data dummy sandbox (bukan data pasien asli)."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Location, Patient, Practitioner, User, Visit
from app.security import hash_password

WIB = timezone(timedelta(hours=7))
SANDBOX_PATIENTS = ["P02478375538", "P02029538176"]  # pasien dummy sandbox yang sudah terverifikasi
SANDBOX_PRACTITIONER = "100009880728"
SANDBOX_LOCATION = "b22b4bc9-abbc-4cde-80e8-089ec10bcaea"

DEMO_PATIENTS = [  # nama sesuai desain UI; semua pasien fiktif
    ("Vincentius Leonanda Prabowo", date(2007, 3, 14), "male"),
    ("Annisa Eka Puspita", date(2005, 8, 2), "female"),
    ("Ghetsa Ramadhani", date(2006, 1, 19), "female"),
    ("Kemal Suhendra", date(1998, 11, 5), "male"),
    ("Oltha Rosyeda", date(1979, 6, 23), "female"),
    ("Saka Nabil", date(1990, 4, 9), "male"),
    ("Reika Amalia", date(2001, 12, 30), "female"),
]


def next_rm_number(db: Session) -> str:
    n = (db.scalar(select(func.count(Patient.id)).where(Patient.rm_number.is_not(None))) or 0) + 9041
    return f"{datetime.now(WIB).year}-{n:04d}"


def next_visit_code(db: Session) -> str:
    """Nomor rawat (identifier Encounter): unik dan stabil, format tahun/bulan/tanggal/urut."""
    today = datetime.now(WIB)
    prefix = today.strftime("%Y/%m/%d/")
    n = (db.scalar(select(func.count(Visit.id)).where(Visit.code.like(f"{prefix}%"))) or 0) + 1
    return f"{prefix}{n:04d}"


def next_queue_no(db: Session, location_id: int) -> int:
    start = datetime.now(WIB).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    last = db.scalar(select(func.max(Visit.queue_no)).where(Visit.location_id == location_id,
                                                            Visit.arrived_at >= start))
    return (last or 0) + 1


def seed(db: Session, demo_password: str) -> None:
    if db.scalar(select(User).limit(1)):
        return
    dr = Practitioner(name="dr. Rian, Sp.PD", satusehat_id=SANDBOX_PRACTITIONER)
    db.add(dr)
    db.flush()
    pw = hash_password(demo_password)
    db.add_all([
        User(username="dokter", email="rian@rumahsakit.id", name="dr. Rian Sp.PD", role="dokter",
             password_hash=pw, practitioner_id=dr.id),
        User(username="perawat", email="perawat@rumahsakit.id", name="Perawat Poli", role="perawat", password_hash=pw),
        User(username="admin", email="admin@rumahsakit.id", name="Admin Rekam Medis", role="admin", password_hash=pw),
        Location(name="Bilik Konsultasi 03", poli="Poli Penyakit Dalam", satusehat_location_id=SANDBOX_LOCATION,
                 service_type_code="419192003", service_type_display="Internal medicine"),
    ])
    db.flush()
    for i, (name, born, gender) in enumerate(DEMO_PATIENTS):
        db.add(Patient(name=name, rm_number=next_rm_number(db), birth_date=born, gender=gender,
                       ihs_number=SANDBOX_PATIENTS[i % 2]))
        db.flush()
    db.commit()


def seed_today_queue(db: Session) -> int:
    """Isi antrean hari ini dengan pasien demo (DEMO_PATIENTS) yang belum terdaftar hari ini."""
    loc = db.scalar(select(Location).order_by(Location.id.desc()))
    dr = db.scalar(select(Practitioner).order_by(Practitioner.id.desc()))
    start = datetime.now(WIB).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    queued = set(db.scalars(select(Visit.patient_id).where(Visit.arrived_at >= start)))
    added = 0
    demo_names = [name for name, _, _ in DEMO_PATIENTS]
    for p in db.scalars(select(Patient).where(Patient.name.in_(demo_names)).order_by(Patient.id)):
        if p.id in queued:
            continue
        db.add(Visit(code=next_visit_code(db), patient_id=p.id, practitioner_id=dr.id, location_id=loc.id,
                     queue_no=next_queue_no(db, loc.id)))
        db.flush()
        added += 1
    db.commit()
    return added
