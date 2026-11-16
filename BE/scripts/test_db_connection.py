"""Periksa skema Supabase; inisialisasi hanya bila tanpa --inspect-only."""
import argparse
import sys
from pathlib import Path

# Pastikan BE dapat diimport
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.migrate import add_missing_columns, ensure_patient_nik_unique  # noqa: E402
from app.seed import seed  # noqa: E402


def schema_gaps():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing_tables = [table.name for table in Base.metadata.sorted_tables
                      if table.name not in existing_tables]
    missing_columns = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        actual_columns = {column["name"] for column in inspector.get_columns(table.name)}
        missing_columns.extend(f"{table.name}.{column.name}" for column in table.columns
                               if column.name not in actual_columns)
    return missing_tables, missing_columns


def patient_nik_integrity():
    inspector = inspect(engine)
    if "patients" not in inspector.get_table_names():
        return [], False
    with engine.connect() as conn:
        duplicates = list(conn.execute(text(
            "SELECT nik, COUNT(*) FROM patients WHERE nik IS NOT NULL AND nik <> '' "
            "GROUP BY nik HAVING COUNT(*) > 1"
        )))
    indexes = inspector.get_indexes("patients")
    constraints = inspector.get_unique_constraints("patients")
    unique = any(index.get("unique") and index.get("column_names") == ["nik"] for index in indexes)
    unique = unique or any(item.get("column_names") == ["nik"] for item in constraints)
    return duplicates, unique


def check_connection(inspect_only: bool = False):
    settings = get_settings()
    if not settings.database_url.startswith(("postgresql://", "postgresql+psycopg2://", "postgres://")):
        raise SystemExit("DATABASE_URL harus menunjuk ke PostgreSQL Supabase, bukan SQLite.")
    print("=" * 60)
    print("1. MEMERIKSA KONEKSI KE DATABASE")
    print("=" * 60)
    print(f"Target URL: {make_url(settings.database_url).render_as_string(hide_password=True)}")

    with engine.connect() as conn:
        ver = conn.execute(text("SELECT version();")).scalar()
        print(f"[OK] Berhasil terhubung ke database server!")
        print(f"[INFO] Engine version: {ver[:80]}...\n")

    missing_tables, missing_columns = schema_gaps()
    duplicate_niks, nik_unique = patient_nik_integrity()
    print(f"Tabel belum ada: {', '.join(missing_tables) or 'tidak ada'}")
    print(f"Kolom belum ada: {', '.join(missing_columns) or 'tidak ada'}")
    print(f"NIK ganda: {len(duplicate_niks)} nilai")
    print(f"Constraint/index unik NIK: {'ada' if nik_unique else 'belum ada'}")
    if inspect_only:
        print("Mode inspeksi: database tidak diubah.")
        return

    print("=" * 60)
    print("2. MEMBUAT STRUKTUR TABEL & RELASI (DDL)")
    print("=" * 60)
    Base.metadata.create_all(engine)
    added = add_missing_columns(engine)
    if added:
        print(f"[INFO] Kolom ditambahkan: {', '.join(added)}")
    else:
        print("[OK] Seluruh tabel siap dan sinkron dengan model.")
    duplicate_niks = ensure_patient_nik_unique(engine)
    if duplicate_niks:
        masked = [f"****{str(nik)[-4:]} ({count} data)" for nik, count in duplicate_niks]
        raise RuntimeError("NIK ganda harus ditinjau sebelum indeks unik dipasang: " + ", ".join(masked))

    insp = inspect(engine)
    tables = insp.get_table_names()
    missing_tables, missing_columns = schema_gaps()
    if missing_tables or missing_columns:
        raise RuntimeError(f"Skema database belum lengkap: tabel={missing_tables}, kolom={missing_columns}")
    print(f"[OK] Total {len(tables)} tabel terdeteksi di database: {', '.join(tables)}\n")

    print("=" * 60)
    print("3. MEMERIKSA & MENGEKSEKUSI SEED DATA MASTER")
    print("=" * 60)
    with SessionLocal() as db:
        seed(db, settings.demo_password)
        print("[OK] Seed data berhasil diproses.")

    print("\n" + "=" * 60)
    print("4. JUMLAH DATA PER TABEL SAAT INI")
    print("=" * 60)
    with engine.connect() as conn:
        for t in sorted(tables):
            try:
                cnt = conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar()
                print(f"  - {t:<26} : {cnt} baris")
            except Exception as e:
                print(f"  - {t:<26} : Gagal menghitung ({e})")

    print("\n" + "=" * 60)
    print("KONEKSI, SKEMA, DAN SEED SUPABASE POSTGRESQL BERHASIL DIPERIKSA")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect-only", action="store_true", help="Cek koneksi dan skema tanpa mengubah data")
    check_connection(parser.parse_args().inspect_only)
