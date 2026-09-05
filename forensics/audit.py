# Orquestador de auditoría forense read-only.
# Flujo: HTML -> JS -> endpoints -> sondas GET seguras -> ranking -> fechas ->
# consistencia -> errores -> (opcional navegador) -> comparación -> snapshot.
import json
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit

from . import (
    db, now_iso, ts_tag, sha256_bytes, save_json, load_json, safe_name,
    SNAPSHOT_DIR, JAVASCRIPT_DIR, REPORTS_DIR,
)
from .engine import http, html_analyzer, js_scanner
from .engine import endpoints as epmod
from .engine import network_probe as np
from .engine import silent as silent_mod
from .engine import signalr as sigmod
from .engine import kg as kgmod

MAX_REQUESTS = 60          # tope de volumen por auditoría (read-only)
MAX_SCRIPTS = 40
DEFAULT_OPTIONS = {
    "browser": False,
    "wait_ms": 12000,
    "consistency_n": 5,
    "fechaIni": "2026-09-01",
    "fechaFin": "2026-09-03",
    "top": 5000,
}

PROGRESS = {}
_lock = threading.Lock()


def start_audit(project_id, options=None, project_url=None):
    """Crea la fila de auditoría y lanza el trabajador en segundo plano."""
    opts = {**DEFAULT_OPTIONS, **(options or {})}
    aid = db.insert("audits", {
        "project_id": project_id, "started_at": now_iso(), "status": "running",
        "mode": "read-only-GET" + ("+browser" if opts.get("browser") else ""),
        "options_json": json.dumps(opts, ensure_ascii=False),
    })
    PROGRESS[aid] = {"step": "inicio", "detail": "", "log": [], "error": None}
    t = threading.Thread(target=_worker, args=(aid, project_id, opts, project_url),
                         daemon=True, name=f"audit-{aid}")
    t.start()
    return aid


def audit_status(aid):
    p = PROGRESS.get(aid)
    row = db.q1("SELECT status, finished_at, error FROM audits WHERE id=?", (aid,))
    if not row:
        return None
    return {
        "status": row["status"], "finished_at": row["finished_at"],
        "error": row["error"],
        "progress": (p or {}).get("step"), "detail": (p or {}).get("detail"),
        "log": (p or {}).get("log", [])[-60:],
    }


def _log(aid, msg, detail=None):
    with _lock:
        p = PROGRESS.setdefault(aid, {"step": "", "detail": "", "log": [], "error": None})
        p["log"].append(f"[{time.strftime('%H:%M:%S')}] {msg}")
        if detail:
            p["detail"] = detail
        if len(p["log"]) > 500:
            p["log"] = p["log"][-300:]


def _worker(aid, project_id, opts, project_url):
    ctx = None
    try:
        proj = db.q1("SELECT * FROM projects WHERE id=?", (project_id,))
        base = (project_url or proj["url"] or "").rstrip("/")
        _log(aid, f"auditoría {aid} iniciada sobre {base}")
        ctx = SnapshotCtx(aid, base)
        summary = run_steps(aid, ctx, base, opts)
        db.update("audits", aid, {
            "status": "done", "finished_at": now_iso(),
            "summary_json": json.dumps(summary, ensure_ascii=False, default=str),
        })
        ctx.log(f"AUDITORÍA COMPLETADA en {summary.get('elapsed_s')}s — "
                f"{summary.get('requests')} peticiones, {summary.get('findings')} hallazgos")
        ctx.log_flush()
    except Exception as e:
        tb = traceback.format_exc()
        db.update("audits", aid, {"status": "error", "error": str(e)[:2000],
                                  "finished_at": now_iso()})
        with _lock:
            p = PROGRESS.setdefault(aid, {})
            p["error"] = str(e)
            p["log"].append(f"[{time.strftime('%H:%M:%S')}] ERROR: {e}")
            p["log"].append(tb[-3000:])
        if ctx:
            ctx.log(f"ERROR: {e}\n{tb[-2000:]}")
            ctx.log_flush()
    finally:
        if ctx:
            try:
                ctx.finalize_manifest()
            except Exception:
                pass


