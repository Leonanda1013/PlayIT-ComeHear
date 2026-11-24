"""Data master demo. Semua ID SATUSEHAT berasal dari data dummy sandbox (bukan data pasien asli)."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.fhir.codes import GENERAL_PRACTICE_CODE, GENERAL_PRACTICE_DISPLAY
from app.models import Location, Patient, Practitioner, User, Visit
from app.security import hash_password

WIB = timezone(timedelta(hours=7))
SANDBOX_PATIENTS = ["P02478375538", "P02029538176"]  # pasien dummy sandbox yang sudah terverifikasi
SANDBOX_PRACTITIONER = "100009880728"
SANDBOX_LOCATION = "b22b4bc9-abbc-4cde-80e8-089ec10bcaea"
MOCK_SECOND_PRACTITIONER = "mock-practitioner-kemal"
MOCK_SECOND_LOCATION = "00000000-0000-4000-8000-000000000002"
CLINIC_DOMAIN = "klinikbungamelati.id"
GENERAL_CLINIC = "Poli Umum"
ROOM_ONE = "Bilik 1"
ROOM_TWO = "Bilik 2"

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


def configure_general_clinic(db: Session, password: str, *, mock_references: bool) -> None:
    """Siapkan dua bilik dan akun klinik dengan mempertahankan ID master lama."""
    rooms = {room.name: room for room in db.scalars(select(Location))}
    first_room = rooms.get(ROOM_ONE) or rooms.get("Bilik Konsultasi 01") or rooms.get("Bilik Konsultasi 03")
    second_room = rooms.get(ROOM_TWO) or rooms.get("Bilik Konsultasi 02")
    if first_room is None:
        first_room = Location(satusehat_location_id=SANDBOX_LOCATION if mock_references else None)
        db.add(first_room)
    if second_room is None:
        second_room = Location(satusehat_location_id=MOCK_SECOND_LOCATION if mock_references else None)
        db.add(second_room)
    for room, name in ((first_room, ROOM_ONE), (second_room, ROOM_TWO)):
        room.name = name
        room.poli = GENERAL_CLINIC
        room.service_type_code = GENERAL_PRACTICE_CODE
        room.service_type_display = GENERAL_PRACTICE_DISPLAY
    db.flush()

    accounts = [
        ("dokter", "james", "dr. James Pratama", "dokter", first_room.id, SANDBOX_PRACTITIONER),
        ("dokter_kemal", "kemal", "dr. Kemal Suhendra", "dokter", second_room.id, MOCK_SECOND_PRACTITIONER),
        ("perawat", "perawat", "Siti Rahmawati", "perawat", None, None),
        ("admin", "admin", "Admin Rekam Medis", "admin", None, None),
    ]
    for username, mailbox, name, role, location_id, mock_id in accounts:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            user = User(username=username, role=role, password_hash=hash_password(password))
            db.add(user)
        elif user.role != role:
            raise ValueError(f"Peran akun {username} tidak cocok dengan konfigurasi klinik.")
        user.name = name
        email = (user.email or "").lower()
        old_james_email = username == "dokter" and email == f"rian@{CLINIC_DOMAIN}"
        if not email or email.endswith("@rumahsakit.id") or old_james_email:
            user.email = f"{mailbox}@{CLINIC_DOMAIN}"
        if role == "dokter":
            if user.practitioner is None:
                user.practitioner = Practitioner(satusehat_id=mock_id if mock_references else None)
            user.practitioner.name = name
            user.practitioner.default_location_id = location_id
    db.flush()


def seed(db: Session, demo_password: str) -> None:
    if db.scalar(select(User).limit(1)):
        return
    configure_general_clinic(db, demo_password, mock_references=True)
    for i, (name, born, gender) in enumerate(DEMO_PATIENTS):
        db.add(Patient(name=name, rm_number=next_rm_number(db), birth_date=born, gender=gender,
                       ihs_number=SANDBOX_PATIENTS[i % 2]))
        db.flush()
    db.commit()


def seed_today_queue(db: Session) -> int:
    """Isi antrean hari ini dengan pasien demo (DEMO_PATIENTS) yang belum terdaftar hari ini."""
    assignments = db.execute(select(Practitioner.id, Location.id)
                             .join(Location, Practitioner.default_location_id == Location.id)
                             .order_by(Location.id, Practitioner.id)).all()
    if not assignments:
        loc = db.scalar(select(Location).order_by(Location.id.desc()))
        dr = db.scalar(select(Practitioner).order_by(Practitioner.id.desc()))
        if loc is None or dr is None:
            return 0
        assignments = [(dr.id, loc.id)]
    start = datetime.now(WIB).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    queued = set(db.scalars(select(Visit.patient_id).where(Visit.arrived_at >= start)))
    added = 0
    demo_names = [name for name, _, _ in DEMO_PATIENTS]
    for p in db.scalars(select(Patient).where(Patient.name.in_(demo_names)).order_by(Patient.id)):
        if p.id in queued:
            continue
        practitioner_id, location_id = assignments[added % len(assignments)]
        # Antrean demo dianggap sudah dikonfirmasi kedatangannya oleh petugas rekam medis.
        db.add(Visit(code=next_visit_code(db), patient_id=p.id, practitioner_id=practitioner_id,
                     location_id=location_id, queue_no=next_queue_no(db, location_id),
                     confirmed_at=datetime.now(timezone.utc),
                     visit_type="Kontrol"))
        db.flush()
        added += 1
    db.commit()
    return added
