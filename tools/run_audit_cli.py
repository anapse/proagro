# CLI de auditoría única — útil para ejecutar sin servidor y para pruebas.
#   .venv/Scripts/python tools/run_audit_cli.py [--no-browser] [--ini 2026-09-01] [--fin 2026-09-03]
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from forensics import db
from forensics.audit import start_audit, PROGRESS, DEFAULT_OPTIONS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", action="store_true",
                    help="capturar con Chromium (red + errores de consola)")
    ap.add_argument("--ini", default=DEFAULT_OPTIONS["fechaIni"])
    ap.add_argument("--fin", default=DEFAULT_OPTIONS["fechaFin"])
    ap.add_argument("--top", type=int, default=DEFAULT_OPTIONS["top"])
    ap.add_argument("--cons", type=int, default=DEFAULT_OPTIONS["consistency_n"])
    args = ap.parse_args()

    db.init_db()
    proj = db.project_default()
    opts = {"browser": args.browser, "fechaIni": args.ini, "fechaFin": args.fin,
            "top": args.top, "consistency_n": args.cons}
    print(f"Proyecto: {proj['name']} — {proj['url']}")
    print(f"Opciones: {opts}")
    aid = start_audit(proj["id"], opts, project_url=proj["url"])
    print(f"Auditoría #{aid} iniciada — esperando…")
    t0 = time.time()
    while time.time() - t0 < 900:
        p = PROGRESS.get(aid)
        row = db.q1("SELECT status, error FROM audits WHERE id=?", (aid,))
        if p:
            sys.stdout.write(f"\r[{p.get('step') or ''}] {p.get('detail') or ''}   ")
            sys.stdout.flush()
        if row and row["status"] in ("done", "error"):
            print()
            if row["status"] == "error":
                print("ERROR:", row["error"])
                print("\n".join((p or {}).get("log", [])[-25:]))
                sys.exit(1)
            print(f"AUDITORÍA #{aid} COMPLETADA")
            print("\n".join((p or {}).get("log", [])[-18:]))
            return aid
        time.sleep(2)
    print("timeout esperando la auditoría")
    sys.exit(2)


if __name__ == "__main__":
    main()
