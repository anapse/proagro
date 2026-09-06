# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j

WORKER = "https://fake.workers.dev"
TOP = [
    {"posicion": 1, "nombre": "JUDITH ROBLES CALLAN", "kgExportable": 597.91, "kgDescarte": 0, "kgTotal": 597.91},
    {"posicion": 2, "nombre": "AURELIA CASAVILCA HUARIPAUCAR", "kgExportable": 585.21, "kgDescarte": 0, "kgTotal": 585.21},
    {"posicion": 3, "nombre": "JUANA ESTACIO CCARHUAS", "kgExportable": 556.47, "kgDescarte": 0, "kgTotal": 556.47},
    {"posicion": 4, "nombre": "ROXANA SOSA GOMEZ", "kgExportable": 551.91, "kgDescarte": 0, "kgTotal": 551.91},
    {"posicion": 5, "nombre": "AYDE SAYES MALPARTIDA", "kgExportable": 505.51, "kgDescarte": 0, "kgTotal": 505.51},
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

    def txt(sel):
        return pg.evaluate("(s)=>{const e=document.querySelector(s);return e?e.innerText:''}", sel)

    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(500)
    tabs = txt("#panel-ranking .subtabs")
    filas_top = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    prim_nombre = txt("#rkTopTable .rk-fila")
    pg.click("#rkTopTable .rk-fila")
    pg.wait_for_timeout(200)
    det = txt("#rkDetalleTop")
    pg.click("#rkTabBus")
    pg.wait_for_timeout(200)
    pg.fill("#rkNombre", "aurelia")
    pg.wait_for_timeout(200)
    bus = txt("#rkLista")
    pg.click("#rkLista .rk-fila")
    pg.wait_for_timeout(200)
    det2 = txt("#rkDetalle")
    print("pestañas:", "Ranking" in tabs and "Buscar por nombre" in tabs)
    print("filas TOP por defecto:", filas_top)
    print("primera fila:", prim_nombre.splitlines()[0] if prim_nombre else "")
    print("detalle top tiene nombre+total:", "JUDITH" in det and "597.9" in det)
    print("busqueda 'aurelia' 1 fila:", "AURELIA" in bus and "CASAVILCA" in bus)
    print("detalle busqueda:", "AURELIA" in det2 and "585.2" in det2)
    print("errores JS:", errs)
    b.close()
