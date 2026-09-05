# Escáner de código JavaScript: llamadas AJAX/fetch, URLs, keywords de KG,
# SignalR/WebSocket, uso de storage y variables de base.
import re

from ..patterns import (
    URL_RE, ROOT_PATH_RE, QR_PATH_RE, AJAX_CALL_RE, FETCH_URL_RE,
    JQ_METHOD_URL_RE, AJAX_URL_KEY_RE, AXIOS_URL_RE, WS_URL_RE,
    SIGNALR_OLD_RE, SIGNALR_NEW_RE, JSON_STRINGIFY_RE, FORM_DATA_RE,
    STORAGE_RE, KG_KEYWORDS, is_static_path, HTTP_VERBS,
)

_kg_re = {label: re.compile(pat, re.IGNORECASE) for label, pat in KG_KEYWORDS.items()}
_basevar_re = re.compile(
    r"(?:var|let|const)\s+(baseUrl|baseURL|apiUrl|apiURL|urlBase|URL_BASE|BASE_URL)\s*=\s*['\"]([^'\"]+)['\"]"
)
_jq_method_re = re.compile(r"\$\.(get|post|put|delete|getJSON)\b")
_axios_verb_re = re.compile(r"axios\.(get|post|put|patch|delete)\b")
_method_key_re = re.compile(r"method\s*:\s*['\"]([A-Z]+)['\"]", re.IGNORECASE)

SNIPPET_W = 150
URL_LOOKAHEAD = 600
VERB_MAP = {"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH",
            "delete": "DELETE", "getJSON": "GET"}


def _line(text, pos):
    return text.count("\n", 0, pos) + 1


def _snippet(text, pos, width=SNIPPET_W):
    s = max(0, pos - 40)
    e = min(len(text), pos + width)
    frag = text[s:e]
    return ("..." if s > 0 else "") + frag + ("..." if e < len(text) else "")


def _norm(v):
    return v.strip().strip("'\"").strip()


class JsScan:
    def __init__(self):
        self.ajax_calls = []
        self.url_candidates = []
        self.keyword_counts = {}
        self.keyword_hits = []
        self.signalr_hits = []
        self.hub_urls = []
        self.websockets = []
        self.base_vars = {}
        self.api_usage = {"json_stringify": 0, "formdata": 0,
                          "localStorage": False, "sessionStorage": False}
        self.storage_refs = []
        self.inline_chunks = 0

    def to_dict(self):
        return {
            "ajax_calls": self.ajax_calls[:200],
            "url_candidates": self.url_candidates[:400],
            "keyword_counts": self.keyword_counts,
            "keyword_hits": self.keyword_hits[:300],
            "signalr": {"hits": self.signalr_hits[:50], "hub_urls": self.hub_urls},
            "websockets": self.websockets,
            "base_vars": self.base_vars,
            "api_usage": self.api_usage,
        }