class SnapshotCtx:
    """Directorio snapshot YYYY-MM-DD_HH-MM-SS + manifiesto de evidencia."""

    def __init__(self, aid, base):
        self.aid = aid
        self.base = base
        from urllib.parse import urlsplit
        sp = urlsplit(base)
        self.origin = f"{sp.scheme}://{sp.netloc}"
        self.tag = ts_tag()
        self.root = SNAPSHOT_DIR / self.tag
        for sub in ("html", "javascript", "responses", "headers", "network", "logs", "analysis"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self.manifest = []
        self.req_count = 0
        self.vol_ok = True
        self._closed = False
        self.logf = open(self.root / "logs" / "audit.log", "a", encoding="utf-8")
        self._write("logs/audit.log", f"AUDITORÍA {aid} — {now_iso()} — {base}\n",
                    url=base, cat="logs")
        self.log(f"snapshot: {self.root}")

    # ---- utilidades ------------------------------------------------
    def log(self, msg):
        _log(self.aid, msg)
        self.logf.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        self.logf.flush()

    def log_flush(self):
        if not self._closed:
            self._closed = True
            self.logf.flush()
            self.logf.close()

    def adopt_external(self, rel, url=None, cat="responses"):
        """Registra en manifiesto+BD un archivo ya escrito fuera de ctx (p. ej. Playwright)."""
        fp = self.root / rel
        if not fp.exists():
            return
        raw = fp.read_bytes()
        sha = sha256_bytes(raw)
        self.manifest.append({"rel": rel.replace("\\", "/"), "sha256": sha, "size": len(raw)})
        db.insert("evidence", {
            "audit_id": self.aid, "category": cat, "filename": fp.name,
            "url": url or "", "sha256": sha, "size": len(raw),
            "path": rel.replace("\\", "/"), "created_at": now_iso(),
        })

    def _write(self, rel, data, url=None, cat="analysis"):
        fp = self.root / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            fp.write_text(data, encoding="utf-8")
            raw = data.encode("utf-8")
        else:
            fp.write_bytes(data)
            raw = data
        relp = fp.relative_to(self.root).as_posix()
        sha = sha256_bytes(raw)
        self.manifest.append({"rel": relp, "sha256": sha, "size": len(raw)})
        db.insert("evidence", {
            "audit_id": self.aid, "category": cat, "filename": fp.name,
            "url": url or "", "sha256": sha, "size": len(raw),
            "path": relp, "created_at": now_iso(),
        })
        return fp

    def write_text(self, rel, text, url=None, cat="analysis"):
        return self._write(rel, text, url, cat)

    def write_bytes(self, rel, data, url=None, cat="evidence"):
        return self._write(rel, data, url, cat)

    def add_request(self, url, method, status, headers, body, ttfb, total,
                    error, kind="other", initiator=None, seq=None):
        """Registra petición + guarda respuesta JSON/HTML como evidencia."""
        rid = db.insert("requests", {
            "audit_id": self.aid, "url": url, "method": method,
            "status": status, "content_type": (headers or {}).get("Content-Type", ""),
            "size": len(body) if body is not None else 0,
            "ttfb_ms": round(ttfb, 1) if ttfb else None,
            "total_ms": round(total, 1) if total else None,
            "sha256": sha256_bytes(body) if body else None,
            "kind": kind, "initiator": initiator, "error": error,
            "created_at": now_iso(),
        })
        self.req_count += 1
        if body is not None and body and not error:
            self._save_body(rid, url, status, body, kind)
        return rid

    def _save_body(self, rid, url, status, body, kind):
        try:
            txt = body.decode("utf-8", errors="replace")
        except Exception:
            txt = ""
        is_json = txt.lstrip()[:1] in ("{", "[")
        if not (is_json or kind == "document" or status != 200):
            return
        seq = self.req_count
        name = f"r{seq:03d}"
        if is_json:
            rel = f"responses/{name}.json"
        else:
            rel = f"html/{name}.html"
        self._write(rel, body, url=url, cat="responses" if is_json else "html")
        structure = None
        records = None
        metrics = None
        if is_json:
            structure, records, metrics = summarize_json(txt, url)
        db.insert("responses", {
            "audit_id": self.aid, "request_id": rid, "url": url,
            "http_status": status, "body_path": rel,
            "body_preview": txt[:300],
            "record_count": records,
            "sha256": sha256_bytes(body),
            "structure_json": json.dumps(structure, ensure_ascii=False) if structure else None,
            "metrics_json": json.dumps(metrics, ensure_ascii=False, default=str) if metrics else None,
        })

    def finalize_manifest(self):
        self.log_flush()
        man = self.root / "manifest.json"
        man.write_text(json.dumps(self.manifest, indent=1), encoding="utf-8")
        db.insert("snapshots", {
            "audit_id": self.aid, "dir": self.tag,
            "created_at": now_iso(),
            "manifest_json": json.dumps(self.manifest, ensure_ascii=False),
        })


def summarize_json(txt, url):
    try:
        data = json.loads(txt)
    except Exception:
        return {"keys": None, "error": "json inválido"}, None, None
    structure = {"keys": sorted(data.keys()) if isinstance(data, dict) else "lista-raiz"}
    arrays = {}
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, list):
                arrays[k] = len(v)
    elif isinstance(data, list):
        arrays["(root)"] = len(data)
    structure["arrays"] = arrays
    records = None
    for k in ("ranking", "data", "rows", "resultado", "results", "registros"):
        if k in arrays:
            records = arrays[k]
            break
    if records is None and isinstance(data, list):
        records = len(data)
    metrics = None
    if "ObtenerRankingVista" in url or "ranking" in str(structure.get("keys", "")).lower():
        try:
            m = np.parse_ranking(txt.encode("utf-8"))
            metrics = {k: m[k] for k in ("records", "sum_kgExportable", "sum_kgDescarte",
                                         "sum_kgTotal", "ordering_violations") if k in m}
        except Exception:
            metrics = None
    return structure, records, metrics


