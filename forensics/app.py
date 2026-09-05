# Servidor del dashboard (Flask): API JSON + frontend estático.
import json
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
from flask import Flask, jsonify, request, send_file, send_from_directory, abort

from . import (db, ROOT, WEB_DIR, SNAPSHOT_DIR, EVIDENCE_DIR, REPORTS_DIR, DATA_DIR,
               now_iso, ts_tag, sha256_bytes, headers_safe)
from . import audit as audit_mod
from . import report as report_mod
from . import inventory as inventory_mod
from .engine import network_probe as np
from .engine.http import UA

app = Flask(__name__, static_folder=None)
app.config["JSON_AS_ASCII"] = False
_audit_lock = threading.Lock()
SERVER_CFG = {"port": 3792, "https_port": 0, "https_on": False, "host": "0.0.0.0"}


def set_server_cfg(port=None, https_port=None, https_on=None, host=None):
    """run.py publica aquí la configuración real de escucha (para /api/health)."""
    if port is not None:
        SERVER_CFG["port"] = port
    if https_port is not None:
        SERVER_CFG["https_port"] = https_port
    if https_on is not None:
        SERVER_CFG["https_on"] = bool(https_on)
    if host is not None:
        SERVER_CFG["host"] = host


@app.after_request
def _no_cache_frontend(resp):
    """Sin caché en HTML/JS/CSS para que la tablet reciba siempre la versión nueva."""
    p = request.path
    if p in ("/", "/index.html") or p.endswith((".js", ".css")):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp

KG_EVIDENCE_DIR = DATA_DIR / "kg_queries"
KG_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------- básico --
@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:fn>")
def static_web(fn):
    return send_from_directory(WEB_DIR, fn)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "db": str(db.DB_PATH),
                    "projects": db.q1("SELECT COUNT(*) c FROM projects")["c"],
                    "cfg": dict(SERVER_CFG)})


@app.get("/api/qr-digital")
def api_qr_digital():
    """Genera un QR PNG a partir del DNI (generación local; NO consulta PROAGRO).
    Uso: /api/qr-digital?dni=12345678  ·  ?dni=...&download=1 para guardar archivo."""
    dni = (request.args.get("dni") or "").strip()
    if not re.fullmatch(r"\d{8}", dni):
        return jsonify({"ok": False, "error": "DNI debe tener exactamente 8 dígitos"}), 400
    try:
        import qrcode
        from io import BytesIO as _IO
        qr = qrcode.QRCode(version=4, error_correction=qrcode.constants.ERROR_CORRECT_M,
                           box_size=10, border=3)
        qr.add_data(dni)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0d1117", back_color="#ffffff")
        buf = _IO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
    except Exception as e:
        return jsonify({"ok": False,
                        "error": "Generador QR no disponible en el servidor: %s" % e}), 503
    if request.args.get("download") == "1":
        return send_file(_IO(data), mimetype="image/png",
                         as_attachment=True, download_name=f"qr_{dni}.png")
    return send_file(_IO(data), mimetype="image/png")


# ------------------------------------------------------------- proyectos --
@app.get("/api/projects")
def projects():
    return jsonify({"projects": db.q("SELECT * FROM projects ORDER BY id")})


@app.post("/api/projects")
def project_create():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "PROAGRO").strip()
    url = (data.get("url") or "").strip()
    if not url:
        url = "https://digital.proagro.pe/QrKgAra/QrKgAra"
    try:
        pid = db.insert("projects", {"name": name, "url": url,
                                     "created_at": db.now_iso()})
    except Exception:
        # nombre duplicado: actualiza URL
        p = db.q1("SELECT id FROM projects WHERE name=?", (name,))
        db.update("projects", p["id"], {"url": url})
        pid = p["id"]
    return jsonify({"id": pid})


@app.post("/api/projects/<int:pid>/url")
def project_url(pid):
    data = request.get_json(force=True, silent=True) or {}
    db.update("projects", pid, {"url": (data.get("url") or "").strip()})
    return jsonify({"ok": True})


