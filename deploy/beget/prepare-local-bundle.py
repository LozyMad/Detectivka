"""Snapshot local SQLite data and prepare a private bundle for the new Beget VPS."""
from pathlib import Path
from datetime import datetime
import json
import secrets
import shutil
import sqlite3
import tarfile


ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "deploy" / "beget" / "private"


def snapshot(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original:
        with sqlite3.connect(target) as copy:
            original.backup(copy)
            result = copy.execute("PRAGMA quick_check").fetchall()
            if result != [("ok",)]:
                raise RuntimeError(f"Integrity check failed for {source.name}")


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stage = PRIVATE / f"snapshot-{stamp}-{secrets.token_hex(3)}"
    stage.mkdir(parents=True)
    snapshot(ROOT / "backend" / "database.sqlite", stage / "backend" / "database.sqlite")
    sqlite_count = 1
    for source in (ROOT / "backend" / "data").rglob("*"):
        if not source.is_file():
            continue
        target = stage / source.relative_to(ROOT)
        if source.suffix == ".sqlite":
            snapshot(source, target)
            sqlite_count += 1
        elif not source.name.endswith(("-wal", "-shm", "-journal")):
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    if (ROOT / "backend" / "uploads").is_dir():
        shutil.copytree(ROOT / "backend" / "uploads", stage / "backend" / "uploads")
    env_text = (
        "NODE_ENV=production\nPORT=3000\nDB_TYPE=sqlite\n"
        f"JWT_SECRET={secrets.token_hex(32)}\n"
        f"DEPLOY_SECRET={secrets.token_hex(32)}\n"
    )
    env_path = stage / "backend" / ".env"
    env_path.write_text(env_text, encoding="utf-8")
    files = ["ecosystem.config.cjs", "nginx.conf", "set-admin-password.cjs"]
    for name in files:
        target = stage / "deploy" / "beget" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "deploy" / "beget" / name, target)
    archive = PRIVATE / f"detectivka-local-{stamp}-{secrets.token_hex(3)}.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        for source in sorted(stage.rglob("*")):
            if not source.is_file():
                continue
            info = bundle.gettarinfo(str(source), arcname=source.relative_to(stage).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o600 if source.name == ".env" else 0o644
            with source.open("rb") as file:
                bundle.addfile(info, file)
    with sqlite3.connect(stage / "backend" / "database.sqlite") as database:
        counts = {name: database.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                  for name in ("users", "scenarios", "rooms", "room_users")}
    with tarfile.open(archive, "r:gz") as bundle:
        names = bundle.getnames()
        required = ["backend/database.sqlite", "backend/.env", "deploy/beget/ecosystem.config.cjs"]
        if any(name not in names for name in required):
            raise RuntimeError("Incomplete deployment bundle")
        if any(name.startswith("/") or ".." in Path(name).parts for name in names):
            raise RuntimeError("Unsafe archive path")
    print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size,
                      "sqlite_snapshots": sqlite_count, "files": len(names), "counts": counts},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
