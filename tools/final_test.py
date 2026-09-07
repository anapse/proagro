# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

sizes = [
    (320, 568, "iPhone SE"),
    (360, 640, "Android pequeño"),
    (375, 667, "iPhone 6/7/8"),
    (390, 844, "iPhone 12/13"),
    (393, 873, "iPhone 12 Pro"),
    (412, 892, "Pixel 4"),
    (430, 932, "Pixel 5"),
    (480, 800, "Android medio"),
    (768, 1024, "iPad"),
    (1024, 768, "iPad landscape"),
    (1280, 800, "Netbook"),
    (1366, 768, "Laptop pequeño"),
    (1440, 900, "Laptop medio"),
    (1920, 1080, "Full HD"),
    (2560, 1440, "QHD"),
]

print("🧪 TESTING RESPONSIVE DESIGN")
print("=" * 50)

all_good = True

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    
    for width, height, label in sizes:
        page = context.new_page()
        page.set_viewport_size({"width": width, "height": height})
        
        try:
            page.goto("http://localhost:8765/", wait_until="networkidle", timeout=10000)
            page.wait_for_timeout(500)
            
            # Check for horizontal scroll
            has_h_scroll = page.evaluate("""() => {
                return document.documentElement.scrollWidth > window.innerWidth ||
                       document.body.scrollWidth > window.innerWidth;
            }""")
            
            # Check for visible overflow on key elements
            overflow_elements = page.evaluate("""() => {
                const vp = {width: window.innerWidth, height: window.innerHeight};
                const overflowing = [];
                
                const checkEl = (el) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > vp.width + 2 || 
                        rect.left < -2 ||
                        rect.bottom > vp.height + 2 ||
                        rect.top < -2) {
                        overflowing.push({
                            tag: el.tagName,
                            id: el.id || '',
                            class: el.className.slice(0, 50),
                            width: rect.width,
                            height: rect.height
                        });
                    }
                };
                
                document.querySelectorAll('header, main, .panel, .cardbox, .rcard, .tabs, .auditbar, .statstrip, button, input, select').forEach(checkEl);
                return overflowing;
            }""")
            
            # Check font sizes are reasonable
            min_font_size = page.evaluate("""() => {
                const bodyStyle = getComputedStyle(document.body);
                return parseFloat(bodyStyle.fontSize);
            }""")
            
            if has_h_scroll:
                print(f"❌ {label:18s} ({width:4d}x{height:4d}) - HORIZONTAL SCROLL")
                all_good = False
            elif len(overflow_elements) > 0:
                print(f"❌ {label:18s} ({width:4d}x{height:4d}) - OVERFLOW: {len(overflow_elements)} elements")
                # Show first few offenders
                for el in overflow_elements[:3]:
                    print(f"    {el['tag']}#{el['id']}.{el['class']} {el['width']:.0f}x{el['height']:.0f}")
                all_good = False
            elif min_font_size < 10:
                print(f"⚠️  {label:18s} ({width:4d}x{height:4d}) - Small font: {min_font_size}px")
            else:
                print(f"✅ {label:18s} ({width:4d}x{height:4d}) - OK")
                
        except Exception as e:
            print(f"💥 {label:18s} ({width:4d}x{height:4d}) - ERROR: {str(e)[:50]}")
            all_good = False
        
        page.close()
    
    context.close()
    browser.close()

print("=" * 50)
if all_good:
    print("🎉 ALL VIEWPORTS PASSED - NO RESPONSIVE ISSUES DETECTED")
else:
    print("❌ SOME VIEWPORTS FAILED - SEE ABOVE")

# Also check for JS errors in console
print("\n🔍 CHECKING FOR JS ERRORS...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    js_errors = []
    page.on("console", lambda msg: js_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: js_errors.append(str(err)))
    
    page.goto("http://localhost:8765/", wait_until="networkidle")
    page.wait_for_timeout(2000)
    
    # Navigate through panels to trigger JS
    page.click('[data-area="empleados"]')
    page.wait_for_timeout(500)
    page.click('[data-tab="qrkg"]')
    page.wait_for_timeout(500)
    page.click('[data-tab="ranking"]')
    page.wait_for_timeout(500)
    page.click('[data-area="forense"]')
    page.wait_for_timeout(500)
    page.click('[data-area="empleados"]')
    page.wait_for_timeout(500)
    
    browser.close()
    
    if js_errors:
        print("❌ JS ERRORS DETECTED:")
        for err in js_errors[:5]:
            print(f"  {err}")
    else:
        print("✅ NO JS ERRORS DETECTED")

print("\n🏁 TESTING COMPLETE")