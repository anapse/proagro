# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j

WORKER = "https://fake.workers.dev"
TOP = [
    {"posicion": 1, "nombre": "JUDITH ROBLES CALLAN", "kgExportable": 597.91, "kgDescarte": 0, "kgTotal": 597.91},
    {"posicion": 2, "nombre": "AURELIA CASAVILCA HUARIPAUCAR", "kgExportable": 585.21, "kgDescarte": 0, "kgTotal": 585.21},
]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context()
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("localStorage.setItem('pwf_worker','" + WORKER + "');")
    pg.route("**/api/*", lambda r: r.abort())
    pg.route(WORKER + "/api/ranking**", lambda r: r.fulfill(status=200, content_type="application/json",
                                                            body=j.dumps({"ranking": TOP, "lotes": [], "variedades": []})))
    pg.goto("file:///C:/Users/Osiris/Desktop/PROAGRO-WEB-FORENSICS/web/index.html")
    pg.wait_for_timeout(700)
    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(400)
    pg.click("#rkTopTable .rk-fila")
    pg.wait_for_timeout(300)
    det = pg.evaluate("document.querySelector('#rkDetalleTop').innerText")
    print("DETALLE TOP:", repr(det[:220]))
    pg.click("#rkTabBus")
    pg.wait_for_timeout(200)
    pg.fill("#rkNombre", "aurelia")
    pg.wait_for_timeout(300)
    pg.click("#rkLista .rk-fila")
    pg.wait_for_timeout(300)
    det2 = pg.evaluate("document.querySelector('#rkDetalle').innerText")
    print("DETALLE BUSCA:", repr(det2[:220]))
    print("errores:", errs)
    b.close()
