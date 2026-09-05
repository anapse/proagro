# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    for tema, tab, arch in [("light", "qrkg", "rev_light_cosecha"), ("dark", "qrkg", "rev_dark_cosecha"),
                            ("light", "endpoints", "rev_light_ep"), ("dark", "endpoints", "rev_dark_ep"),
                            ("light", "resumen", "rev_light_res"), ("dark", "resumen", "rev_dark_res")]:
        pg = b.new_page(viewport={"width": 1360, "height": 1900})
        pg.goto("http://127.0.0.1:3792/", wait_until="load", timeout=45000)
        pg.wait_for_timeout(2200)
        pg.evaluate("applyTheme('%s')" % tema)
        pg.evaluate("goTab('%s')" % tab)
        pg.wait_for_timeout(1600)
        pg.screenshot(path=arch + ".png", full_page=True)
        pg.close()
        print("ok", arch)
    b.close()
