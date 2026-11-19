"""Migrasi ringan: tambahkan kolom baru ke tabel lama tanpa menghapus data.

create_all() hanya membuat tabel yang belum ada; kolom yang ditambahkan ke model setelah tabel
dibuat harus ditambahkan manual. Cukup untuk prototipe; pindah ke Alembic bila skema makin sering berubah.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db import Base


def ensure_practitioner_default_location(engine: Engine) -> bool:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("practitioners") or not inspector.has_table("locations"):
            return False
        if any(col["name"] == "default_location_id" for col in inspector.get_columns("practitioners")):
            return False
        conn.execute(text("ALTER TABLE practitioners ADD COLUMN default_location_id INTEGER REFERENCES locations(id)"))
    return True


def add_missing_columns(engine: Engine) -> list[str]:
    added = ["practitioners.default_location_id"] if ensure_practitioner_default_location(engine) else []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing or (table.name, col.name) == ("practitioners", "default_location_id"):
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                try:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}'))
                    added.append(f"{table.name}.{col.name}")
                except Exception:
                    pass
    with engine.begin() as conn:
        if inspect(engine).has_table("consents"):
            conn.execute(text("UPDATE consents SET decision='setuju' WHERE decision IS NULL"))
        if inspect(engine).has_table("scribe_sessions"):
            conn.execute(text("UPDATE scribe_sessions SET next_chunk_seq=0 WHERE next_chunk_seq IS NULL"))
        if inspect(engine).has_table("satusehat_submissions"):
            conn.execute(text("UPDATE satusehat_submissions SET revision=1 WHERE revision IS NULL"))
    return added


def ensure_patient_nik_unique(engine: Engine) -> list[tuple[str, int]]:
    """Pasang indeks unik hanya setelah memastikan data lama tidak mengandung NIK ganda."""
    if not inspect(engine).has_table("patients"):
        return []
    with engine.begin() as conn:
        duplicates = [(str(nik), int(count)) for nik, count in conn.execute(text(
            "SELECT nik, COUNT(*) FROM patients WHERE nik IS NOT NULL AND nik <> '' "
            "GROUP BY nik HAVING COUNT(*) > 1"
        ))]
        if duplicates:
            return duplicates
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_nik_nonnull "
            "ON patients (nik) WHERE nik IS NOT NULL"
        ))
    return []
