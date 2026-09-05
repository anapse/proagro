# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    for tema, archivo, tab in [("light", "shot_light_cosecha.png", "qrkg"), ("dark", "shot_dark_cosecha.png", "qrkg"),
                                ("light", "shot_light_endpoints.png", "endpoints"), ("dark", "shot_dark_endpoints.png", "endpoints")]:
        pg = b.new_page(viewport={"width": 1280, "height": 1600})
        pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
        pg.wait_for_timeout(2000)
        if tema == "dark":
            pg.evaluate("applyTheme('dark')")
        else:
            pg.evaluate("applyTheme('light')")
        pg.evaluate("goTab('" + tab + "')")
        pg.wait_for_timeout(1800 if tab == "endpoints" else 400)
        if tab == "qrkg":
            pg.evaluate("qrSetDatos('00000000','')")
        pg.screenshot(path=archivo)
        print("guardado", archivo)
        pg.close()
    b.close()
