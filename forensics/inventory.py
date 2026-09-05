# Inventario forense estructurado por auditoría: endpoints enriquecidos,
# funciones→endpoints, formularios, QR (cargadas vs usadas) y campos de negocio.
# Todo se deriva de la EVIDENCIA ya guardada (DB + snapshots) — no se inventa nada.
import json
import re
from pathlib import Path

from . import db, SNAPSHOT_DIR

_FN_RE = re.compile(
    r"(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b)", re.M)
_DATA_RE = re.compile(r"data\s*:\s*\{([^}]{0,500})\}", re.S)
_KEY_RE = re.compile(r"([A-Za-z_$][\w$]*)\s*:")

APP_HINT = ("QrKgAra", "inline_", "Login", "Home", "CerrarSesion")
QR_BUNDLE = re.compile(r"jsqr|qrcode|rsdecoder|gf256|databr|findpat|alignpat|detector|decoder", re.I)
_caches = {}


def _snapshot_dir(aid):
    snap = db.q1("SELECT dir FROM snapshots WHERE audit_id=? ORDER BY id DESC LIMIT 1", (aid,))
    return (SNAPSHOT_DIR / snap["dir"]) if snap else None


def _load_json(rel, aid):
    root = _snapshot_dir(aid)
    if not root:
        return None
    p = root / "analysis" / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _file_texts(aid):
    """url -> {name, path, text} de los JS guardados en el snapshot."""
    key = f"txt_{aid}"
    if key in _caches:
        return _caches[key]
    out = {}
    root = _snapshot_dir(aid)
    for row in db.q("SELECT url, name, path FROM scripts WHERE audit_id=?", (aid,)):
        rel = (row["path"] or "").replace("\\", "/")
        cands = []
        if rel:
            cands += [root / rel, SNAPSHOT_DIR / rel, root / "javascript" / rel.split("/")[-1]]
        if row["name"]:
            cands.append(root / "javascript" / row["name"])
        for fp in cands:
            if fp and fp.exists():
                try:
                    out[row["url"]] = {"name": row["name"], "path": rel,
                                       "text": fp.read_text(encoding="utf-8", errors="replace")}
                    break
                except Exception:
                    pass
    _caches[key] = out
    return out


def _funcion_en(text, offset):
    """Función ENVOLVENTE más cercana (la que contiene el offset)."""
    if not text or offset is None:
        return ""
    prev = text[:offset]
    hits = list(_FN_RE.finditer(prev))
    if not hits:
        return ""
    # entre los candidatos, el último cuyo siguiente empiece después de offset
    for i in range(len(hits) - 1, -1, -1):
        nxt = hits[i + 1].start() if i + 1 < len(hits) else len(prev) + 1
        if nxt > offset:
            m = hits[i]
            return (m.group(1) or m.group(2) or "").strip()
    m = hits[-1]
    return (m.group(1) or m.group(2) or "").strip()


def _params_en(text, offset):
    if not text or offset is None:
        return []
    w0 = max(0, offset - 400)
    win = text[w0:offset + 900]
    keys = []
    for m in _DATA_RE.finditer(win):
        for k in _KEY_RE.finditer(m.group(1)):
            kk = k.group(1)
            if kk not in ("url", "type", "method", "contentType", "dataType",
                          "success", "error", "async", "cache", "headers", "if"):
                keys.append(kk)
    return keys[:15]


def _normalize(path):
    return (path or "").split("?", 1)[0]


def _fuente_amable(url):
    if not url:
        return ""
    u = url.split("#")
    base = u[0]
    if len(u) > 1 and u[1].startswith("inline"):
        return f"{base.rsplit('/', 1)[-1]}#{u[1]}"
    return base.rsplit("/", 1)[-1] or base