def run_steps(aid, ctx, base, opts):
    t_start = time.perf_counter()
    origin = ctx.origin
    ctx.log("paso 1/12 — descarga HTML principal")
    p = http.get(base)
    ctx.add_request(base, "GET", p.status, p.headers, p.body if (p.status == 200 and not p.error and not p.truncated) else None,
                    p.ttfb_ms, p.total_ms, p.error, kind="document")
    html_text = ""
    if p.status == 200 and not p.error:
        html_text = p.body.decode("utf-8", errors="replace")
        ctx.write_bytes("html/index.html", p.body, url=base, cat="html")
        hdr = {"url": base, "status": p.status,
               "headers": p.headers, "fetched_at": now_iso()}
        ctx.write_text("headers/index.json", json.dumps(hdr, indent=1, ensure_ascii=False),
                       url=base, cat="headers")
        finding(aid, ctx, "F-01", "HECHO OBSERVADO", "INFO", "PAGE_OK",
                "Página principal accesible",
                f"GET {base} → HTTP {p.status} ({len(p.body)} bytes, TTFB {p.ttfb_ms:.0f} ms). "
                f"Servidor: {p.headers.get('Server')} — {p.headers.get('X-Powered-By')}.",
                evidence=f"sha256 {p.sha256}", file="index.html", endpoint=base,
                confidence="alta")
    elif p.error:
        finding(aid, ctx, "F-01", "HECHO OBSERVADO", "HIGH", "PAGE_UNREACHABLE",
                "No se pudo acceder a la página", f"{p.error}", confidence="alta")
        ctx.write_text("analysis/error.json", json.dumps(p.__dict__, default=str))
        raise RuntimeError(f"Página inaccesible: {p.error}")

    # ---- análisis HTML --------------------------------------------------
    ctx.log("paso 2/12 — análisis HTML (recursos, formularios, endpoints)")
    ha = html_analyzer.analyze_html(html_text, base)
    ctx.write_text("analysis/html_analysis.json",
                   json.dumps(ha.to_dict(), indent=1, ensure_ascii=False), url=base)
    screens = kgmod.find_screens(html_text)
    ctx.log(f"pantallas detectadas en HTML: {[s['screen'] for s in screens] or 'ninguna'}")

    # ---- descarga de JavaScript -----------------------------------------
    ctx.log("paso 3/12 — descarga de JavaScript")
    js_files = []            # [{name,url,text,path,sha}]
    externals = ha.scripts_external[:MAX_SCRIPTS]
    for i, sc in enumerate(externals, 1):
        absu = sc["abs"]
        if not ctx.vol_ok or ctx.req_count >= MAX_REQUESTS:
            ctx.vol_ok = False
            break
        if absu.split("//", 1)[-1].split("/")[0] not in ("digital.proagro.pe",) \
                and ".proagro.pe" not in absu:
            if not absu.startswith(base.split("/QrKgAra")[0]):
                pass  # CDN externo: solo registrar métrica sin cuerpo grande
        ctx.log(f"descargando script {i}/{len(externals)}: {absu}")
        sp = http.get(absu, timeout=(10, 50))
        saved = None
        if sp.status == 200 and not sp.error and sp.body:
            base_name = safe_name(Path(urlsplit(absu).path).name or "bundle.js")
            name = f"{i:02d}_{base_name}"
            fp = ctx.write_bytes(f"javascript/{name}", sp.body, url=absu, cat="javascript")
            saved = fp
            # copia persistente en /evidence/javascript (con prefijo sha8)
            persist = JAVASCRIPT_DIR / f"{sp.sha256[:8]}_{base_name}"
            if not persist.exists():
                persist.write_bytes(sp.body)
            js_files.append({
                "name": base_name, "url": absu,
                "text": sp.body.decode("utf-8", errors="replace"),
                "path": f"javascript/{name}", "sha": sp.sha256, "size": len(sp.body),
                "status": sp.status,
            })
        ctx.add_request(absu, "GET", sp.status, sp.headers,
                        sp.body if (sp.status == 200 and not sp.error and saved is None) else None,
                        sp.ttfb_ms, sp.total_ms, sp.error, kind="script")
        db.insert("scripts", {
            "audit_id": aid, "url": absu,
            "name": safe_name(Path(urlsplit(absu).path).name or "bundle.js"),
            "kind": "external", "size": len(sp.body) if sp.body else 0,
            "sha256": sp.sha256 if sp.body else "",
            "downloaded_at": now_iso(),
            "path": (saved.relative_to(SNAPSHOT_DIR).as_posix() if saved else ""),
            "status": str(sp.status), "error": sp.error,
        })
        if sp.status != 200:
            finding(aid, ctx, None, "HECHO OBSERVADO", "LOW", "HTTP_ERROR",
                    f"Script no descargable: {sp.status}",
                    f"{absu} → HTTP {sp.status} {sp.error or ''}", file=absu,
                    endpoint=absu, confidence="alta")

    # scripts inline del HTML
    for i, txt in enumerate(ha.inline_scripts[:10], 1):
        if len(txt) > 2_000_000:
            txt = txt[:2_000_000]
        fp = ctx.write_bytes(f"javascript/inline_{i}.js", txt.encode("utf-8"),
                             url=f"{base}#inline{i}", cat="javascript")
        db.insert("scripts", {"audit_id": aid, "url": f"{base}#inline{i}",
                              "name": f"inline_{i}.js", "kind": "inline",
                              "size": len(txt), "sha256": sha256_bytes(txt.encode()),
                              "downloaded_at": now_iso(),
                              "path": f"javascript/inline_{i}.js",
                              "status": "200", "error": ""})
        js_files.append({"name": f"inline_{i}.js", "url": f"{base}#inline{i}",
                         "text": txt, "path": f"javascript/inline_{i}.js",
                         "sha": sha256_bytes(txt.encode()), "size": len(txt),
                         "status": 200})

    ctx.log(f"javascript analizado: {len(js_files)} archivos")

    # ---- análisis de bundles --------------------------------------------
    ctx.log("paso 4/12 — análisis de código JavaScript")
    scans = []
    silent_cands = []
    sig_results = []
    for f in js_files:
        scan = js_scanner.scan_js(f["text"], f["url"])
        scans.append({"file": f["url"], "name": f["name"],
                      **scan.to_dict()})
        for s in silent_mod.scan_silent_patterns(f["text"], f["url"]):
            silent_cands.append(s)
        sig = sigmod.analyze(f["text"], f["url"])
        if sig["present"]:
            sig_results.append({"file": f["url"], **sig})
    ctx.write_text("analysis/js_analysis.json",
                   json.dumps(scans, indent=1, ensure_ascii=False))

    # ---- SignalR / hubs --------------------------------------------------
    ctx.log("paso 5/12 — análisis SignalR / WebSocket")
    hub_urls = []
    for s in scans:
        hub_urls += s.get("signalr", {}).get("hub_urls", []) or []
    hub_urls = list(dict.fromkeys(hub_urls))
    ws_found = [w for s in scans for w in s.get("websockets", [])]
    if hub_urls:
        ctx.log(f"hub(s) de SignalR referenciados: {hub_urls}")
    for h in hub_urls[:1]:
        if h.startswith("/"):
            u = origin + h
            sp = http.get(u, timeout=(10, 30))
            ctx.add_request(u, "GET", sp.status, sp.headers,
                            sp.body if (sp.status == 200 and not sp.error) else None,
                            sp.ttfb_ms, sp.total_ms, sp.error, kind="script")
            if sp.status == 200 and sp.body and not sp.error:
                txt = sp.body.decode("utf-8", errors="replace")
                db.insert("scripts", {"audit_id": aid, "url": u,
                                      "name": "signalr_hubs.js", "kind": "hub",
                                      "size": len(sp.body),
                                      "sha256": sp.sha256, "downloaded_at": now_iso(),
                                      "path": "javascript/signalr_hubs.js",
                                      "status": "200", "error": ""})
                ctx.write_bytes("javascript/signalr_hubs.js", sp.body, url=u)
                sig = sigmod.analyze(txt, u)
                if sig["present"]:
                    sig_results.append({"file": u, **sig})
            else:
                finding(aid, ctx, None, "HECHO OBSERVADO", "INFO", "SIGNALR_HUBS",
                        "Referencia a SignalR sin hubs accesibles",
                        f"{u} → HTTP {sp.status} {sp.error or ''}. El frontend puede usar "
                        f"el cliente SignalR con negociación dinámica.", confidence="media")
    if not hub_urls and not ws_found and not sig_results:
        ctx.log("SIN referencias a SignalR/WebSocket en el código observado")

    # ---- mapa de endpoints -----------------------------------------------
    ctx.log("paso 6/12 — construcción del mapa de endpoints")
    candidates = []
    # endpoints desde el HTML
    for e in html_analyzer.collect_html_endpoints(ha, base):
        candidates.append({"value": e["path"], "kind": "root-path",
                           "method": e["method"], "file": "index.html",
                           "line": None, "snippet": e["ctx"]})
    # endpoints desde JS
    for s in scans:
        for u in s.get("url_candidates", []):
            candidates.append({**u, "file": s["file"]})
    ep_rows = epmod.build_endpoint_rows(candidates, {})
    ctx.log(f"candidatos endpoint: {len(ep_rows)} (sin sondear)")

    # ---- sondas GET seguras (solo lectura) -------------------------------
    ctx.log("paso 7/12 — sondas GET de lectura seguras (read-only)")
    probe_cands = [c for c in np.safe_probe_candidates(base, ep_rows, max_n=8)]
    # garantiza que ObtenerRankingVista esté presente
    rp = np.RANKING_PATH
    if rp not in [c["path"] for c in probe_cands] and rp in [r["path"] for r in ep_rows]:
        probe_cands.insert(0, {"path": rp, "act": "ObtenerRankingVista",
                               "method": "GET", "classification": "REFERENCIADO"})
    ctx.log(f"sondas seguras seleccionadas: {[c['path'] for c in probe_cands] or 'ninguna'}")
    observed = {}
    for c in probe_cands:
        if not ctx.vol_ok or ctx.req_count >= MAX_REQUESTS:
            ctx.vol_ok = False
            break
        sp = http.get(origin + c["path"], timeout=(12, 60))
        ctx.add_request(origin + c["path"], "GET", sp.status, sp.headers,
                        sp.body if sp.status == 200 else None,
                        sp.ttfb_ms, sp.total_ms, sp.error, kind="xhr")
        observed[c["path"]] = {"status": sp.status, "method": "GET"}
        if sp.status >= 400:
            finding(aid, ctx, None, "HECHO OBSERVADO", "LOW", "HTTP_ERROR",
                    f"Probe GET {sp.status}: {c['path']}",
                    f"{origin + c['path']} → HTTP {sp.status} {sp.error or ''}",
                    file=next((r["source_file"] for r in ep_rows if r["path"] == c["path"]), ""),
                    endpoint=c["path"], confidence="alta")

    ep_rows = epmod.build_endpoint_rows(candidates, observed)
    for r in ep_rows:
        db.insert("endpoints", {
            "audit_id": aid, "path": r["path"], "method": r["method"],
            "classification": r["classification"], "endpoint_type": r["endpoint_type"],
            "source_file": r["source_file"], "source_line": r["source_line"],
            "context": r["context"], "params_json": json.dumps(r["params"]),
            "sources_json": json.dumps(r["sources_json"], ensure_ascii=False)[:3000],
            "status": r["status"], "notes": r["notes"],
        })
    ctx.write_text("analysis/endpoints.json",
                   json.dumps(ep_rows, indent=1, ensure_ascii=False))

    # ---- consulta principal de ranking -----------------------------------
    ctx.log("paso 8/12 — consulta pública ObtenerRankingVista")
    main_url = np.ranking_url(origin, top=opts.get("top", 5000),
                              fechaIni=opts["fechaIni"], fechaFin=opts["fechaFin"])
    run_main = _rank_query(aid, ctx, main_url, tag="main")
    main_stats = run_main.get("stats")
    ctx.log(f"ranking principal: {main_stats and main_stats.get('records')} registros, "
            f"suma kgTotal={main_stats and main_stats.get('sum_kgTotal')}")

    # ---- ventanas de fecha ------------------------------------------------
    ctx.log("paso 9/12 — consultas por rango de fechas")
    windows = [
        {"fechaIni": opts["fechaIni"], "fechaFin": opts["fechaFin"]},
    ]
    d1 = opts["fechaIni"]
    for d in [d1, opts["fechaFin"]]:
        w = {"fechaIni": d, "fechaFin": d}
        if w not in windows:
            windows.append(w)
    date_results = []
    for w in windows[1:]:
        if not ctx.vol_ok or ctx.req_count >= MAX_REQUESTS:
            ctx.vol_ok = False
            break
        r = _rank_query(aid, ctx, np.ranking_url(origin, **w), tag=f"fecha-{w['fechaIni']}")
        date_results.append(r)
    ctx.write_text("analysis/date_windows.json",
                   json.dumps([{**r, "stats": r.get("stats")} for r in date_results],
                              indent=1, ensure_ascii=False, default=str))

    # ---- consistencia -------------------------------------------------------
    ctx.log("paso 10/12 — prueba de consistencia (consultas idénticas)")
    n = int(opts.get("consistency_n", 5))
    cons = np.consistency_run(origin, n=n, delay_ms=700,
                              fechaIni=opts["fechaIni"], fechaFin=opts["fechaFin"])
    for run in cons["runs"]:
        ctx.add_request(cons["url"], "GET", run["status"], {},
                        None, run.get("ttfb_ms"), run.get("total_ms"),
                        run.get("error"), kind="xhr")
    det = cons["consistent"]
    ctx.write_text("analysis/consistency.json", json.dumps(cons, indent=1, ensure_ascii=False))
    ok_runs = [r for r in cons["runs"] if r.get("status") == 200 and not r.get("error")]
    hashes = [r["sha256"] for r in ok_runs]
    if len(set(hashes)) <= 1 and ok_runs:
        finding(aid, ctx, "F-02", "HECHO OBSERVADO", "INFO", "CONSISTENCY_OK",
                "Respuestas idénticas en consultas consecutivas",
                f"{n} consultas GET idénticas a {cons['url']} devolvieron el mismo SHA-256, "
                f"mismo nº de registros ({ok_runs[0].get('records')}) y misma suma de "
                f"kgTotal ({ok_runs[0].get('sum_kgTotal')}).",
                evidence=f"sha256 {hashes[0]}", endpoint=np.RANKING_PATH, confidence="alta")
    elif ok_runs:
        # describir exactamente qué cambió entre la 1ª y la última
        diff = np.diff_ranking_bodies(_body_of(ok_runs[0]), _body_of(ok_runs[-1]))
        desc = (f"{n} consultas idénticas NO devolvieron siempre la misma respuesta: "
                f"{len(set(hashes))} SHA distintos. Registros por consulta: "
                f"{det.get('counts')}; suma kgTotal: {det.get('sums_kgTotal')}.")
        if diff:
            desc += (f" Diferencia 1ª vs última: {diff['count_a']}→{diff['count_b']} registros, "
                     f"{len(diff['changed'])} filas cambiadas, {len(diff['added'])} altas, "
                     f"{len(diff['removed'])} bajas.")
        finding(aid, ctx, "F-03", "INDICIO", "LOW", "RESPONSE_INCONSISTENCY",
                "Cambio de respuesta entre consultas idénticas consecutivas",
                desc + " El cambio entre consultas puede deberse a una actualización "
                       "legítima de datos en curso (la UI declara 'Actualización "
                       "automática'). Se requiere reproducción controlada.",
                endpoint=np.RANKING_PATH, confidence="media",
                recommendation="Repetir el par de consultas en una ventana sin actividad "
                               "declarada y comparar timestamps y hashes.")

    # ---- errores de aplicación / HTTP 200 con error -------------------------
    ctx.log("paso 11/12 — análisis de errores")
    _scan_application_errors(aid, ctx)

    # ---- posibles fallos silenciosos (patrones en JS) ------------------------
    ctx.log("paso 11a/12 — patrones de posible fallo silencioso en JS")
    if silent_cands:
        seen_pat = {}
        for s in silent_cands[:60]:
            key = (s["pattern"], s["file"])
            if key in seen_pat:
                continue
            seen_pat[key] = True
            finding(aid, ctx, None, s.get("klass", "INDICIO"),
                    s.get("severity", "LOW"), s["finding_type"],
                    s["title"], s.get("description", ""),
                    evidence=f"fragmento: {s.get('snippet', '')[:220]}",
                    file=s.get("file", ""), confidence=s.get("confidence", "baja"),
                    recommendation=s.get("recommendation", ""))
        ctx.log(f"patrones de fallo silencioso: {len(seen_pat)} hallazgos INDICIO insertados "
                f"(de {len(silent_cands)} candidatos)")

    # ---- modo navegador -------------------------------------------------------
    if opts.get("browser"):
        ctx.log("paso 11b/12 — captura con navegador real (Playwright)")
        _browser_pass(aid, ctx, base, opts)
    else:
        ctx.log("modo navegador desactivado (opcional)")

    # ---- KG integrity -----------------------------------------------------------
    ctx.log("paso 11c/12 — análisis KG-INTEGRITY")
    flows, kg_summary = kgmod.map_kg_flows(html_text, js_files)
    for f in flows:
        db.insert("kg_flows", {
            "audit_id": aid, "screen": f["screen"], "func_name": f.get("file", ""),
            "request_desc": f["request_desc"], "endpoint": ",".join(f["endpoints"]),
            "response_desc": "", "processing_desc": "",
            "display_desc": f.get("screen", ""),
            "notes": json.dumps({k: v for k, v in f.items()
                                 if k not in ("screen", "file", "request_desc", "endpoints")},
                                ensure_ascii=False)[:2000],
            "keyword": ",".join(sorted(f["keywords"].keys())[:20]) if f.get("keywords") else "",
            "file": f.get("file", ""),
        })
    ctx.write_text("analysis/kg_integrity.json",
                   json.dumps({"flows": flows, "summary": kg_summary},
                              indent=1, ensure_ascii=False))
    ctx.log(f"KG: {len(flows)} flujos correlacionados; "
            f"keywords por archivo en analysis/kg_integrity.json")

    # ---- comparación con auditoría anterior ---------------------------------------
    ctx.log("paso 12/12 — comparación con auditoría anterior")
    changes = compare_previous(aid, project_id=db.q1("SELECT project_id FROM audits WHERE id=?", (aid,))["project_id"])
    ctx.write_text("analysis/comparison.json", json.dumps(changes, indent=1, ensure_ascii=False))

    elapsed = round(time.perf_counter() - t_start, 1)
    nfind = db.q1("SELECT COUNT(*) c FROM findings WHERE audit_id=?", (aid,))["c"]
    nreq = ctx.req_count
    return {
        "elapsed_s": elapsed, "requests": nreq, "findings": nfind,
        "scripts": len(js_files), "endpoints": len(ep_rows),
        "url": base, "main_ranking": run_main.get("stats"),
        "consistency": cons, "silent_candidates": len(silent_cands),
        "signalr": sig_results, "hub_urls": hub_urls,
        "websockets": ws_found, "screens": screens,
    }


