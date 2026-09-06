# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/Osiris/Desktop/PROAGRO-WEB-FORENSICS/web/index.html"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context().new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # simular que YA fue vista antes (debe salir igual, siempre)
    pg.add_init_script("localStorage.setItem('pwf_upd_v1','1');")
    pg.goto(URL)
    pg.wait_for_timeout(1500)
    vis1 = pg.evaluate("!document.querySelector('#welcomeOv').classList.contains('hidden')")
    btns = pg.evaluate("getComputedStyle(document.querySelector('.welc-ok')).display")
    print("sale con flag previo:", vis1, "| boton ENTENDIDO oculto:", btns == "none")
    # cierre por clic
    pg.mouse.click(5, 5)
    pg.wait_for_timeout(600)
    oculto = pg.evaluate("document.querySelector('#welcomeOv').classList.contains('hidden')")
    print("cierra al hacer clic:", oculto)
    # auto-cierre ~5s: recargar y esperar 6s sin clic
    pg.reload()
    pg.wait_for_timeout(1500)
    vis2 = pg.evaluate("!document.querySelector('#welcomeOv').classList.contains('hidden')")
    pg.wait_for_timeout(5600)
    oculto2 = pg.evaluate("document.querySelector('#welcomeOv').classList.contains('hidden')")
    print("segunda visita sale:", vis2, "| auto-cierre 5s:", oculto2)
    print("errores:", errs)
    b.close()