# -------------------------------------------------------------- auditorías --
@app.get("/api/audits")
def audits():
    pid = request.args.get("project_id", type=int)
    sql = "SELECT * FROM audits"
    par = []
    if pid:
        sql += " WHERE project_id=?"
        par.append(pid)
    sql += " ORDER BY id DESC LIMIT 40"
    return jsonify({"audits": db.q(sql, par)})


@app.post("/api/audits")
def audit_start():
    data = request.get_json(force=True, silent=True) or {}
    pid = data.get("project_id")
    if not pid:
        return jsonify({"error": "project_id requerido"}), 400
    running = db.q1("SELECT id FROM audits WHERE project_id=? AND status='running' "
                    "ORDER BY id DESC LIMIT 1", (pid,))
    if running:
        return jsonify({"error": "ya hay una auditoría en ejecución",
                        "running_id": running["id"]}), 409
    proj = db.q1("SELECT * FROM projects WHERE id=?", (pid,))
    if not proj:
        return jsonify({"error": "proyecto no existe"}), 404
    opts = {
        "browser": bool(data.get("browser", False)),
        "wait_ms": int(data.get("wait_ms", 12000)),
        "consistency_n": int(data.get("consistency_n", 5)),
        "fechaIni": data.get("fechaIni", "2026-09-01"),
        "fechaFin": data.get("fechaFin", "2026-09-03"),
        "top": int(data.get("top", 5000)),
    }
    aid = audit_mod.start_audit(pid, opts, project_url=proj["url"])
    return jsonify({"id": aid, "status": "running"})


@app.get("/api/audits/<int:aid>/status")
def audit_status(aid):
    st = audit_mod.audit_status(aid)
    if st is None:
        return jsonify({"error": "no existe"}), 404
    return jsonify(st)


@app.get("/api/audits/<int:aid>/summary")
def audit_summary(aid):
    a = db.q1("SELECT * FROM audits WHERE id=?", (aid,))
    if not a:
        return jsonify({"error": "no existe"}), 404
    summary = json.loads(a["summary_json"] or "{}")
    counts = {}
    for t in ("requests", "responses", "scripts", "endpoints", "findings",
              "evidence", "kg_flows", "changes", "reports"):
        counts[t] = db.q1(f"SELECT COUNT(*) c FROM {t} WHERE audit_id=?", (aid,))["c"]
    sev = db.q("SELECT severity, COUNT(*) c FROM findings WHERE audit_id=? GROUP BY severity",
               (aid,))
    kl = db.q("SELECT klass, COUNT(*) c FROM findings WHERE audit_id=? GROUP BY klass", (aid,))
    return jsonify({"audit": a, "summary": summary, "counts": counts,
                    "severity": {r["severity"]: r["c"] for r in sev},
                    "klass": {r["klass"]: r["c"] for r in kl}})


TABS = {
    "requests": "SELECT * FROM requests WHERE audit_id=? ORDER BY id DESC LIMIT 400",
    "responses": "SELECT * FROM responses WHERE audit_id=? ORDER BY id DESC LIMIT 200",
    "scripts": "SELECT * FROM scripts WHERE audit_id=? ORDER BY id",
    "endpoints": "SELECT * FROM endpoints WHERE audit_id=? ORDER BY "
                 "CASE classification WHEN 'OBSERVADO' THEN 0 WHEN 'REFERENCIADO' THEN 1 ELSE 2 END, path",
    "findings": "SELECT * FROM findings WHERE audit_id=? ORDER BY id",
    "kgflows": "SELECT * FROM kg_flows WHERE audit_id=? ORDER BY id",
    "changes": "SELECT * FROM changes WHERE audit_id=? ORDER BY id DESC",
    "evidence": "SELECT * FROM evidence WHERE audit_id=? ORDER BY id LIMIT 400",
    "reports": "SELECT * FROM reports WHERE audit_id=? ORDER BY id",
}


@app.get("/api/audits/<int:aid>/tab/<tab>")
def audit_tab(aid, tab):
    if tab not in TABS:
        return jsonify({"error": "tab inválido"}), 404
    return jsonify({"rows": db.q(TABS[tab], (aid,))})


ANALYSIS_FILES = ("js_analysis.json", "html_analysis.json", "endpoints.json",
                  "kg_integrity.json", "consistency.json", "comparison.json",
                  "date_windows.json", "error.json")


