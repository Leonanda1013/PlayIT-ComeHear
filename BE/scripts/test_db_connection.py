"""Skrip pengujian koneksi dan inisialisasi tabel di Supabase PostgreSQL."""
import sys
from pathlib import Path

# Pastikan BE dapat diimport
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.migrate import add_missing_columns  # noqa: E402
from app.seed import seed  # noqa: E402


def test_connection():
    settings = get_settings()
    print("=" * 60)
    print("1. MEMERIKSA KONEKSI KE DATABASE")
    print("=" * 60)
    # Mask password for display
    url = settings.database_url
    if "@" in url:
        prefix, at, host = url.partition("@")
        masked_prefix = prefix.split(":")[0] + ":****" if ":" in prefix else prefix
        display_url = f"{masked_prefix}@{host}"
    else:
        display_url = url
    print(f"Target URL: {display_url}")

    with engine.connect() as conn:
        ver = conn.execute(text("SELECT version();")).scalar()
        print(f"[OK] Berhasil terhubung ke database server!")
        print(f"[INFO] Engine version: {ver[:80]}...\n")

    print("=" * 60)
    print("2. MEMBUAT STRUKTUR TABEL & RELASI (DDL)")
    print("=" * 60)
    Base.metadata.create_all(engine)
    added = add_missing_columns(engine)
    if added:
        print(f"[INFO] Kolom ditambahkan: {', '.join(added)}")
    else:
        print("[OK] Seluruh tabel siap dan sinkron dengan model.")

    insp = inspect(engine)
    tables = insp.get_table_names()
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
    print("MIGRASI KE SUPABASE POSTGRESQL BERHASIL 100%!")
    print("=" * 60)


if __name__ == "__main__":
    test_connection()