def _rank_query(aid, ctx, url, tag=""):
    p = http.get(url)
    ctx.add_request(url, "GET", p.status, p.headers,
                    p.body if (p.status == 200 and not p.error) else None,
                    p.ttfb_ms, p.total_ms, p.error, kind="xhr")
    rec = {"tag": tag, "url": url, "status": p.status,
           "size": p.size, "ttfb_ms": round(p.ttfb_ms, 1),
           "total_ms": round(p.total_ms, 1), "sha256": p.sha256, "error": p.error}
    if p.status == 200 and not p.error:
        st = np.parse_ranking(p.body)
        rec["stats"] = st
        if not st.get("json_ok"):
            finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "HTTP_SUCCESS_APPLICATION_ERROR",
                    "Respuesta de ranking no es JSON válido",
                    f"{url} devolvió HTTP 200 pero el cuerpo no parsea como JSON: "
                    f"{st.get('error')}", endpoint=np.RANKING_PATH, confidence="alta")
        elif st.get("error"):
            finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "HTTP_SUCCESS_APPLICATION_ERROR",
                    "Estructura inesperada en respuesta 200",
                    f"La respuesta 200 de ranking no contiene clave 'ranking' — claves: "
                    f"{st.get('keys')}. Detalle: {st.get('error')}",
                    endpoint=np.RANKING_PATH, confidence="alta")
    elif p.error:
        finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "HTTP_ERROR",
                f"Error de red/TIMEOUT en consulta ranking", f"{p.error}",
                endpoint=np.RANKING_PATH, confidence="alta")
    return rec


