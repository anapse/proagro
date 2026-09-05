# Consultas públicas controladas: ranking, ventanas de fecha, consistencia,
# sondas GET seguras (solo lectura) y prueba de concurrencia opcional.
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

from .http import get
from ..patterns import is_read_action, is_write_action

RANKING_PATH = "/QrKgAra/ObtenerRankingVista"
DEFAULT_WINDOW = {"fechaIni": "2026-09-01", "fechaFin": "2026-09-03"}


def ranking_url(base, top=5000, fechaIni=None, fechaFin=None, lotes="", variedades=""):
    w = DEFAULT_WINDOW if not fechaIni else {}
    q = urlencode({
        "top": top,
        "fechaIni": fechaIni or w.get("fechaIni", ""),
        "fechaFin": fechaFin or w.get("fechaFin", ""),
        "lotes": lotes or "",
        "variedades": variedades or "",
    })
    return f"{base}{RANKING_PATH}?{q}"


def parse_ranking(body: bytes):
    """Estructura JSON del ranking + métricas de Kg inequívocas."""
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
    except Exception as e:
        return {"json_ok": False, "error": str(e)}
    out = {"json_ok": True}
    ranking = data.get("ranking")
    if not isinstance(ranking, list):
        return {**out, "error": "sin clave 'ranking' de tipo lista",
                "keys": sorted(data.keys())}
    out["records"] = len(ranking)
    nums = {"kgExportable": 0.0, "kgDescarte": 0.0, "kgTotal": 0.0}
    for r in ranking:
        for k in nums:
            v = r.get(k)
            if isinstance(v, (int, float)):
                nums[k] += v
    out["sum_kgExportable"] = round(nums["kgExportable"], 2)
    out["sum_kgDescarte"] = round(nums["kgDescarte"], 2)
    out["sum_kgTotal"] = round(nums["kgTotal"], 2)
    fields = set()
    for r in ranking[:1]:
        fields = set(r.keys())
    out["fields"] = sorted(fields)
    # orden del ranking: kgTotal no creciente (posiciones 1..n)
    viol = 0
    prev = None
    for r in ranking:
        v = r.get("kgTotal")
        if isinstance(v, (int, float)) and prev is not None and v > prev + 1e-9:
            viol += 1
        if isinstance(v, (int, float)):
            prev = v
    out["ordering_violations"] = viol
    out["first"] = ranking[0] if ranking else None
    out["last"] = ranking[-1] if ranking else None
    out["lotes"] = data.get("lotes")
    out["variedades"] = data.get("variedades")
    return out


def consistency_run(base, n=5, delay_ms=500, **kw):
    """n consultas GET idénticas; devuelve lista de resultados y detección."""
    url = ranking_url(base, **kw)
    runs = []
    for i in range(n):
        if i and delay_ms:
            time.sleep(delay_ms / 1000.0)
        p = get(url)
        rec = {
            "n": i + 1,
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": p.status, "size": p.size,
            "ttfb_ms": round(p.ttfb_ms, 1), "total_ms": round(p.total_ms, 1),
            "sha256": p.sha256, "error": p.error,
        }
        if p.status == 200 and not p.error:
            st = parse_ranking(p.body)
            rec["records"] = st.get("records")
            rec["sum_kgTotal"] = st.get("sum_kgTotal")
            rec["json_ok"] = st.get("json_ok")
        runs.append(rec)
    return {"url": url, "runs": runs, "consistent": _detect(runs)}


def _detect(runs):
    hashes = [r.get("sha256") for r in runs if r.get("status") == 200 and not r.get("error")]
    return {
        "all_identical": len(set(hashes)) <= 1 if hashes else None,
        "unique_hashes": sorted(set(hashes)) if hashes else [],
        "counts": [r.get("records") for r in runs if "records" in r],
        "sums_kgTotal": [r.get("sum_kgTotal") for r in runs if "sum_kgTotal" in r],
        "statuses": [r.get("status") for r in runs],
        "sizes": [r.get("size") for r in runs],
    }