@app.get("/api/audits/<int:aid>/inventory")
def audit_inventory(aid):
    """Inventario forense estructurado de la auditoría (endpoints, funciones,
    formularios, QR, campos). Derivado solo de la evidencia guardada."""
    try:
        return jsonify(inventory_mod.build_inventory(aid))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/audits/<int:aid>/analysis/<fname>")
def audit_analysis(aid, fname):
    if fname not in ANALYSIS_FILES:
        return jsonify({"error": "archivo no permitido"}), 404
    snap = db.q1("SELECT dir FROM snapshots WHERE audit_id=? ORDER BY id DESC LIMIT 1", (aid,))
    if not snap:
        return jsonify({"error": "sin snapshot"}), 404
    fp = SNAPSHOT_DIR / snap["dir"] / "analysis" / fname
    if not fp.exists():
        return jsonify({"error": "no existe"}), 404
    import pathlib
    return send_file(pathlib.Path(fp), mimetype="application/json")


@app.get("/api/audits/<int:aid>/snapshot")
def audit_snapshot(aid):
    snap = db.q("SELECT * FROM snapshots WHERE audit_id=? ORDER BY id DESC LIMIT 1", (aid,))
    if not snap:
        return jsonify({"snapshot": None})
    man = json.loads(snap[0]["manifest_json"] or "[]")
    return jsonify({"snapshot": snap[0], "manifest": man})


# ------------------------------------------------------------- informes ----
@app.post("/api/audits/<int:aid>/report")
def audit_report(aid):
    data = request.get_json(force=True, silent=True) or {}
    try:
        res = report_mod.generate(aid, want_pdf=data.get("pdf", True))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(res)


@app.get("/api/audits/<int:aid>/report_latest")
def audit_report_latest(aid):
    rows = db.q("SELECT * FROM reports WHERE audit_id=? ORDER BY id", (aid,))
    return jsonify({"reports": rows})


# --------------------------------------------------- concurrencia opcional --
@app.post("/api/concurrency")
def concurrency():
    """Prueba de lectura opcional y controlada — SOLO por clic explícito."""
    data = request.get_json(force=True, silent=True) or {}
    pid = data.get("project_id")
    level = min(max(int(data.get("level", 3)), 1), 20)
    proj = db.q1("SELECT * FROM projects WHERE id=?", (pid,)) if pid else None
    if not proj:
        return jsonify({"error": "proyecto no existe"}), 404
    # se anexa a la última auditoría finalizada del proyecto
    last = db.q1("SELECT id FROM audits WHERE project_id=? AND status='done' "
                 "ORDER BY id DESC LIMIT 1", (pid,))
    url = np.ranking_url(proj["url"].split("/QrKgAra")[0],
                         top=5000, fechaIni="2026-09-01", fechaFin="2026-09-03")
    res = np.concurrency_run(url, level=level)
    if last:
        for r in res["results"]:
            db.insert("requests", {"audit_id": last["id"], "url": res["url"],
                                   "method": "GET", "status": r["status"],
                                   "content_type": "", "size": r["size"],
                                   "ttfb_ms": r["ttfb_ms"], "total_ms": r["total_ms"],
                                   "sha256": r["sha256"], "kind": "concurrency",
                                   "initiator": "manual", "error": r["error"],
                                   "created_at": db.now_iso()})
    return jsonify(res)


# --------------------------------------------------------------- archivos ---
SAFE_ROOTS = [ROOT]


@app.get("/api/files")
def api_files():
    rel = request.args.get("path", "")
    target = (ROOT / rel).resolve()
    if not any(str(target).startswith(str(r.resolve())) for r in SAFE_ROOTS):
        abort(403)
    if not target.exists():
        abort(404)
    return send_file(target, as_attachment=True)


# ================================================================ QR -> KG ==
# Endpoint REAL documentado por análisis de los bundles (inline_1.js de la web):
#   POST https://digital.proagro.pe/QrKgAra/ConsultarKgVista
#   body JSON: {"dni": "...", "fechaIni": "YYYY-MM-DD", "fechaFin": "YYYY-MM-DD"}
#   contentType: application/json; charset=utf-8
#   respuesta esperada: { encontrado: bool, nombre?, dias?: [{fecha?, detalle:
#       [{hora, variedad, kgExportable, kgDescarte, ...}] }] }
# Solo LECTURA. No crea/modifica/elimina nada en PROAGRO.