def _scan_application_errors(aid, ctx):
    rows = db.q("SELECT r.* FROM responses r WHERE r.audit_id=? AND r.http_status=200", (aid,))
    for r in rows:
        try:
            body = (ctx.root / r["body_path"]).read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if body.lstrip()[:1] not in ("{", "["):
            continue
        try:
            data = json.loads(body)
        except Exception:
            continue
        err = _deep_error(data)
        if err:
            finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "HTTP_SUCCESS_APPLICATION_ERROR",
                    f"HTTP 200 con indicador de error en el JSON: {err['field']}",
                    f"{r['url']} → HTTP 200 pero JSON contiene {err['field']}={err['value']!r} "
                    f"(preview: {body[:200]})", endpoint=r["url"], confidence="alta")
    # errores HTTP de cualquier petición
    errs = db.q("SELECT url, status, error, count(*) c FROM requests "
                "WHERE audit_id=? AND (status>=400 OR error IS NOT NULL) "
                "GROUP BY url, status, error ORDER BY status", (aid,))
    for e in errs:
        sev = "MEDIUM" if (e["status"] or 0) >= 500 else "LOW"
        finding(aid, ctx, None, "HECHO OBSERVADO", sev, "HTTP_ERROR",
                f"Petición con error HTTP {e['status'] or 'red'}",
                f"{e['url']} → status {e['status']} error={e['error'] or ''} "
                f"(x{e['c']})", endpoint=e["url"], confidence="alta")


