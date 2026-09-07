# -*- coding: utf-8 -*-
from playwright.sync.api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_viewport_size({"width": 320, "height": 568})
    page.goto("http://localhost:8765/", wait_until="networkidle")
    page.wait_for_timeout(500)
    
    # Check what's causing overflow in QR panel
    elements = page.evaluate("""
        () => {
            const results = [];
            const panel = document.getElementById('panel-qrdigital');
            if (!panel) return [];
            panel.querySelectorAll('*').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.right > window.innerWidth + 1) {
                    results.push({
                        tag: el.tagName,
                        id: el.id,
                        class: el.className.substring(0, 80),
                        right: rect.right,
                        width: rect.width,
                        left: rect.left,
                        style: el.getAttribute('style') || '',
                        outerHTML: el.outerHTML.substring(0, 200)
                    });
                }
            });
            return results;
        }
    """)
    
    print("=== QR PANEL OVERFLOW ANALYSIS (320px) ===")
    for e in elements:
        print(f"OVERFLOW: {e['tag']}#{e['id']}.{e['class'][:60]}")
        print(f"  Position: left={e['left']:.0f}, width={e['width']:.0f}, right={e['right']:.0f}")
        print(f"  Viewport width: {page.evaluate('window.innerWidth')}")
        print(f"  HTML: {e['outerHTML'][:150]}")
        print()
    
    browser.close()