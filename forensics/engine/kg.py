# KG-INTEGRITY: recorre el camino del dato Kg/peso/cosecha desde la pantalla
# hasta la visualización, correlacionando keywords con endpoints cercanos.
import re

from ..patterns import KG_KEYWORDS, URL_RE, ROOT_PATH_RE, QR_PATH_RE, ACTION_NAME_RE

KG_SCREEN_WORDS = {
    "Consultar mi Kg": ["consultar mi kg", "consultar mi peso", "busca por dni"],
    "Ver Ranking": ["ver ranking", "ranking de cosechadores", "top de registros"],
    "Jefe de Grupo": ["jefe de grupo"],
    "Jefe de Cuadrilla": ["jefe de cuadrilla"],
    "Actualización automática": ["actualizacion automatica", "actualización automática", "5:00"],
}

URL_PAT = re.compile(
    r"['\"](?:[A-Za-z0-9_\-./]*QrKgAra[A-Za-z0-9_\-./?=&%{}]*|/[A-Za-z0-9_\-./?=&%{}]*Obtener[A-Za-z0-9_]*|/[A-Za-z0-9_\-./?=&%{}]*Consultar[A-Za-z0-9_]*|/[A-Za-z0-9_\-./?=&%{}]*Ranking[A-Za-z0-9_]*)['\"]"
)


def find_screens(html_text: str):
    """Pantallas/acciones visibles en el HTML que mencionan dominio KG."""
    out = []
    low = html_text.lower()
    for label, words in KG_SCREEN_WORDS.items():
        for w in words:
            if w in low:
                out.append({"screen": label, "matched": w})
                break
    return out


def map_kg_flows(html_text, js_files):
    """
    js_files: lista de {name, url, text}
    Devuelve (flujos, resumen). Resumen contiene: keywords por archivo,
    endpoints correlacionados y referencias a almacenamiento.
    """
    flows = []
    screens = find_screens(html_text)
    summary = {"screens": screens, "per_file": [], "correlated_endpoints": []}

    all_eps = {}
    for f in js_files:
        text = f.get("text") or ""
        hits = []
        for label, pat in KG_KEYWORDS.items():
            rx = re.compile(pat, re.IGNORECASE)
            for m in rx.finditer(text):
                hits.append({"keyword": label, "pos": m.start(), "matched": m.group(0)})
        kw_counts = {}
        for h in hits:
            kw_counts[h["keyword"]] = kw_counts.get(h["keyword"], 0) + 1
        # endpoints en ventanas alrededor de hits KG
        near_eps = []
        for h in hits[:400]:
            w0 = max(0, h["pos"] - 500)
            w1 = min(len(text), h["pos"] + 500)
            window = text[w0:w1]
            for m in URL_PAT.finditer(window):
                v = m.group(0).strip("'\"")
                rel = abs(m.start() + w0 - h["pos"])
                near_eps.append({"endpoint": v, "keyword": h["keyword"], "dist": rel})
        near_eps.sort(key=lambda e: e["dist"])
        seen = set()
        uniq = []
        for e in near_eps:
            k = (e["endpoint"], e["keyword"])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        summary["per_file"].append({
            "file": f.get("name"), "url": f.get("url"),
            "keyword_counts": kw_counts, "endpoints_near_kg": uniq[:40],
        })
        for e in uniq[:12]:
            summary["correlated_endpoints"].append({**e, "file": f.get("name")})
        # flujos por pantalla: si este bundle maneja ranking/jefe..., asócialo
        low = text.lower()
        for scr in screens:
            sname = scr["screen"]
            if sname == "Actualización automática":
                if any(k in low for k in ("setinterval", "settimeout", "5000")):
                    flows.append(_flow(sname, f, kw_counts, "temporizador de refresco", uniq))
            elif sname == "Consultar mi Kg":
                if any(k in low for k in ("dni", "consultarmikg", "consultar mi kg")):
                    flows.append(_flow(sname, f, kw_counts, "búsqueda por DNI + fecha", uniq))
            elif sname == "Ver Ranking":
                if any(k in low for k in ("ranking", "obtenerranking", "top")):
                    flows.append(_flow(sname, f, kw_counts, "consulta pública ranking", uniq))
            elif sname == "Jefe de Grupo":
                if "jefe" in low and "grupo" in low:
                    flows.append(_flow(sname, f, kw_counts, "acumulado por jefe de grupo", uniq))
            elif sname == "Jefe de Cuadrilla":
                if "cuadrilla" in low:
                    flows.append(_flow(sname, f, kw_counts, "acumulado por jefe de cuadrilla", uniq))
    return flows, summary


def _flow(screen, f, kw_counts, request_desc, uniq):
    eps = [e["endpoint"] for e in uniq[:4]]
    return {
        "screen": screen,
        "file": f.get("name"),
        "request_desc": request_desc,
        "endpoints": eps,
        "keywords": kw_counts,
    }