def _deep_error(data, depth=0):
    if depth > 4:
        return None
    if isinstance(data, dict):
        for k in ("success", "ok", "error", "errors", "status", "mensaje", "message"):
            if k in data:
                v = data[k]
                if k in ("error", "errors") and v not in (None, "", False, [], {}):
                    return {"field": k, "value": str(v)[:200]}
                if k == "status" and isinstance(v, str) and v.lower() in ("error", "fail", "false"):
                    return {"field": k, "value": v}
                if k in ("success", "ok") and v is False:
                    return {"field": k, "value": v}
                if k in ("message", "mensaje") and isinstance(v, str) and \
                        any(w in v.lower() for w in ("error", "no se pudo", "fallo", "invalid", "no encontrado")):
                    return {"field": k, "value": v[:200]}
        for v in data.values():
            r = _deep_error(v, depth + 1)
            if r:
                return r
    elif isinstance(data, list):
        for v in data[:20]:
            r = _deep_error(v, depth + 1)
            if r:
                return r
    return None


def _body_of(run):
    return run.get("body") or b""


def _browser_pass(aid, ctx, base, opts):
    from .engine import browser as brow
    if not brow.playwright_available():
        ctx.log("playwright no instalado — omitiendo modo navegador")
        finding(aid, ctx, None, "HECHO OBSERVADO", "INFO", "BROWSER_SKIPPED",
                "Modo navegador omitido: playwright no está instalado",
                "Instalar con: .venv/Scripts/python -m playwright install chromium",
                confidence="alta")
        return
    bodies_dir = ctx.root / "network" / "bodies"
    cap = brow.capture_page(base, wait_ms=opts.get("wait_ms", 12000),
                            bodies_dir=bodies_dir, log=lambda m: ctx.log(m))
    ctx.write_text("network/browser_network.json",
                   json.dumps({k: v for k, v in cap.items() if k != "bodies"},
                              indent=1, ensure_ascii=False))
    ctx.write_text("logs/browser_console.json",
                   json.dumps({"console_errors": cap["console_errors"],
                               "page_errors": cap["page_errors"],
                               "failed": cap["failed_requests"]},
                              indent=1, ensure_ascii=False))
    # registra entradas de red
    n_json = 0
    for e in cap["entries"]:
        rid = db.insert("requests", {
            "audit_id": aid, "url": e["url"], "method": e["method"],
            "status": e["status"], "content_type": e.get("content_type", ""),
            "size": e.get("size"), "ttfb_ms": None,
            "total_ms": e.get("total_ms"),
            "sha256": e.get("sha256"),
            "kind": e.get("kind", "other"), "initiator": e.get("initiator"),
            "error": None, "created_at": now_iso(),
        })
        if e.get("sha256"):
            for b in cap["bodies"]:
                if b["sha256"] == e["sha256"]:
                    rel = f"network/bodies/{b['file']}"
                    structure, records, _m = None, None, None
                    if "json" in b.get("file", ""):
                        try:
                            txt = (bodies_dir / b["file"]).read_text(encoding="utf-8", errors="replace")
                            structure, records, _m = summarize_json(txt, b["url"])
                        except Exception:
                            pass
                    db.insert("responses", {
                        "audit_id": aid, "request_id": rid, "url": b["url"],
                        "http_status": b["status"], "body_path": rel,
                        "body_preview": "",
                        "record_count": records,
                        "sha256": b["sha256"],
                        "structure_json": json.dumps(structure, ensure_ascii=False) if structure else None,
                        "metrics_json": None,
                    })
                    if records is not None:
                        n_json += 1
                    break
    ctx.log(f"navegador: {len(cap['entries'])} requests, "
            f"{len(cap['console_errors'])} console.error, "
            f"{len(cap['page_errors'])} pageerrors, {len(cap['failed_requests'])} fallidas")
    for b in cap.get("bodies", []):
        ctx.adopt_external(f"network/bodies/{b['file']}", url=b["url"], cat="responses")
    for ce in cap["console_errors"][:25]:
        finding(aid, ctx, None, "HECHO OBSERVADO", "LOW", "JS_ERROR",
                f"console.error: {ce['text'][:120]}",
                f"{ce.get('url') or ''} línea {ce.get('line')}", file=ce.get("url"),
                confidence="alta")
    for pe in cap["page_errors"][:10]:
        finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "JS_ERROR",
                f"pageerror: {pe['text'][:160]}", pe["text"], confidence="alta")
    for fr in cap["failed_requests"][:15]:
        finding(aid, ctx, None, "HECHO OBSERVADO", "MEDIUM", "JS_ERROR",
                f"Petición fallida en navegador: {fr['url'][:150]}",
                f"{fr['error']}", endpoint=fr["url"], confidence="alta")


