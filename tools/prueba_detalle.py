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
    pg = b.new_page(viewport={"width": 1200, "height": 1700})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
    pg.wait_for_timeout(2200)
    pg.evaluate("goTab('qrkg')")
    pg.wait_for_timeout(400)
    pg.evaluate("qrSetDatos('00000000','')")
    requests = []

    def handler(route):
        try:
            ini = j.loads(route.request.post_data).get("fechaIni")
        except Exception:
            ini = "?"
        requests.append(ini)
        if ini == "2026-09-03":
            route.fulfill(status=200, content_type="application/json",
                          body=j.dumps(resp_rango({"2026-09-04": [("07:00", 100), ("10:00", 150), ("13:00", 120)]})))
        elif ini == "2026-09-02":
            route.fulfill(status=200, content_type="application/json", body=j.dumps(resp_rango({})))
        elif ini == "2026-08-31":
            route.fulfill(status=200, content_type="application/json",
                          body=j.dumps(resp_rango({"2026-08-31": [("07:00", 200)], "2026-09-01": [("07:00", 300)],
                                                   "2026-09-03": [("07:00", 250)]})))
        else:
            route.fulfill(status=200, content_type="application/json", body=j.dumps(resp_rango({})))
    pg.route("**/api/consultar-kg", handler)

    pg.click("#btnDashHoy")
    pg.wait_for_timeout(2500)
    t = pg.evaluate("document.querySelector('#dashRes .dash-titulo h3').textContent")
    det = pg.evaluate("document.getElementById('dashRes').innerText.includes('Detalle de pesos')")
    nf = pg.evaluate("document.querySelectorAll('#dashRes .hrow').length")
    f1 = pg.evaluate("[...document.querySelectorAll('#dashRes .hrow')][0].innerText.replace(/\\n/g, ' | ')")
    print("HOY:", t, "| detalle:", det, "| filas por hora:", nf)
    print("  fila más reciente:", f1)

    requests.clear()
    pg.click("#btnDashSemana")
    pg.wait_for_timeout(2500)
    tabla = pg.evaluate("document.getElementById('dashRes').innerText.includes('Detalle por día')")
    filas = pg.evaluate("[...document.querySelectorAll('#dashRes .det-tbl tbody tr')].map(x=>x.innerText.replace(/\\n/g,' | '))")
    print("SEMANA: nº consultas:", len(requests), "| tabla:", tabla)
    for f in filas:
        print("   ", f)
    pg.unroute("**/api/consultar-kg")
    print("errores JS:", errs or "ninguno")
    b.close()