def diff_ranking_bodies(body_a: bytes, body_b: bytes, top_n=15):
    """Compara dos respuestas de ranking y describe cambios registro a registro."""
    try:
        a = json.loads(body_a.decode("utf-8", errors="replace"))
        b = json.loads(body_b.decode("utf-8", errors="replace"))
    except Exception:
        return None
    ra, rb = a.get("ranking", []), b.get("ranking", [])
    out = {"count_a": len(ra), "count_b": len(rb), "changed": [], "added": [], "removed": []}
    ma = {r.get("posicion"): r for r in ra}
    mb = {r.get("posicion"): r for r in rb}
    for pos in ma:
        if pos in mb and ma[pos] != mb[pos]:
            out["changed"].append({"posicion": pos, "antes": ma[pos], "despues": mb[pos]})
    for pos in mb:
        if pos not in ma:
            out["added"].append(mb[pos])
    for pos in ma:
        if pos not in mb:
            out["removed"].append(ma[pos])
    return out


def safe_probe_candidates(base, endpoints_rows, max_n=8):
    """Selecciona endpoints de LECTURA seguros para sondear con GET (read-only).
    Excluye por construcción cualquier nombre con marca de escritura."""
    base_path = base.split("//", 1)[-1]
    cands = []
    for r in endpoints_rows:
        p = r["path"]
        if not p.startswith(("/QrKgAra/", "/api/", "/")):
            continue
        if "signalr" in p.lower():
            continue
        act = None
        for seg in p.split("/"):
            if seg[:1].isupper():
                act = seg
                break
        if not act:
            continue
        if not is_read_action(act):
            continue
        if "{" in p:
            continue
        if r.get("method") and r["method"] not in ("", "GET"):
            continue
        cands.append({"path": p, "act": act, "method": "GET",
                      "classification": r.get("classification", "REFERENCIADO")})
    # prioriza acciones tipo ranking/detalle; luego el resto
    def score(c):
        s = 0
        if "Ranking" in c["act"]:
            s -= 10
        if c["classification"] == "OBSERVADO":
            s -= 5
        return s
    cands.sort(key=score)
    return cands[:max_n]


def probe_get(base, path, timeout=(12, 45)):
    url = base + path if path.startswith("/") else path
    return get(url, timeout=timeout)


def date_window_run(base, windows):
    """Consultas individuales por ventana de fecha (estructura + totales)."""
    out = []
    for w in windows:
        p = get(ranking_url(base, **w))
        rec = {"window": w, "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
               "status": p.status, "size": p.size, "ttfb_ms": round(p.ttfb_ms, 1),
               "total_ms": round(p.total_ms, 1), "sha256": p.sha256, "error": p.error}
        if p.status == 200 and not p.error:
            st = parse_ranking(p.body)
            rec["records"] = st.get("records")
            rec["sum_kgTotal"] = st.get("sum_kgTotal")
            rec["json_ok"] = st.get("json_ok")
            rec["structure_error"] = st.get("error")
        out.append(rec)
    return out


def concurrency_run(url, level=5):
    """Prueba opcional controlada de LECTURA (nunca automática)."""
    results = []
    def one(i):
        p = get(url, timeout=(15, 60))
        return {"n": i + 1, "ts": time.strftime("%H:%M:%S"), "status": p.status,
                "size": p.size, "ttfb_ms": round(p.ttfb_ms, 1),
                "total_ms": round(p.total_ms, 1), "sha256": p.sha256,
                "error": p.error}
    with ThreadPoolExecutor(max_workers=level) as ex:
        results = list(ex.map(one, range(level)))
    results.sort(key=lambda r: r["n"])
    errs = [r for r in results if r.get("error") or r.get("status") != 200]
    return {"url": url, "level": level, "results": results,
            "errors": errs, "ok": len(errs) == 0}
