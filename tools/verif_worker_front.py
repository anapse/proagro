# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import json as j

WORKER = "https://fake.workers.dev"
resp_cosecha = {"encontrado": True, "nombre": "PRUEBA WORKER",
                "dias": [{"fecha": "2026-09-04", "registros": 2,
                          "items": [{"hora": "07:00", "kgExportable": "250", "kgDescarte": "0", "variedad": "AZUL"},
                                    {"hora": "11:00", "kgExportable": "190", "kgDescarte": "0", "variedad": "AZUL"}]}]}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1200, "height": 1500})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.route("**/api/**", lambda r: r.abort())  # modo estático
    pg.route(WORKER + "/api/cosecha", lambda r: r.fulfill(status=200, content_type="application/json", body=j.dumps(resp_cosecha)))
    pg.route(WORKER + "/api/ranking*", lambda r: r.fulfill(status=200, content_type="application/json",
                body=j.dumps({"ranking": [{"posicion": 1, "nombre": "JUAN PEREZ", "kgExportable": 97.21, "kgDescarte": 2.1, "kgTotal": 99.31}]})))
    pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
    pg.wait_for_timeout(2500)
    pg.evaluate("localStorage.setItem('pwf_worker', '" + WORKER + "'); workerUrl='" + WORKER + "'")
    pg.evaluate("goTab('qrkg')"); pg.wait_for_timeout(400)
    print("caja worker visible (estático):", pg.evaluate("!document.getElementById('workerCfg').classList.contains('hidden')"))
    pg.evaluate("qrSetDatos('00000000','')")
    pg.click("#btnDashHoy"); pg.wait_for_timeout(2500)
    print("HOY via worker:", pg.evaluate("document.querySelector('#dashRes .dash-titulo h3').textContent"),
          "| msg:", pg.evaluate("document.getElementById('dashMsg').textContent.slice(0,60)"))
    filas = pg.evaluate("[].map.call(document.querySelectorAll('#dashRes .hrow'),function(x){return x.innerText.replace(/\\n/g,' | ');})")
    for f in filas:
        print("   ", f)
    pg.evaluate("goTab('ranking')"); pg.wait_for_timeout(1500)
    print("ranking via worker:", pg.evaluate("(document.getElementById('rkBox')||{innerText:'n/a'}).innerText.split('\\n')[0]"))
    print("errores JS:", errs or "ninguno")
    b.close()
