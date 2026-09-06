# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

URL = "file:///C:/Users/Osiris/Desktop/PROAGRO-WEB-FORENSICS/web/index.html"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context()
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(1400)
    ov = pg.evaluate("document.querySelector('#welcomeOv').classList.contains('hidden')")
    titulo = pg.evaluate("(document.querySelector('#welcomeOv h2')||{}).innerText||''")
    print("overlay visible (no hidden):", not ov, "| titulo:", titulo)
    pg.click("#welOk")
    pg.wait_for_timeout(600)
    oculta = pg.evaluate("document.querySelector('#welcomeOv').classList.contains('hidden')")
    flag = pg.evaluate("localStorage.getItem('pwf_upd_v1')")
    print("oculto tras ENTENDIDO:", oculta, "| flag:", flag)
    pg.reload()
    pg.wait_for_timeout(900)
    ov2 = pg.evaluate("document.querySelector('#welcomeOv').classList.contains('hidden')")
    print("tras recargar NO se muestra:", ov2)
    share = pg.evaluate("!!document.querySelector('#btnShare')")
    pg.click("#btnShare")
    pg.wait_for_timeout(200)
    menu = pg.evaluate("!document.querySelector('#shareMenu').classList.contains('hidden')")
    items = pg.evaluate("Array.from(document.querySelectorAll('.share-item')).filter(i=>!i.classList.contains('hidden')).map(i=>i.innerText)")
    print("btn compartir:", share, "| menu abierto:", menu, "| items:", items)
    if any("Copiar" in i for i in items):
        pg.click("#shCopy")
        pg.wait_for_timeout(300)
        toast = pg.evaluate("(document.querySelector('#toast')||{}).innerText||''")
        print("toast:", toast)
    print("errores:", errs)
    b.close()
