# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
URL = "https://anapse.github.io/proagro/"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 1600})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_timeout(3500)
    print("titulo:", pg.title())
    print("staticMode:", pg.evaluate("typeof staticMode!=='undefined' && staticMode"))
    print("logo cargado:", pg.evaluate("(function(){var i=document.querySelector('.brand-logo');return !!i&&i.complete&&i.naturalWidth>0;})()"))
    pg.evaluate("goTab('qrdigital')"); pg.wait_for_timeout(400)
    pg.fill("#qdDni", "12345678")
    pg.click("#btnQrGen"); pg.wait_for_timeout(900)
    print("QR genera (canvas):", pg.evaluate("!!document.querySelector('#qdImg canvas')"))
    pg.evaluate("goTab('endpoints')"); pg.wait_for_timeout(500)
    print("forense aviso:", pg.evaluate("document.getElementById('panel-endpoints').innerText.includes('Disponible en la versión local')"))
    pg.evaluate("goTab('qrkg')"); pg.wait_for_timeout(400)
    pg.evaluate("qrSetDatos('00000000','')")
    pg.click("#btnDashHoy"); pg.wait_for_timeout(7000)
    print("cosecha HOY (desde GH Pages):", pg.evaluate("document.getElementById('dashMsg').textContent.slice(0,170)"))
    pg.evaluate("goTab('ranking')"); pg.wait_for_timeout(6000)
    print("ranking:", pg.evaluate("(document.getElementById('rkBox')||{innerText:'n/a'}).innerText.slice(0,110)"))
    print("errores JS:", errs or "ninguno")
    b.close()
