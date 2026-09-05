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
        if ini == "2026-08-31":  # semana Lun(31/08)..Vie(04/09): solo Jueves(03) con datos
            route.fulfill(status=200, content_type="application/json",
                          body=j.dumps(resp_rango({"2026-09-03": [("07:00", 250), ("11:00", 190)]})))
        else:
            route.fulfill(status=200, content_type="application/json", body=j.dumps(resp_rango({})))
    pg.route("**/api/consultar-kg", handler)

    pg.click("#btnDashHoy")  # viernes -> muestra ayer (Jueves 03) y detalle con TODOS los días
    pg.wait_for_timeout(3000)
    info = pg.evaluate("(function(){var t=document.querySelector('#dashRes .dash-titulo h3').textContent;var b=[].map.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.innerText.replace(/\\n/g,' ')+'|'+x.classList.contains('active');});var filas=[].map.call(document.querySelectorAll('#dashRes .hrow'),function(x){return x.innerText.replace(/\\n/g,' | ');});return{t:t,b:b,filas:filas};})()")
    print("HOY:", info["t"])
    print("  botones (todos los días):", info["b"])
    for f in info["filas"]:
        print("   fila:", f)
    # pulsar Miércoles (sin datos)
    pg.evaluate("[].find.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.innerText.indexOf('Mi')>=0;}).click()")
    pg.wait_for_timeout(400)
    m = pg.evaluate("(function(){var act=[].find.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.classList.contains('active');}).innerText.replace(/\\n/g,' ');var txt=document.querySelector('#dashRes .det-card').innerText;return{act:act,noHay:txt.indexOf('NO HAY DATOS')>=0};})()")
    print("  al pulsar Miércoles -> activo:", m["act"], "| muestra NO HAY DATOS:", m["noHay"])
    # ESTA SEMANA igual con todos los botones
    pg.evaluate("qrSetDatos('00000000','')")
    pg.click("#btnDashSemana")
    pg.wait_for_timeout(2500)
    sem = pg.evaluate("(function(){var b=[].map.call(document.querySelectorAll('#dashRes .det-dia'),function(x){return x.innerText.replace(/\\n/g,' ');});return b;})()")
    print("SEMANA botones:", sem)
    pg.unroute("**/api/consultar-kg")
    print("errores JS:", errs or "ninguno")
    b.close()