KG_ENDPOINT_PATH = "/QrKgAra/ConsultarKgVista"
_kg_session = None


def _kg_sess():
    global _kg_session
    if _kg_session is None:
        _kg_session = requests.Session()
        _kg_session.headers.update({
            "User-Agent": UA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "es-PE,es;q=0.9",
            "X-Requested-With": "XMLHttpRequest",
        })
    return _kg_session


def _kg_origin(project_url):
    sp = urlsplit(project_url or "")
    return f"{sp.scheme}://{sp.netloc}"


def summarize_kg_payload(data):
    """Resumen de la respuesta real de PROAGRO sin inventar campos."""
    out = {}
    if isinstance(data, dict):
        out["encontrado"] = data.get("encontrado")
        out["nombre"] = data.get("nombre")
        keys = sorted(data.keys())
        out["claves_respuesta"] = keys
    else:
        out["encontrado"] = None
        out["claves_respuesta"] = []
    nums = {"kgExportable": 0.0, "kgDescarte": 0.0, "kgTotal": 0.0}
    dias = []
    nreg = 0
    campos = {}
    d = data if isinstance(data, dict) else {}
    raw_dias = d.get("dias")
    if isinstance(raw_dias, list):
        for dia in raw_dias:
            det = dia.get("detalle") if isinstance(dia, dict) else None
            items = []
            n = 0
            if isinstance(det, list):
                for r in det[:120]:
                    nreg += 1
                    n += 1
                    if isinstance(r, dict):
                        for k in nums:
                            v = r.get(k)
                            if isinstance(v, (int, float)):
                                nums[k] += v
                        for k, v in list(r.items())[:30]:
                            if isinstance(v, (str, int, float)) and k not in campos:
                                campos[k] = str(v)[:100]
                        items.append({k: str(v)[:200] for k, v in list(r.items())[:16]})
            dias.append({
                "fecha": dia.get("fecha") if isinstance(dia, dict) else None,
                "registros": n,
                "items": items,
            })
    out["nums"] = {k: round(v, 2) for k, v in nums.items()}
    out["dias"] = dias
    out["registros"] = nreg
    out["campos_reales"] = campos
    return out


