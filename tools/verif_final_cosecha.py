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


JS_HOY = "(function(){var t=document.querySelector('#dashRes .dash-titulo h3').textContent;var fichas=[].map.call(document.querySelectorAll('#dashRes .fchip'),function(x){return x.textContent;});var filas=[].map.call(document.querySelectorAll('#dashRes .hrow'),function(x){return x.innerText.replace(/\\n/g,' | ');});var hay=document.getElementById('panel-qrkg').innerText.indexOf('avanzado')>=0;return {t:t,fichas:fichas,filas:filas,hayAvanzado:hay};})()"
JS_SEM = "(function(){var txt=document.getElementById('dashRes').innerText;return {cols:document.querySelectorAll('#dashRes .bcol').length,hrows:document.querySelectorAll('#dashRes .hrow').length,detDia:txt.indexOf('Detalle por d')>=0,titulo:document.querySelector('#dashRes .dash-titulo h3').textContent};})()"
JS_CL = "(function(){var cs=getComputedStyle(document.querySelector('#statusMsg'));return {status:cs.color,fondoImg:getComputedStyle(document.body).backgroundImage.indexOf('fondo-agro')>=0};})()"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 1800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
    pg.wait_for_timeout(2400)
    pg.evaluate("applyTheme('light')")
    pg.evaluate("goTab('qrkg')")
    pg.wait_for_timeout(500)
    pg.evaluate("qrSetDatos('00000000','')")
    reqs = []

    def handler(route):
        try:
            ini = j.loads(route.request.post_data).get("fechaIni")
        except Exception:
            ini = "?"
        reqs.append(ini)
        if ini == "2026-09-03":
            route.fulfill(status=200, content_type="application/json",
                          body=j.dumps(resp_rango({"2026-09-04": [("07:00", 100), ("10:00", 150), ("13:00", 120)]})))
        elif ini == "2026-09-02":
            route.fulfill(status=200, content_type="application/json", body=j.dumps(resp_rango({})))
        elif ini == "2026-08-31":
            route.fulfill(status=200, content_type="application/json",
                          body=j.dumps(resp_rango({"2026-08-31": [("07:00", 200)], "2026-09-01": [("06:00", 80), ("09:00", 220)],
                                                   "2026-09-03": [("07:00", 250)]})))
        else:
            route.fulfill(status=200, content_type="application/json", body=j.dumps(resp_rango({})))
    pg.route("**/api/consultar-kg", handler)

    pg.click("#btnDashHoy")
    pg.wait_for_timeout(2500)
    hoy = pg.evaluate(JS_HOY)
    print("HOY:", hoy["t"])
    print("  chips (solo caritas):", hoy["fichas"])
    for f in hoy["filas"]:
        print("  ", f)
    print("  sin 'avanzado':", not hoy["hayAvanzado"])

    reqs.clear()
    pg.click("#btnDashSemana")
    pg.wait_for_timeout(2500)
    sem = pg.evaluate(JS_SEM)
    print("SEMANA: consultas:", len(reqs), "| columnas:", sem["cols"], "| filas detalle horas:", sem["hrows"],
          "| sin 'Detalle por día':", not sem["detDia"])
    print("  título:", sem["titulo"])

    cl = pg.evaluate(JS_CL)
    print("claro: statusMsg:", cl["status"], "| fondo con imagen:", cl["fondoImg"])
    pg.unroute("**/api/consultar-kg")
    pg.evaluate("goTab('endpoints')")
    pg.wait_for_timeout(1500)
    print("forense endpoints filas:", pg.evaluate("document.querySelectorAll('#epTable tbody tr').length"))
    print("errores JS:", errs or "ninguno")
    b.close()
