# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "https://anapse.github.io/proagro/"
WORKER = "https://proagro-api.elherreroanapse.workers.dev"


def t(pg, sel):
    return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }", sel)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1600)
    print("título:", pg.title(), "| estático:", pg.evaluate("() => !!window.staticMode"))
    # configurar worker (como haría el usuario) y probarlo
    pg.evaluate("(w) => { localStorage.setItem('pwf_worker', w); }", WORKER)
    pg.reload()
    pg.wait_for_timeout(1600)
    pg.evaluate("() => { goTab('qrkg'); }")
    pg.wait_for_timeout(500)
    pg.evaluate("() => { document.getElementById('btnWorkerTest').click(); }")
    pg.wait_for_timeout(3500)
    estado = pg.evaluate("() => { const s = document.getElementById('workerState'); return s ? s.textContent : ''; }")
    print("🧪 Worker:", estado)
    # RANKING real vía worker
    pg.evaluate("() => { goTab('ranking'); }")
    pg.wait_for_timeout(4000)
    rk = t(pg, "#rkBox").replace("\n", " | ")
    print("RANKING:", rk[:200])
    # COSECHA HOY con DNI sin datos (00000000) -> mensaje real del worker (404 cosecha esperado)
    pg.evaluate("() => { goTab('qrkg'); }")
    pg.wait_for_timeout(400)
    pg.evaluate("() => { document.getElementById('dashDniInp').value = '00000000'; document.getElementById('btnWhoAplicar').click(); }")
    pg.wait_for_timeout(5000)
    print("HOY:", t(pg, "#dashMsg")[:200])
    print("FECHA presente:", pg.evaluate("() => !!document.getElementById('btnDashFecha')"))
    print("errores JS:", len(errs))
    b.close()
