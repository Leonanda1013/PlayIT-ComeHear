"""Ubah Bilik Konsultasi 01 menjadi Bilik 1 tanpa mengubah ID atau relasi."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Location  # noqa: E402


def main():
    changes = []
    with SessionLocal() as db:
        for room in db.scalars(select(Location).order_by(Location.id)):
            match = re.fullmatch(r"Bilik Konsultasi (\d+)", room.name)
            if match:
                old_name = room.name
                room.name = f"Bilik {int(match.group(1))}"
                changes.append((room.id, old_name, room.name))
        db.commit()
    for room_id, old_name, new_name in changes:
        print(f"Location {room_id}: {old_name} -> {new_name}")
    print(f"{len(changes)} nama bilik diperbarui.")


if __name__ == "__main__":
    main()
