"""Migrasi ringan untuk SQLite: tambahkan kolom baru ke tabel lama tanpa menghapus data.

create_all() hanya membuat tabel yang belum ada; kolom yang ditambahkan ke model setelah tabel
dibuat harus ditambahkan manual. Cukup untuk prototipe; pindah ke Alembic bila skema makin sering berubah.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db import Base


def add_missing_columns(engine: Engine) -> list[str]:
    added = []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                try:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}'))
                    added.append(f"{table.name}.{col.name}")
                except Exception:
                    pass
    return added