@app.post("/api/consultar-kg")
def api_consultar_kg():
    """Proxy de LECTURA: la tablet habla con ESTE servidor, y este servidor
    consulta el endpoint público real de PROAGRO con los parámetros exactos
    descubiertos en el análisis (POST ConsultarKgVista, JSON dni/fechaIni/fechaFin).
    Acepta {dni, fecha} (un día) o {dni, fechaIni, fechaFin} (rango ≤ 31 días)."""
    data = request.get_json(force=True, silent=True) or {}
    dni = str(data.get("dni") or "").strip()

    def norm_fecha(v):
        v = str(v or "").strip()
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", v)
        if m:
            v = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        return v if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else ""

    fecha = norm_fecha(data.get("fecha"))
    fecha_ini = norm_fecha(data.get("fechaIni"))
    fecha_fin = norm_fecha(data.get("fechaFin"))
    if not fecha and not (fecha_ini and fecha_fin):
        return jsonify({"ok": False, "estado": "VALIDACION",
                        "error": "Indica 'fecha' o el par 'fechaIni'/'fechaFin' (YYYY-MM-DD o DD/MM/YYYY)"}), 400
    if fecha:
        fecha_ini = fecha_fin = fecha
    if not re.fullmatch(r"\d{8}", dni):
        return jsonify({"ok": False, "estado": "VALIDACION",
                        "error": "El DNI debe tener exactamente 8 dígitos"}), 400
    if fecha_ini > fecha_fin:
        return jsonify({"ok": False, "estado": "VALIDACION",
                        "error": "fechaIni no puede ser posterior a fechaFin"}), 400
    import datetime
    try:
        span = (datetime.date.fromisoformat(fecha_fin) - datetime.date.fromisoformat(fecha_ini)).days
    except ValueError:
        return jsonify({"ok": False, "estado": "VALIDACION",
                        "error": "Fechas inválidas"}), 400
    if span > 31:
        return jsonify({"ok": False, "estado": "VALIDACION",
                        "error": "El rango máximo permitido es 31 días"}), 400

    proj = db.q1("SELECT * FROM projects ORDER BY id LIMIT 1")
    origin = _kg_origin(proj["url"] if proj else "")
    if not origin:
        return jsonify({"ok": False, "estado": "ERROR",
                        "error": "No hay proyecto con URL configurada"}), 400
    endpoint = origin + KG_ENDPOINT_PATH
    payload = {"dni": dni, "fechaIni": fecha_ini, "fechaFin": fecha_fin}
    meta = {"endpoint": endpoint, "method": "POST", "params": payload,
            "content_type_json": "application/json; charset=utf-8"}

    t0 = time.perf_counter()
    http_status = None
    body = b""
    resp_headers = {}
    error = None
    try:
        r = _kg_sess().post(endpoint, json=payload, timeout=(12, 45))
        http_status = r.status_code
        body = r.content[:2_000_000]
        resp_headers = headers_safe(dict(r.headers))
        elapsed = (time.perf_counter() - t0) * 1000.0
    except requests.exceptions.RequestException as e:
        elapsed = (time.perf_counter() - t0) * 1000.0
        error = str(e)

    sha = sha256_bytes(body) if body else ""
    raw_rel = ""
    if body:
        fname = f"{ts_tag()}_{dni}.json"
        (KG_EVIDENCE_DIR / fname).write_bytes(body)
        raw_rel = f"data/kg_queries/{fname}"

    parsed = None
    try:
        txt = body.decode("utf-8", errors="replace")
    except Exception:
        txt = ""
    if body and http_status is not None:
        try:
            parsed = summarize_kg_payload(json.loads(txt))
        except Exception:
            parsed = {"json_ok": False, "claves_respuesta": []}
    elif error:
        parsed = None

    if error:
        estado = "ERROR"
    elif http_status == 200:
        estado = ("OK" if (parsed or {}).get("encontrado") else "SIN_DATOS")
    else:
        estado = f"HTTP_{http_status}"

    nums = (parsed or {}).get("nums") or {}
    hist_fecha = fecha_fin if fecha_ini == fecha_fin else f"{fecha_ini} → {fecha_fin}"
    rid = db.insert("kg_queries", {
        "project_id": proj["id"] if proj else None,
        "dni": dni, "fecha": hist_fecha, "created_at": now_iso(),
        "endpoint": endpoint, "method": "POST",
        "http_status": http_status, "elapsed_ms": round(elapsed, 1),
        "estado": estado,
        "nombre": (parsed or {}).get("nombre") if isinstance(parsed, dict) else None,
        "kg_exportable": nums.get("kgExportable"),
        "kg_descarte": nums.get("kgDescarte"),
        "kg_total": nums.get("kgTotal"),
        "raw_path": raw_rel, "raw_sha256": sha,
        "request_json": json.dumps(payload, ensure_ascii=False),
        "response_preview": txt[:400],
        "error": (error or "")[:500],
    })

    out = {
        "ok": estado in ("OK", "SIN_DATOS"),
        "estado": estado, "id": rid,
        "consulta": {
            "dni": dni, "fecha": fecha_fin,
            "fechaIni": fecha_ini, "fechaFin": fecha_fin,
        },
        "resultado": parsed,
        "meta": {
            **meta, "http_status": http_status,
            "elapsed_ms": round(elapsed, 1),
            "content_type": resp_headers.get("Content-Type", ""),
            "headers": resp_headers,
            "sha256": sha, "raw_path": raw_rel,
            "error": error,
        },
        "raw_text": txt[:40000],
    }
    if error:
        return jsonify(out), 502
    return jsonify(out)


@app.get("/api/kg-queries")
def api_kg_history():
    rows = db.q("SELECT * FROM kg_queries ORDER BY id DESC LIMIT 200")
    return jsonify({"queries": rows})


@app.delete("/api/kg-queries")
def api_kg_history_clear():
    db.q("DELETE FROM kg_queries")
    return jsonify({"ok": True})


def make_app():
    db.init_db()
    return app