def build_inventory(aid):
    """Inventario completo de la auditoría (con caché por auditoría)."""
    key = f"inv_{aid}"
    if key in _caches:
        return _caches[key]

    audit = db.q1("SELECT * FROM audits WHERE id=?", (aid,))
    proj = db.q1("SELECT * FROM projects WHERE id=?", (audit["project_id"],)) if audit else None
    root = _snapshot_dir(aid)
    texts = _file_texts(aid)
    js = _load_json("js_analysis.json", aid) or []
    html = _load_json("html_analysis.json", aid) or {}
    by_url = {}
    for f in js:
        by_url[f.get("file", "")] = f

    # ---- endpoints desde la tabla (evidencia real) --------------------
    ep_rows = db.q("SELECT * FROM endpoints WHERE audit_id=? ORDER BY path", (aid,))
    endpoints = []
    seen = set()
    for r in ep_rows:
        path = _normalize(r["path"])
        if not path or path in seen:
            continue
        seen.add(path)
        params = [p for p in re.split(r"[,;]", (r.get("params_json") or "").strip('"')) if p]
        method = r["method"] or ""
        file_url = r["source_file"] or ""
        fn = ""
        line = r["source_line"]
        extra_params = []
        # busca ocurrencias en el código para función/parámetros reales
        file_text = texts.get(file_url, {}).get("text")
        for f in js:
            ftext = texts.get(f.get("file", ""), {}).get("text")
            for cand in (f.get("ajax_calls") or []):
                if _normalize(cand.get("url")) == path:
                    fn = _funcion_en(ftext, cand.get("offset")) or fn
                    extra_params += _params_en(ftext, cand.get("offset"))
                    if not method:
                        method = cand.get("method", "")
                    file_url = f.get("file", file_url)
                    line = cand.get("line", line)
        for cand in (by_url.get(file_url, {}).get("url_candidates") or []):
            if _normalize(cand.get("value")) == path and not fn:
                fn = _funcion_en(file_text or "", cand.get("offset"))
        params = list(dict.fromkeys(params + extra_params))

        estado, icono = _estado(r, method)
        endpoints.append({
            "path": path, "metodo": method, "estado": estado, "icono": icono,
            "params": params, "archivo": _fuente_amable(file_url),
            "archivo_url": file_url, "linea": line, "funcion": fn,
            "clasificacion": r.get("classification", ""),
            "tipo": r.get("endpoint_type", ""), "notas": r.get("notes", ""),
            "http": _estado_http(r.get("status", "")), "fecha": (audit or {}).get("started_at", ""),
        })

    # ---- respuestas verificadas (estructura real) ---------------------
    resp = {}
    for rrow in db.q("SELECT url, http_status, structure_json, metrics_json FROM responses WHERE audit_id=?",
                     (aid,)):
        p = _normalize(rrow["url"])
        if p and p not in resp:
            resp[p] = {"http": rrow["http_status"],
                       "estructura": json.loads(rrow["structure_json"] or "null")}
    # verificaciones hechas desde la propia herramienta (QR → KG, kg_queries)
    kgq = db.q1("SELECT http_status, created_at, fecha FROM kg_queries "
                "WHERE endpoint LIKE '%ConsultarKgVista' ORDER BY id DESC LIMIT 1")
    if kgq and kgq["http_status"]:
        resp.setdefault("/QrKgAra/ConsultarKgVista",
                        {"http": kgq["http_status"], "estructura": None})
    for e in endpoints:
        rr = resp.get(e["path"])
        if rr:
            e["respuesta"] = {"http": rr["http"], "estructura": rr["estructura"]}
            e["verificado"] = True
            e["verificado_via"] = ("Consulta pública de la herramienta (kg_queries)"
                                   if "/QrKgAra/ConsultarKgVista" == e["path"] else
                                   "Consulta GET de la auditoría")
            e["verificado_en"] = kgq["created_at"] if kgq and e["path"] == "/QrKgAra/ConsultarKgVista" else None
            if isinstance(rr["http"], int) and 200 <= rr["http"] < 400:
                e["estado"], e["icono"] = "VERIFICADO", "🟢"
                e["http"] = rr["http"]
            else:
                e["estado"], e["icono"] = "ERROR", "🔴"
        else:
            e["respuesta"] = None
            e["verificado"] = False
            e["verificado_via"] = ""
            e["verificado_en"] = None

    # ---- separa ruido de librerías (rutas tipo /a/b dentro de bundles) -----
    ruido = []
    limpios = []
    for e in endpoints:
        es_ruido = (e["path"] in ("/", "/./", "/a/b", "/a") or
                    ("/bundles/" in e["archivo_url"] and not e["metodo"]))
        if es_ruido:
            ruido.append(e)
        else:
            limpios.append(e)
    endpoints = limpios

    # ---- funciones → endpoints (mapeo real extraído del código) ----------
    def _pantalla_de(fn):
        fn = (fn or "").lower()
        if "jefe_grupo" in fn or "grupo" in fn and "jefe" in fn:
            return "Jefe de Grupo"
        if "jefe_cuadrilla" in fn or "cuadrilla" in fn:
            return "Jefe de Cuadrilla"
        if "ranking" in fn:
            return "Ver Ranking (auto-refresh 5 min)"
        if "kg_dia" in fn or "consultar_kg" in fn or "mi_kg" in fn:
            return "Consultar mi Kg"
        if "menu" in fn:
            return "Menú / Login"
        if "salir" in fn or "cerrar" in fn:
            return "Cerrar sesión"
        return ""

    funciones = []
    seen_f = set()
    for e in endpoints:
        if e["funcion"]:
            k = (e["funcion"], e["path"])
            if k not in seen_f:
                seen_f.add(k)
                funciones.append({
                    "pantalla": _pantalla_de(e["funcion"]), "funcion": e["funcion"],
                    "endpoint": e["path"], "descripcion": "",
                    "keywords": "", "archivo": e["archivo"], "metodo": e["metodo"],
                })

    # ---- formularios -----------------------------------------------------
    forms = []
    for f in (html or {}).get("forms", []) or []:
        forms.append({"action": f.get("action", ""), "abs": f.get("abs_action", ""),
                      "method": f.get("method", ""),
                      "campos": [{"nombre": i.get("name"), "tipo": i.get("type"),
                                  "id": i.get("id"), "valor": i.get("value")}
                                 for i in (f.get("inputs") or []) if i.get("name")]})

    # ---- QR: librerías CARGADAS vs USADAS por el código de la app ----------
    app_txt = " ".join(t["text"] for u, t in texts.items()
                       if "inline" in u or "QrKgAra" in u)
    qr_libs, qr_usadas = [], []
    for url, t in texts.items():
        if not QR_BUNDLE.search(url + " " + (t["name"] or "")):
            continue
        base = (t["name"] or "").lower()
        globales = {"jsqr": "jsQR", "qrcode": "QRCode/qrcode"}
        tok = None
        for k, g in globales.items():
            if k in base:
                tok = g
        item = {"archivo": _fuente_amable(url), "url": url, "bytes": len(t["text"]),
                "rol": "módulo interno de jsQR" if not tok else "librería principal"}
        usado_por_app = bool(tok and re.search(re.escape(tok.split("/")[0]), app_txt))
        if usado_por_app:
            qr_usadas.append(item)
        else:
            qr_libs.append(item)
    contexto_qr = []
    for m in re.finditer(r"jsQR\s*\(|QRCode|qrcode|BarcodeDetector", app_txt):
        s = max(0, m.start() - 60)
        contexto_qr.append({"origen": "scripts inline de la página",
                            "uso": app_txt[s:m.end() + 60].strip()[:160]})
    qr_usadas = list({(x["archivo"], x["url"]): x for x in qr_usadas}.values())
    qr_libs = list({(x["archivo"], x["url"]): x for x in qr_libs}.values())

    # ---- campos de negocio detectados -------------------------------------
    campos = {}
    for f in js:
        for k, v in (f.get("keyword_counts") or {}).items():
            if v > 0:
                e = campos.setdefault(k, {"total": 0, "archivos": []})
                e["total"] += v
                e["archivos"].append({"archivo": _fuente_amable(f.get("file", "")), "n": v})
    campos = [{"campo": k, "total": v["total"],
               "archivos": sorted(v["archivos"], key=lambda x: -x["n"])[:6]}
              for k, v in sorted(campos.items(), key=lambda x: -x[1]["total"])]

    # ---- mapa / recursos ---------------------------------------------------
    sc = db.q("SELECT * FROM scripts WHERE audit_id=? ORDER BY id", (aid,))
    recursos = {"html": 1, "js": len(sc),
                "js_externos": sum(1 for r in sc if r["kind"] == "external"),
                "js_inline": sum(1 for r in sc if r["kind"] == "inline"),
                "hub": sum(1 for r in sc if r["kind"] == "hub"),
                "css": len((html or {}).get("css", []) or []),
                "imagenes": len((html or {}).get("images", []) or []),
                "iframes": len((html or {}).get("iframes", []) or []),
                "enlaces": (html or {}).get("links_count", 0),
                "forms": len(forms)}
    hallazgos = db.q1("SELECT COUNT(*) c FROM findings WHERE audit_id=?", (aid,))["c"]

    estados = {"VERIFICADO": 0, "ENCONTRADO EN CÓDIGO": 0, "REFERENCIADO": 0, "ERROR": 0}
    for e in endpoints:
        estados[e["estado"]] = estados.get(e["estado"], 0) + 1

    # orden: verificados primero, luego encontrados, referenciados
    orden = {"VERIFICADO": 0, "ENCONTRADO EN CÓDIGO": 1, "REFERENCIADO": 2, "ERROR": 3}
    endpoints.sort(key=lambda x: (orden.get(x["estado"], 9), x["path"]))

    inv = {
        "audit_id": aid, "fecha_analisis": (audit or {}).get("started_at", ""),
        "url": (proj or {}).get("url", ""),
        "totales": {
            "recursos": 1 + len(sc) + recursos["css"] + recursos["imagenes"],
            "js": len(sc), "endpoints": len(endpoints), "estados": estados,
            "funciones": len(funciones), "formularios": len(forms),
            "qr_librerias": len(qr_libs) + len(qr_usadas), "qr_usadas": len(qr_usadas),
            "campos": len(campos), "hallazgos": hallazgos,
        },
        "recursos": recursos,
        "endpoints": endpoints,
        "ruido": ruido,
        "funciones": funciones,
        "forms": forms,
        "qr": {"librerias": qr_libs, "usadas": qr_usadas, "contexto": contexto_qr[:10]},
        "campos": campos,
    }
    _caches[key] = inv
    return inv


def _estado(r, method):
    st = r.get("status") or ""
    try:
        code = int(st)
    except Exception:
        code = None
    if code is not None:
        if 200 <= code < 400:
            return "VERIFICADO", "🟢"
        return "ERROR", "🔴"
    cls = r.get("classification", "")
    if cls == "OBSERVADO":
        return "VERIFICADO", "🟢"
    if method:
        return "ENCONTRADO EN CÓDIGO", "🟡"
    return "REFERENCIADO", "🔵"


def _estado_http(st):
    try:
        return int(st) if st else None
    except Exception:
        return None