def compare_previous(aid, project_id):
    prev = db.q1("SELECT id FROM audits WHERE project_id=? AND status='done' AND id<? "
                 "ORDER BY id DESC LIMIT 1", (project_id, aid))
    changes = {"prev_audit": prev["id"] if prev else None, "items": []}
    if not prev:
        changes["note"] = "primera auditoría del proyecto — sin base de comparación"
        return changes
    pid = prev["id"]
    cur_scripts = {r["url"]: r["sha256"] for r in
                   db.q("SELECT url, sha256 FROM scripts WHERE audit_id=?", (aid,))}
    prev_scripts = {r["url"]: r["sha256"] for r in
                    db.q("SELECT url, sha256 FROM scripts WHERE audit_id=?", (pid,))}
    for u in sorted(set(cur_scripts) - set(prev_scripts)):
        _chg(aid, pid, "NUEVO_JS", f"Nuevo JavaScript: {u}", changes)
    for u in sorted(set(prev_scripts) - set(cur_scripts)):
        _chg(aid, pid, "JS_DESAPARECIDO", f"JavaScript ya no cargado: {u}", changes)
    for u in sorted(set(cur_scripts) & set(prev_scripts)):
        if cur_scripts[u] != prev_scripts[u]:
            _chg(aid, pid, "JS_MODIFICADO", f"JavaScript modificado (SHA cambió): {u}", changes)
    cur_eps = {r["path"] for r in db.q("SELECT path FROM endpoints WHERE audit_id=?", (aid,))}
    prev_eps = {r["path"] for r in db.q("SELECT path FROM endpoints WHERE audit_id=?", (pid,))}
    for p in sorted(cur_eps - prev_eps):
        _chg(aid, pid, "ENDPOINT_NUEVO", f"Endpoint nuevo: {p}", changes)
    for p in sorted(prev_eps - cur_eps):
        _chg(aid, pid, "ENDPOINT_DESAPARECIDO", f"Endpoint ya no referenciado: {p}", changes)
    # comparación de la respuesta principal de ranking
    cur_main = db.q1("SELECT r.sha256, r.record_count, r.metrics_json FROM responses r "
                     "WHERE r.audit_id=? AND r.url LIKE '%ObtenerRankingVista%' "
                     "ORDER BY r.id LIMIT 1", (aid,))
    prev_main = db.q1("SELECT r.sha256, r.record_count, r.metrics_json FROM responses r "
                      "WHERE r.audit_id=? AND r.url LIKE '%ObtenerRankingVista%' "
                      "ORDER BY r.id LIMIT 1", (pid,))
    if cur_main and prev_main:
        if cur_main["sha256"] != prev_main["sha256"]:
            _chg(aid, pid, "RESPUESTA_DIFERENTE",
                 f"Respuesta ObtenerRankingVista cambió entre auditorías: "
                 f"registros {prev_main['record_count']} → {cur_main['record_count']} "
                 f"(SHA {prev_main['sha256'][:12]} → {cur_main['sha256'][:12]})", changes)
        else:
            _chg(aid, pid, "RESPUESTA_IDENTICA",
                 "Respuesta ObtenerRankingVista idéntica a la auditoría anterior "
                 f"(SHA {cur_main['sha256'][:16]}…)", changes)
    for c in changes["items"]:
        db.insert("changes", {"audit_id": aid, "prev_audit_id": pid,
                              "kind": c["kind"], "description": c["description"],
                              "detail_json": json.dumps(c, ensure_ascii=False)})
    return changes


def _chg(aid, pid, kind, desc, changes):
    changes["items"].append({"kind": kind, "description": desc})


_SEQ = {"n": 0}


def finding(aid, ctx, fid, klass, severity, ftype, title, description,
            evidence="", file="", endpoint="", confidence="media",
            impact="", recommendation="", status="abierto"):
    with _lock:
        _SEQ["n"] += 1
        if fid is None:
            fid = f"F-{_SEQ['n']:02d}"
    db.insert("findings", {
        "audit_id": aid, "fid": fid, "severity": severity, "klass": klass,
        "finding_type": ftype, "title": title, "description": description,
        "evidence": evidence, "file": file, "endpoint": endpoint,
        "confidence": confidence, "impact": impact, "recommendation": recommendation,
        "status": status, "created_at": now_iso(),
    })
    if ctx:
        ctx.log(f"  hallazgo {fid} [{klass}/{severity}] {title}")
