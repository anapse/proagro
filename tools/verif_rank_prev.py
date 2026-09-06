# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j
from datetime import date, timedelta

WORKER = "https://fake.workers.dev"
H = date.today()
lunes = H - timedelta(days=H.weekday())
prev = [(lunes - timedelta(days=7)), (lunes - timedelta(days=6))]
P1 = {"posicion": 1, "nombre": "KATY TALIA AQUINO FLORES", "kgExportable": 55.0, "kgDescarte": 0, "kgTotal": 55.0}
P2 = {"posicion": 2, "nombre": "CRISTIAN JUAQUIN PEREZ", "kgExportable": 44.0, "kgDescarte": 0, "kgTotal": 44.0}


def resp(route):
    q = route.request.url.split("fechaIni=")[1][:10]
    data = [P1] if q in (prev[0].isoformat(), prev[1].isoformat()) else []
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
    pg.wait_for_timeout(600)
    pg.click("#rkPerSem")
    pg.wait_for_timeout(3000)
    lbl = pg.evaluate("document.querySelector('#panel-ranking .small.muted').innerText").splitlines()[0]
    row1 = pg.evaluate("document.querySelector('#rkTopTable .rk-fila').innerText")
    print("label:", lbl[:150])
    print("fila1 (suma 2 días KATY 55+55=110):", row1.splitlines()[0] if row1 else "")
    print("errores:", errs)
    b.close()
