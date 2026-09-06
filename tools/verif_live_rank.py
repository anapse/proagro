# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "https://anapse.github.io/proagro/"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context().new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1200)
    pg.evaluate("loadTab('ranking')")
    pg.wait_for_timeout(4000)

    def txt(sel):
        return pg.evaluate("(s)=>{const e=document.querySelector(s);return e?e.innerText.slice(0,300):''}", sel)

    tabs = pg.evaluate("document.querySelectorAll('#panel-ranking .subtabs button').length")
    top_filas = pg.evaluate("document.querySelectorAll('#rkTopTable .rk-fila').length")
    cuerpo = pg.evaluate("document.querySelector('#rkTopTable,#rkTopView').innerText.slice(0,200)")
    print("tabs ranking:", tabs, "| filas top por defecto:", top_filas)
    print("contenido:", cuerpo.replace(chr(10), " | ")[:220])
    print("errores JS:", errs)
    b.close()
