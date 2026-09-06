# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j
from datetime import date, timedelta

WORKER = "https://fake.workers.dev"
H = date.today()
ayer = (H - timedelta(days=1)).isoformat()
lunes = (H - timedelta(days=((H.weekday() + 1) % 7))).isoformat()
P1 = {"posicion": 1, "nombre": "KATY TALIA AQUINO FLORES", "kgExportable": 99.7, "kgDescarte": 0, "kgTotal": 99.7}
P2 = {"posicion": 2, "nombre": "CRISTIAN JUAQUIN PEREZ", "kgExportable": 97.4, "kgDescarte": 0, "kgTotal": 97.4}


def resp(route):
    q = route.request.url.split("fechaIni=")[1][:10]
    data = [P1, P2] if q == ayer else []
    return route.fulfill(status=200, content_type="application/json", body=j.dumps({"ranking": data}))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context().new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("localStorage.setItem('pwf_worker','" + WORKER + "');")
    pg.route("**/api/*", lambda r: r.abort())
    pg.route(WORKER + "/api/ranking**", resp)
    pg.goto("file:///C:/Users/Osiris/Desktop/PROAGRO-WEB-FORENSICS/web/index.html")
    pg.wait_for_timeout(600)
    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(1000)
    lbl1 = pg.evaluate("document.querySelector('#panel-ranking .small.muted').innerText")
    filas1 = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    print("HOY default:", ("ayer" in lbl1), "| label:", lbl1.splitlines()[0][:70], "| filas:", filas1)
    pg.click("#rkPerSem")
    pg.wait_for_timeout(2500)
    lbl2 = pg.evaluate("document.querySelector('#panel-ranking .small.muted').innerText").splitlines()[0][:130]
    filas2 = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    print("SEMANA:", lbl2, "| filas:", filas2)
    print("errores:", errs)
    b.close()
