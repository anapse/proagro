# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

# Test viewport sizes
sizes = [
    (320, 568, "320px"),
    (360, 800, "360px"),
    (375, 812, "375px"),
    (390, 844, "390px"),
    (393, 873, "393px"),
    (412, 915, "412px"),
    (430, 932, "430px"),
    (480, 800, "480px"),
    (768, 1024, "768px-tablet"),
    (1024, 768, "1024px"),
    (1366, 768, "1366px"),
    (1920, 1080, "1920px"),
]

issues = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for w, h, label in sizes:
        page = browser.new_page()
        page.set_viewport_size({"width": w, "height": h})
        page.goto("http://localhost:8765/", wait_until="networkidle")
        page.wait_for_timeout(1000)
        
        # Check horizontal scroll
        body_width = page.evaluate("document.body.scrollWidth")
        viewport_width = page.evaluate("window.innerWidth")
        has_h_scroll = body_width > viewport_width
        
        # Check header overflow
        header = page.locator("header.top")
        header_width = header.evaluate("el => el.scrollWidth") if header.count() > 0 else 0
        header_over = header_width > viewport_width
        
        # Check main content
        main = page.locator("main")
        main_width = main.evaluate("el => el.scrollWidth") if main.count() > 0 else 0
        main_over = main_width > viewport_width
        
        # Check buttons text overflow
        btns = page.locator("button.btn")
        btn_count = btns.count()
        btn_issues = 0
        for i in range(btn_count):
            btn = btns.nth(i)
            if btn.is_visible():
                bw = btn.evaluate("el => el.scrollWidth")
                bw_parent = btn.evaluate("el => el.parentElement ? el.parentElement.clientWidth : 0")
                if bw > viewport_width or bw > bw_parent:
                    btn_issues += 1
        
        # Check inputs
        inputs = page.locator("input.inp, input[type=date]")
        input_issues = 0
        for i in range(inputs.count()):
            inp = inputs.nth(i)
            if inp.is_visible():
                iw = inp.evaluate("el => el.scrollWidth")
                if iw > viewport_width:
                    input_issues += 1
        
        # Check cards overflow
        cards = page.locator(".cardbox, .rcard, .cm-card, .det-card, .qr-sec")
        card_issues = 0
        for i in range(cards.count()):
            c = cards.nth(i)
            if c.is_visible():
                cw = c.evaluate("el => el.scrollWidth")
                if cw > viewport_width:
                    card_issues += 1
        
        # Font size check on body
        fs = page.evaluate("getComputedStyle(document.body).fontSize")
        
        issues.append({
            "label": label,
            "size": f"{w}x{h}",
            "h_scroll": has_h_scroll,
            "header_over": header_over,
            "main_over": main_over,
            "btn_issues": btn_issues,
            "input_issues": input_issues,
            "card_issues": card_issues,
            "font_size": fs
        })
        
        print(f"{label:20s} | H-scroll: {str(has_h_scroll):5s} | Header: {str(header_over):5s} | Main: {str(main_over):5s} | Btns: {btn_issues} | Inputs: {input_issues} | Cards: {card_issues} | FS: {fs}")
        page.close()
    browser.close()

print("\n=== SUMMARY ===")
for i in issues:
    if i["h_scroll"] or i["header_over"] or i["main_over"] or i["btn_issues"] or i["input_issues"] or i["card_issues"]:
        print(f"ISSUES in {i['label']}: H={i['h_scroll']} Hdr={i['header_over']} Main={i['main_over']} Btns={i['btn_issues']} Inp={i['input_issues']} Cards={i['card_issues']}")