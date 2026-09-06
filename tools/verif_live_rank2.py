# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "https://anapse.github.io/proagro/"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context().new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1500)
    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(6000)
    botones = pg.evaluate("!!document.querySelector('#rkPerHoy') && !!document.querySelector('#rkPerSem')")
    lbl = pg.evaluate("(document.querySelector('#panel-ranking .small.muted')||{}).innerText||''")
    filas = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    print("botones HOY/SEMANA:", botones)
    print("default:", lbl.splitlines()[0][:130] if lbl else "")
    print("filas top:", filas)
    if pg.evaluate("!!document.querySelector('#rkPerSem')"):
        pg.click("#rkPerSem")
        pg.wait_for_timeout(14000)
        lbl2 = pg.evaluate("(document.querySelector('#panel-ranking .small.muted')||{}).innerText||''")
        filas2 = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
        print("SEMANA real:", lbl2.splitlines()[0][:150] if lbl2 else "")
        print("filas semana:", filas2)
    print("errores:", errs)
    b.close()
