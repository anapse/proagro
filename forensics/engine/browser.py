# Modo navegador real (Playwright/Chromium): captura pasiva de la red y de
# errores de consola. No introduce credenciales ni toca datos: solo navega.
import json
import time
from pathlib import Path

from .. import sha256_bytes, headers_safe
from ..engine.http import UA

MAX_JSON_BODY = 4 * 1024 * 1024
MAX_DOC_BODY = 12 * 1024 * 1024

KIND_MAP = {
    "document": "document", "script": "script", "xhr": "xhr", "fetch": "fetch",
    "stylesheet": "css", "image": "image", "media": "media", "font": "font",
    "websocket": "websocket", "other": "other",
}


def playwright_available():
    try:
        from playwright.sync_api import sync_playwright  # noqa
        return True
    except Exception:
        return False


def chromium_installed():
    if not playwright_available():
        return False
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            return bool(p.chromium.executable_path)
    except Exception:
        return False


def capture_page(url, wait_ms=12000, bodies_dir=None, log=None):
    """
    Navega a `url` y observa: requests/responses (método, status, content-type,
    tamaño, tiempo), errores de consola, pageerrors, peticiones fallidas y
    websockets. Devuelve dict con listas (sin escribir BD).
    """
    from playwright.sync_api import sync_playwright
    if log:
        log("playwright: lanzando chromium headless")
    start_req = {}
    entries = []
    console_errors = []
    page_errors = []
    failed = []
    ws_urls = []
    bodies_saved = []

    def say(x):
        if log:
            log(x)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, locale="es-PE",
                                  viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        def on_request(req):
            start_req[req] = time.perf_counter()

        def on_response(resp):
            req = resp.request
            t0 = start_req.pop(req, None)
            total_ms = (time.perf_counter() - t0) * 1000.0 if t0 else None
            try:
                ctype = resp.headers.get("content-type", "")
            except Exception:
                ctype = ""
            entry = {
                "url": req.url, "method": req.method,
                "status": resp.status,
                "kind": KIND_MAP.get(req.resource_type, req.resource_type or "other"),
                "content_type": ctype,
                "size": None, "total_ms": round(total_ms, 1) if total_ms else None,
                "initiator": "page" if req.resource_type == "document" else None,
                "sha256": None,
            }
            # Cuerpos de JSON/XHR/fetch y del documento (con tope) para evidencia
            save_body = req.resource_type in ("xhr", "fetch") or "json" in ctype
            if save_body or req.resource_type == "document":
                try:
                    body = resp.body()
                    cap = MAX_JSON_BODY if save_body else MAX_DOC_BODY
                    if len(body) <= cap:
                        entry["size"] = len(body)
                        entry["sha256"] = sha256_bytes(body)
                        if bodies_dir and (save_body or req.resource_type == "document"):
                            Path(bodies_dir).mkdir(parents=True, exist_ok=True)
                            idx = len(bodies_saved) + 1
                            ext = "json" if "json" in ctype or save_body else "html"
                            fname = f"b{idx:03d}_{ext}.bin" if ext == "bin" else f"b{idx:03d}.{ext}"
                            fp = Path(bodies_dir) / fname
                            fp.write_bytes(body)
                            bodies_saved.append({
                                "file": fname, "url": req.url, "method": req.method,
                                "status": resp.status, "sha256": entry["sha256"],
                                "size": len(body), "kind": entry["kind"],
                            })
                    else:
                        entry["size"] = len(body)
                except Exception:
                    pass
            entries.append(entry)

        def on_requestfailed(req):
            try:
                err = req.failure
            except Exception:
                err = "unknown"
            failed.append({"url": req.url, "method": req.method, "error": err,
                           "ts": time.strftime("%Y-%m-%d %H:%M:%S")})

        def on_console(msg):
            if msg.type == "error":
                loc = msg.location
                console_errors.append({
                    "type": "console.error", "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "text": msg.text[:2000], "url": loc.get("url"),
                    "line": loc.get("lineNumber"), "column": loc.get("columnNumber"),
                })

        def on_pageerror(exc):
            page_errors.append({
                "type": "pageerror", "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                "text": str(exc)[:2000],
            })

        page.on("request", on_request)
        page.on("response", on_response)
        page.on("requestfailed", on_requestfailed)
        page.on("console", on_console)
        page.on("pageerror", on_pageerror)

        try:
            say(f"playwright: navegando a {url}")
            page.goto(url, wait_until="load", timeout=60000)
            say(f"playwright: página cargada, observando {wait_ms / 1000:.0f}s")
            # observar refrescos automáticos / polling
            page.wait_for_timeout(wait_ms)
            if page.url.startswith("http") and url in page.url:
                try:
                    title = page.title()
                except Exception:
                    title = ""
                say(f"playwright: título final: {title}")
        except Exception as e:
            page_errors.append({"type": "navegacion", "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "text": str(e)[:2000]})
        browser.close()

    return {
        "url": url,
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "entries": entries,
        "console_errors": console_errors,
        "page_errors": page_errors,
        "failed_requests": failed,
        "websockets": ws_urls,
        "bodies": bodies_saved,
    }


def html_to_pdf(html_path, pdf_path):
    """Genera PDF desde un HTML local usando Chromium (print)."""
    from playwright.sync_api import sync_playwright
    from pathlib import Path
    html_path = Path(html_path).resolve()
    pdf_path = Path(pdf_path)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(html_path.as_uri(), wait_until="networkidle", timeout=60000)
        page.pdf(path=str(pdf_path), format="A4", print_background=True,
                 margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})
        browser.close()
    return pdf_path
