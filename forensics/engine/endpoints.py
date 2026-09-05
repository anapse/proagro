# Mapa de endpoints: agregación, normalización y clasificación
# (OBSERVADO / REFERENCIADO / POSIBLE). No inventa endpoints.
from urllib.parse import urlsplit, parse_qs

from ..patterns import action_part, is_read_action, is_write_action, is_static_path

KNOWN_ORIGINS = ("digital.proagro.pe",)


def _normalize(value, base_origin):
    """Devuelve (path_sin_query, params) o None si no es candidato de app."""
    value = (value or "").strip()
    if not value or value.startswith(("#", "javascript:", "mailto:")):
        return None, []
    if "{" in value or "}" in value or "+" in value or value.startswith(("`", "(")):
        return None, []  # plantilla/expresión → se marca POSIBLE por separado
    if value.startswith(("//", "http://", "https://")):
        sp = urlsplit(value)
        if sp.netloc not in KNOWN_ORIGINS:
            return None, []
        path = sp.path
    else:
        if value.startswith("QrKgAra") and not value.startswith("/"):
            path = "/" + value
        elif value.startswith((".", "./", "../")):
            path = None
        else:
            path = value
        if path is None:
            return None, []
    if not path.startswith("/"):
        return None, []
    if is_static_path(path):
        return None, []
    q = parse_qs(urlsplit(value).query)
    params = sorted({k: (v[0] if len(v) == 1 else v) for k, v in q.items()}.keys())
    return path, params


def build_endpoint_rows(candidates, observed, audit_ctx=None):
    """
    candidates: lista de dicts {value, kind, method, file, line, snippet, is_static}
    observed:   dict path->(method, status) realmente consultado en esta auditoría
    """
    rows = {}
    for c in candidates:
        path, params = _normalize(c.get("value", ""), "")
        if not path:
            continue
        act = action_part(path)
        key = path
        if key not in rows:
            rows[key] = {
                "path": path, "method": (c.get("method") or "").upper() or "",
                "classification": None, "endpoint_type": _etype(path, act),
                "source_file": c.get("file", ""), "source_line": c.get("line"),
                "context": (c.get("snippet") or "")[:500],
                "params": params, "sources": [], "status": "no_probado",
                "notes": "",
            }
        r = rows[key]
        # método: prefiere el más específico (excluye el vacío)
        m = (c.get("method") or "").upper()
        if m and not r["method"]:
            r["method"] = m
        if not r["classification"]:
            if c.get("kind") in ("template", "concat", "partial"):
                r["classification"] = "POSIBLE"
            elif c.get("kind") in ("root-path", "qr-path", "full-url") and not m:
                r["classification"] = "REFERENCIADO"
            else:
                r["classification"] = "REFERENCIADO"
        for p in params:
            if p not in r["params"]:
                r["params"].append(p)
        src = {"file": c.get("file", ""), "line": c.get("line"),
               "snippet": (c.get("snippet") or "")[:400]}
        if src not in r["sources"]:
            r["sources"].append(src)
    # Clasificación final + estado observado
    for r in rows.values():
        obs = observed.get(r["path"])
        if obs:
            r["classification"] = "OBSERVADO"
            r["status"] = str(obs.get("status", ""))
            if obs.get("method"):
                r["method"] = obs["method"].upper()
        if r["classification"] is None:
            r["classification"] = "POSIBLE"
        act = action_part(r["path"])
        if act:
            if is_write_action(act):
                r["notes"] = "acción de escritura por convención — no sondear"
            elif is_read_action(act):
                r["notes"] = "acción de lectura por convención"
    out = []
    for path in sorted(rows):
        r = rows[path]
        r["params"] = ",".join(r["params"])
        r["sources_json"] = r.pop("sources")
        out.append(r)
    return out


def _etype(path, act):
    pl = path.lower()
    if "signalr" in pl or pl.endswith("/hubs"):
        return "hub"
    if "/api/" in pl:
        return "api"
    if act:
        return "mvc_action"
    if path.endswith((".html", ".aspx", ".ashx", "/")):
        return "page"
    return "other"


def candidate_priority(c):
    k = c.get("kind", "")
    if k in ("fetch", "ajax-literal", "axios", "ajax-obj"):
        return 0
    if k in ("qr-path", "root-path", "full-url"):
        return 1
    return 2
