# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3792/"


def texto(pg, sel):
    return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }", sel)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1500)
    estatico = pg.evaluate("() => !!window.staticMode")
    worker_box_oculta = pg.evaluate("() => { const w = document.getElementById('workerCfg'); return !w || w.classList.contains('hidden'); }")
    # ir a COSECHA y consultar ESTA SEMANA con DNI sin datos (proxy real local)
    pg.evaluate("() => { goTab('qrkg'); }")
    pg.wait_for_timeout(400)
    pg.evaluate("() => { document.getElementById('dashDniInp').value = '00000000'; document.getElementById('btnWhoAplicar').click(); }")
    pg.wait_for_timeout(4000)
    dash = pg.evaluate("() => { const m = document.getElementById('dashMsg'); return m ? m.innerText : ''; }")
    hay_fecha = pg.evaluate("() => !!document.getElementById('btnDashFecha') && !!document.getElementById('dashFecha')")
    # FORENSE resumen (modo local con API)
    pg.evaluate("() => { goTab('endpoints'); }")
    pg.wait_for_timeout(2500)
    inv = pg.evaluate("() => { const t = document.getElementById('invTable'); return t ? t.rows.length : -1; }")
    print("local estático(no):", estatico, "| worker box oculta:", worker_box_oculta)
    print("mensaje HOY (00000000):", dash[:110])
    print("botón FECHA presente:", hay_fecha, "| filas inventario:", inv, "| errores JS:", len(errs))
    b.close()
