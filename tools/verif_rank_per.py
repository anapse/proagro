# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j
from datetime import date, timedelta

WORKER = "https://fake.workers.dev"
H = date.today()
hoy = H.isoformat()
ayer = (H - timedelta(days=1)).isoformat()
lunes = (H - timedelta(days=(H.weekday() + 1) % 7)).isoformat()

P1 = {"posicion": 1, "nombre": "KATY TALIA AQUINO FLORES", "kgExportable": 99.7, "kgDescarte": 0, "kgTotal": 99.7}
P2 = {"posicion": 2, "nombre": "CRISTIAN JUAQUIN PEREZ", "kgExportable": 97.4, "kgDescarte": 0, "kgTotal": 97.4}
# datos: solo AYER (hoy nunca publica); en semana solo martes(jueves?) usar lunes+3
dias = {ayer: [P1, P2]}

def resp(route):
    q = route.request.url.split("fechaIni=")[1][:10]
    if q == lunes or q == hoy or q == ayer:
        if q == ayer:
            return route.fulfill(status=200, content_type="application/json", body=j.dumps({"ranking": dias[q]}))
        return route.fulfill(status=200, content_type="application/json", body=j.dumps({"ranking": []}))
    return route.fulfill(status=200, content_type="application/json", body=j.dumps({"ranking": []}))

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

    def txt(sel):
        return pg.evaluate("(s)=>{const e=document.querySelector(s);return e?e.innerText.slice(0,300):''}", sel)

    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(1200)
    lbl1 = txt("#panel-ranking .small.muted")
    filas = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    print("HOY por defecto -> ayer:", "ayer" in lbl1 and "KATY" in lbl1, "| filas:", filas)
    pg.click("#rkPerSem")
    pg.wait_for_timeout(2500)
    lbl2 = txt("#panel-ranking .small.muted")
    filas2 = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    print("ESTA SEMANA (solo ayer publicado):", lbl2.splitlines()[0][:120])
    print("errores JS:", errs)
    b.close()
