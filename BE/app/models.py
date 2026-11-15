"""Model data SIM ComeHear.

Mengikuti Rancangan Integrasi Backend SIM: satu kunjungan -> satu sesi scribe ->
satu catatan klinis yang disetujui dokter -> satu atau lebih pengiriman (outbox) ke SATUSEHAT.
"""
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite mengembalikan datetime tanpa zona; anggap selalu UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class Practitioner(Base):
    __tablename__ = "practitioners"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    nik: Mapped[str | None] = mapped_column(String(16))
    satusehat_id: Mapped[str | None] = mapped_column(String(64))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # dokter | perawat | admin
    password_hash: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(120))
    practitioner_id: Mapped[int | None] = mapped_column(ForeignKey("practitioners.id"))
    practitioner: Mapped[Practitioner | None] = relationship()


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    rm_number: Mapped[str | None] = mapped_column(String(20))  # nomor rekam medis fasilitas
    nik: Mapped[str | None] = mapped_column(String(16))
    birth_date: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(10))  # male | female
    # Nomor IHS berbentuk teks (P0...), dicari sekali lewat NIK lalu disimpan.
    ihs_number: Mapped[str | None] = mapped_column(String(32))
    ihs_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(255))


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))          # mis. "Bilik Konsultasi 03"
    poli: Mapped[str | None] = mapped_column(String(120))   # mis. "Poli Penyakit Dalam"
    satusehat_location_id: Mapped[str | None] = mapped_column(String(64))
    service_type_code: Mapped[str] = mapped_column(String(32), default="394537008")
    service_type_display: Mapped[str] = mapped_column(String(80), default="Pediatrics")


class Visit(Base):
    __tablename__ = "visits"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Identifier Encounter: unik dan stabil, dipakai untuk rekonsiliasi saat respons hilang.
    code: Mapped[str] = mapped_column(String(40), unique=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    practitioner_id: Mapped[int] = mapped_column(ForeignKey("practitioners.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    queue_no: Mapped[int | None] = mapped_column(Integer)
    called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # registered -> consented | manual -> processing -> draft -> approved
    status: Mapped[str] = mapped_column(String(20), default="registered")
    arrived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    satusehat_encounter_id: Mapped[str | None] = mapped_column(String(64))
    # Diisi petugas rekam medis: Terjadwal -> (konfirmasi kedatangan) -> Menunggu Pemeriksaan.
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visit_type: Mapped[str | None] = mapped_column(String(20))  # Baru | Kontrol
    admin_note: Mapped[str | None] = mapped_column(Text)

    patient: Mapped[Patient] = relationship()
    practitioner: Mapped[Practitioner] = relationship()
    location: Mapped[Location] = relationship()
    consent: Mapped["Consent | None"] = relationship(back_populates="visit", uselist=False)
    scribe_sessions: Mapped[list["ScribeSession"]] = relationship(
        back_populates="visit", order_by="ScribeSession.id")
    note: Mapped["ClinicalNote | None"] = relationship(back_populates="visit", uselist=False)
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="visit", order_by="Submission.id")

    @property
    def latest_session(self) -> "ScribeSession | None":
        return self.scribe_sessions[-1] if self.scribe_sessions else None

    @property
    def latest_submission(self) -> "Submission | None":
        return self.submissions[-1] if self.submissions else None


class Consent(Base):
    """Persetujuan eksplisit sebelum merekam (UU PDP Pasal 20; pasien anak lewat orang tua/wali)."""
    __tablename__ = "consents"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    given_by_name: Mapped[str] = mapped_column(String(120))
    relation: Mapped[str] = mapped_column(String(40))  # pasien | ibu | ayah | wali
    text_version: Mapped[str] = mapped_column(String(20))
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    visit: Mapped[Visit] = relationship(back_populates="consent")


class ScribeSession(Base):
    __tablename__ = "scribe_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    audio_path: Mapped[str | None] = mapped_column(String(300))
    audio_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # queued -> transcribing -> labeling -> extracting -> coding -> done | failed
    status: Mapped[str] = mapped_column(String(20), default="queued")
    error: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[list | None] = mapped_column(JSON)   # [{i, start, end, speaker, text}]
    extraction: Mapped[dict | None] = mapped_column(JSON)   # SubjectiveExtraction
    icd_suggestions: Mapped[list | None] = mapped_column(JSON)
    model_info: Mapped[dict | None] = mapped_column(JSON)
    timings: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visit: Mapped[Visit] = relationship(back_populates="scribe_sessions")


class ClinicalNote(Base):
    """Catatan SOAP. S dari scribe (disunting dokter); O, A, P diisi dokter."""
    __tablename__ = "clinical_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    subjective: Mapped[dict] = mapped_column(JSON, default=dict)      # field_key -> text
    subjective_summary: Mapped[str] = mapped_column(Text, default="")
    allergies: Mapped[list] = mapped_column(JSON, default=list)
    vitals: Mapped[dict] = mapped_column(JSON, default=dict)          # type -> value
    exam_text: Mapped[str] = mapped_column(Text, default="")
    diagnoses: Mapped[list] = mapped_column(JSON, default=list)       # [{code, display, rank, source}]
    assessment: Mapped[str] = mapped_column(Text, default="")
    prescriptions: Mapped[list] = mapped_column(JSON, default=list)
    plan_text: Mapped[str] = mapped_column(Text, default="")
    # Isian layar O-A-P yang tidak dikirim ke SATUSEHAT di MVP: gcs, kesadaran, lingkar_perut,
    # alergi, instruksi (Inst/Impl), evaluasi.
    extra: Mapped[dict | None] = mapped_column(JSON, default=dict)
    # Snapshot beku saat disetujui; bundle selalu dibangun dari sini.
    approved_snapshot: Mapped[dict | None] = mapped_column(JSON)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    visit: Mapped[Visit] = relationship(back_populates="note")


class ReviewEdit(Base):
    """Nilai AI vs nilai akhir dokter per isian: bahan rasio koreksi (target <= 20%) dan F1."""
    __tablename__ = "review_edits"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    field_key: Mapped[str] = mapped_column(String(60))
    ai_value: Mapped[str | None] = mapped_column(Text)
    final_value: Mapped[str | None] = mapped_column(Text)
    changed: Mapped[bool] = mapped_column(default=False)
    edited_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Submission(Base):
    """Outbox pengiriman bundle ke SATUSEHAT."""
    __tablename__ = "satusehat_submissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    idempotency_key: Mapped[str] = mapped_column(String(80), unique=True)
    bundle: Mapped[dict] = mapped_column(JSON)  # disimpan persis seperti dikirim
    # QUEUED | SENDING | SENT | RETRY_WAIT | NEEDS_ATTENTION | RECONCILING
    status: Mapped[str] = mapped_column(String(20), default="QUEUED")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error_code: Mapped[str | None] = mapped_column(String(40))
    last_error_text: Mapped[str | None] = mapped_column(Text)
    response: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visit: Mapped[Visit] = relationship(back_populates="submissions")
    resources: Mapped[list["ResourceMap"]] = relationship(
        back_populates="submission", order_by="ResourceMap.entry_index")


class ResourceMap(Base):
    __tablename__ = "satusehat_resource_map"
    __table_args__ = (UniqueConstraint("submission_id", "entry_index"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("satusehat_submissions.id"))
    entry_index: Mapped[int] = mapped_column(Integer)
    full_url: Mapped[str] = mapped_column(String(80))
    resource_type: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[str | None] = mapped_column(String(64))
    submission: Mapped[Submission] = relationship(back_populates="resources")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(40))
    obj: Mapped[str] = mapped_column(String(60))
    summary: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
