# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

sizes = [
    (320, 568, "320px"),
    (360, 800, "360px"),
    (375, 812, "375px"),
    (390, 844, "390px"),
    (393, 873, "393px"),
    (412, 915, "412px"),
    (430, 932, "430px"),
    (480, 800, "480px"),
    (768, 1024, "768px"),
    (1024, 768, "1024px"),
    (1366, 768, "1366px"),
    (1920, 1080, "1920px"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for w, h, label in sizes:
        page = browser.new_page()
        page.set_viewport_size({"width": w, "height": h})
        page.goto("http://localhost:8765/", wait_until="networkidle")
        page.wait_for_timeout(500)
        
        # Test different panels
        page.click('[data-area="empleados"]')  # default
        page.wait_for_timeout(200)
        
        # Check QR DIGITAL panel
        qr_panel = page.locator("#panel-qrdigital")
        if qr_panel.is_visible():
            qr_w = qr_panel.evaluate("el => el.scrollWidth")
            qr_over = qr_w > page.evaluate("window.innerWidth")
            qr_input = page.locator("#qdDni")
            input_w = qr_input.evaluate("el => el.scrollWidth") if qr_input.is_visible() else 0
            vp = page.evaluate("window.innerWidth")
            if input_w > vp: print(f"{label}: QR input overflow {input_w} > {vp}")
        
        # Check COSECHA panel
        page.click('[data-tab="qrkg"]')
        page.wait_for_timeout(200)
        cosecha = page.locator("#panel-qrkg")
        if cosecha.is_visible():
            cw = cosecha.evaluate("el => el.scrollWidth")
            vp = page.evaluate("window.innerWidth")
            if cw > page.evaluate("window.innerWidth"):
                print(f"{label}: COSECHA panel overflow {cw} > {vp}")
            
            # Check buttons
            btns = page.locator("#panel-qrkg button.btn")
            for i in range(btns.count()):
                b = btns.nth(i)
                if b.is_visible():
                    bw = b.evaluate("el => el.scrollWidth")
                    if bw > page.evaluate("window.innerWidth"):
                        print(f"{label}: COSECHA btn overflow {bw} > {vp}")
            
            # Check inputs
            inputs = page.locator("#panel-qrkg input.inp")
            for i in range(inputs.count()):
                inp = inputs.nth(i)
                if inp.is_visible():
                    iw = inp.evaluate("el => el.scrollWidth")
                    if iw > page.evaluate("window.innerWidth"):
                        print(f"{label}: COSECHA input overflow {iw}")
        
        # Check RANKING panel
        page.click('[data-tab="ranking"]')
        page.wait_for_timeout(200)
        ranking = page.locator("#panel-ranking")
        if ranking.is_visible():
            rw = ranking.evaluate("el => el.scrollWidth")
            vp = page.evaluate("window.innerWidth")
            if rw > page.evaluate("window.innerWidth"):
                print(f"{label}: RANKING panel overflow {rw} > {vp}")
            
            # Check ranking buttons
            btns = page.locator("#panel-ranking button.btn")
            for i in range(btns.count()):
                b = btns.nth(i)
                if b.is_visible():
                    bw = b.evaluate("el => el.scrollWidth")
                    if bw > page.evaluate("window.innerWidth"):
                        print(f"{label}: RANKING btn overflow {bw}")
        
        # Check FORENSE area
        page.click('[data-area="forense"]')
        page.wait_for_timeout(200)
        
        # Check tabs overflow
        tabs = page.locator(".tabs")
        tabs_w = tabs.evaluate("el => el.scrollWidth")
        if tabs_w > page.evaluate("window.innerWidth"):
            print(f"{label}: TABS overflow {tabs_w}")
        
        # Check statstrip
        stats = page.locator(".statstrip")
        if stats.is_visible():
            sw = stats.evaluate("el => el.scrollWidth")
            if sw > page.evaluate("window.innerWidth"):
                print(f"{label}: STATSTRIP overflow {sw}")
        
        # Check auditbar
        audit = page.locator(".auditbar")
        if audit.is_visible():
            aw = audit.evaluate("el => el.scrollWidth")
            if aw > page.evaluate("window.innerWidth"):
                print(f"{label}: AUDITBAR overflow {aw}")
        
        # Check for any element overflow
        all_overflow = page.evaluate("""
            () => {
                const vp = window.innerWidth;
                const results = [];
                document.querySelectorAll('*').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > window.innerWidth + 1) {
                        results.push({
                            tag: el.tagName,
                            id: el.id,
                            class: el.className.substring(0, 50),
                            right: rect.right,
                            width: rect.width,
                            outerHTML: el.outerHTML.substring(0, 150)
                        });
                    }
                });
                return results;
            }
        """)
        
        for e in all_overflow[:10]:
            print(f"{label}: OVERFLOW {e['tag']}#{e['id']}.{e['class']} right={e['right']:.0f} w={e['width']:.0f}")
            print(f"  {e['outerHTML']}")
        
        page.close()
    browser.close()