def scan_js(text: str, source: str = "") -> JsScan:
    out = JsScan()
    text = text or ""

    # --- Llamadas ajax con URL literal -------------------------------
    for m in JQ_METHOD_URL_RE.finditer(text):
        verb, url = m.group(1), _norm(m.group(2))
        if not url or url.startswith("("):
            continue
        out.ajax_calls.append({
            "method": VERB_MAP.get(verb, verb.upper()), "url": url, "file": source,
            "line": _line(text, m.start()), "offset": m.start(),
            "snippet": _snippet(text, m.start(), 120),
        })
        _push_url(out, url, "ajax-literal", VERB_MAP.get(verb, verb.upper()),
                  source, m.start(), text)

    for m in FETCH_URL_RE.finditer(text):
        url = _norm(m.group(1))
        verb = "GET"
        seg_opts = text[m.end():m.end() + 160]
        mm = re.search(r"method\s*:\s*['\"]([A-Z]+)['\"]", seg_opts)
        if mm:
            verb = mm.group(1).upper()
        if url.startswith(("`", "$")):
            out.url_candidates.append({
                "value": url, "kind": "template", "method": verb, "file": source,
                "line": _line(text, m.start()), "offset": m.start(),
                "snippet": _snippet(text, m.start(), 120), "is_static": False,
            })
            continue
        out.ajax_calls.append({
            "method": verb, "url": url, "file": source,
            "line": _line(text, m.start()), "offset": m.start(),
            "snippet": _snippet(text, m.start(), 120),
        })
        _push_url(out, url, "fetch", verb, source, m.start(), text)

    for m in AXIOS_URL_RE.finditer(text):
        verb, url = m.group(1), _norm(m.group(2))
        out.ajax_calls.append({
            "method": VERB_MAP.get(verb, verb.upper()), "url": url, "file": source,
            "line": _line(text, m.start()), "offset": m.start(),
            "snippet": _snippet(text, m.start(), 120),
        })
        _push_url(out, url, "axios", VERB_MAP.get(verb, verb.upper()),
                  source, m.start(), text)

    for m in AJAX_CALL_RE.finditer(text):
        seg = text[m.start():m.start() + URL_LOOKAHEAD]
        um = AJAX_URL_KEY_RE.search(seg)
        if not um:
            continue
        url = _norm(um.group(1))
        if not url:
            continue
        method = "GET"
        mm = _method_key_re.search(seg)
        if mm:
            method = mm.group(1).upper()
        else:
            jm = _jq_method_re.search(text[max(0, m.start() - 80):m.start() + 10])
            if jm:
                method = VERB_MAP.get(jm.group(1), jm.group(1).upper())
        ctx_kind = "ajax-obj" if not url.startswith(("`", "$", "+")) else "template"
        out.ajax_calls.append({
            "method": method, "url": url, "file": source,
            "line": _line(text, m.start()), "offset": m.start() + um.start(1),
            "snippet": _snippet(text, m.start() + um.start(1), 140),
        })
        _push_url(out, url, ctx_kind, method, source, m.start() + um.start(1), text)

    # --- URLs sueltas (raíz y absolutas) ------------------------------
    for m in URL_RE.finditer(text):
        v = m.group(0).rstrip(".,;)'\"`")
        if is_static_path(v):
            continue
        out.url_candidates.append({
            "value": v, "kind": "full-url", "method": "", "file": source,
            "line": _line(text, m.start()), "offset": m.start(),
            "snippet": _snippet(text, m.start()), "is_static": is_static_path(v),
        })

    seen_paths = set()
    for pat, kind in ((ROOT_PATH_RE, "root-path"), (QR_PATH_RE, "qr-path")):
        for m in pat.finditer(text):
            v = _norm(m.group(1))
            if not v or v in seen_paths or v.startswith(("//", "#", "?")):
                continue
            seen_paths.add(v)
            st = is_static_path(v)
            if st and kind == "root-path":
                continue  # assets estáticos se catalogan aparte
            out.url_candidates.append({
                "value": v, "kind": kind, "method": "", "file": source,
                "line": _line(text, m.start()), "offset": m.start(),
                "snippet": _snippet(text, m.start()), "is_static": st,
            })

    # --- Variables de base ---------------------------------------------
    for m in _basevar_re.finditer(text):
        out.base_vars[m.group(1)] = m.group(2)

    # --- Keywords KG / dominio ------------------------------------------
    for label, rx in _kg_re.items():
        hits = list(rx.finditer(text))
        out.keyword_counts[label] = len(hits)
        for m in hits[:12]:
            out.keyword_hits.append({
                "keyword": label, "matched": m.group(0), "file": source,
                "line": _line(text, m.start()), "offset": m.start(),
                "snippet": _snippet(text, m.start(), 110),
            })

    # --- SignalR / WebSocket ---------------------------------------------
    for m in SIGNALR_OLD_RE.finditer(text):
        out.signalr_hits.append({"file": source, "line": _line(text, m.start()),
                                 "snippet": _snippet(text, m.start(), 110)})
    for m in re.finditer(r"['\"`](/[A-Za-z0-9_\-./]*signalr[A-Za-z0-9_\-./]*)['\"`]", text):
        out.hub_urls.append(m.group(1))
    for m in SIGNALR_NEW_RE.finditer(text):
        out.signalr_hits.append({"file": source, "line": _line(text, m.start()),
                                 "snippet": _snippet(text, m.start(), 130)})
    for m in WS_URL_RE.finditer(text):
        out.websockets.append(_norm(m.group(1)))

    # --- Uso de APIs / storage ------------------------------------------
    out.api_usage["json_stringify"] = len(JSON_STRINGIFY_RE.findall(text))
    out.api_usage["formdata"] = len(FORM_DATA_RE.findall(text))
    out.api_usage["localStorage"] = bool(re.search(r"localStorage", text))
    out.api_usage["sessionStorage"] = bool(re.search(r"sessionStorage", text))
    for m in STORAGE_RE.finditer(text):
        out.storage_refs.append({"api": m.group(0), "file": source,
                                 "line": _line(text, m.start()),
                                 "snippet": _snippet(text, m.start(), 100)})
    return out


def _push_url(out: JsScan, url, kind, method, source, pos, text):
    if not url:
        return
    st = is_static_path(url)
    if st and kind in ("fetch", "ajax-literal", "axios"):
        return
    if url.startswith(("`", "$", "+")):
        kind = "template"
    out.url_candidates.append({
        "value": url, "kind": kind, "method": method, "file": source,
        "line": _line(text, pos), "offset": pos,
        "snippet": _snippet(text, pos, 120), "is_static": st,
    })
