# Limpieza de una auditoría fallida (datos + snapshot incompleto).
#   .venv/Scripts/python tools/cleanup_audit.py <audit_id>
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from forensics import db, SNAPSHOT_DIR

aid = int(sys.argv[1])
db.init_db()
for t in ("requests", "responses", "scripts", "endpoints", "findings",
          "evidence", "kg_flows", "changes", "snapshots", "reports"):
    db.q(f"DELETE FROM {t} WHERE audit_id=?", (aid,))
db.q("DELETE FROM audits WHERE id=?", (aid,))
for d in SNAPSHOT_DIR.iterdir():
    if d.is_dir() and not (d / "manifest.json").exists():
        shutil.rmtree(d, ignore_errors=True)
        print("snapshot incompleto eliminado:", d.name)
print(f"auditoría {aid} eliminada")
