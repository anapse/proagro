# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_viewport_size({"width": 320, "height": 568})
    page.goto("http://localhost:8765/", wait_until="networkidle")
    page.wait_for_timeout(500)
    
    page.click('[data-tab="qrkg"]')
    page.wait_for_timeout(200)
    
    # Find what's causing overflow in cosecha panel
    elements = page.evaluate("""
        () => {
            const results = [];
            const panel = document.getElementById('panel-qrkg');
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
                        outerHTML: el.outerHTML.substring(0, 200)
                    });
                }
            });
            return results;
        }
    """)
    
    for e in elements[:20]:
        print(f"OVERFLOW: {e['tag']}#{e['id']}.{e['class'][:60]} right={e['right']:.0f} w={e['width']:.0f}")
        print(f"  HTML: {e['outerHTML']}")
        print()
    
    browser.close()