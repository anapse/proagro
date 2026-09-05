# -*- coding: utf-8 -*-
import json as j
from playwright.sync_api import sync_playwright


def resp_rango(por_fecha):
    dias = []
    for f, regs in por_fecha.items():
        if regs is None:
            continue
        dias.append({"fecha": f, "registros": len(regs),
                     "items": [{"hora": h, "kgExportable": str(k), "kgDescarte": "0", "variedad": "AZUL"} for h, k in regs]})
    return {"ok": True, "estado": "OK", "consulta": {"dni": "00000000"},
            "resultado": {"encontrado": len(dias) > 0, "registros": sum(len(x["items"]) for x in dias), "dias": dias},
            "meta": {"http_status": 200, "elapsed_ms": 40, "endpoint": "ConsultarKgVista", "params": {}}}


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 1700})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
    pg.wait_for_timeout(2400)
    pg.evaluate("goTab('qrkg')")
    pg.wait_for_timeout(400)
    pg.evaluate("qrSetDatos('00000000','')")

    def handler(route):
        try:
            ini = j.loads(route.request.post_data).get("fechaIni")
        except Exception:
            ini = "?"
        route.fulfill(status=200, content_type="application/json",
                      body=j.dumps(resp_rango({"2026-08-31": [("07:00", 200)],
                                               "2026-09-01": [("06:00", 80), ("09:00", 220)],
                                               "2026-09-03": [("07:00", 250)]})))
    pg.route("**/api/consultar-kg", handler)
    pg.click("#btnDashSemana")
    pg.wait_for_timeout(2500)
    bot = pg.evaluate("[].map.call(document.querySelectorAll('#dashRes .det-dia'), function(x){return {t:x.innerText.replace(/\\n/g,' '), act:x.classList.contains('active')};})")
    filas = pg.evaluate("[].map.call(document.querySelectorAll('#dashRes .hrow'), function(x){return x.innerText.replace(/\\n/g,' | ');})")
    print("botones:", bot)
    print("por defecto (último día = Jueves 03/09):", filas)
    # cambiar a Martes
    pg.evaluate("[].find.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.innerText.indexOf('Martes')>=0}).click()")
    pg.wait_for_timeout(400)
    r2 = pg.evaluate("(function(){var act=[].find.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.classList.contains('active');}).innerText.replace(/\\n/g,' '); var f=[].map.call(document.querySelectorAll('#dashRes .hrow'),function(x){return x.innerText.replace(/\\n/g,' | ');}); return {act:act,f:f};})()")
    print("al pulsar Martes -> activo:", r2["act"])
    for f in r2["f"]:
        print("   ", f)
    pg.unroute("**/api/consultar-kg")
    print("errores JS:", errs or "ninguno")
    b.close()
