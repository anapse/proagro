# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto("http://localhost:8765/", wait_until="networkidle")
    page.wait_for_timeout(1000)
    
    print("=== TESTING USER FLOWS ===")
    
    # Test 1: QR DIGITAL panel
    print("\n1. Testing QR DIGITAL panel...")
    page.click('#panel-qrdigital')
    page.wait_for_timeout(500)
    
    # Input DNI
    page.fill('#qdDni', '12345678')
    page.click('#btnQrGen')
    page.wait_for_timeout(1000)
    
    # Check if QR generated
    qr_img = page.locator('#qdImg')
    if qr_img.count() > 0:
        print("✓ QR generated successfully")
    else:
        print("✗ QR not generated")
    
    # Check download button
    download_btn = page.locator('#qdDownload')
    if download_btn.is_visible():
        print("✓ Download button visible")
        btn_w = download_btn.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if btn_w <= vp_w:
            print("✓ Download button fits in viewport")
        else:
            print(f"✗ Download button overflow: {btn_w} > {vp_w}")
    
    # Test 2: COSECHA panel
    print("\n2. Testing COSECHA panel...")
    page.click('[data-tab="qrkg"]')
    page.wait_for_timeout(500)
    
    # Test HOY button
    hoy_btn = page.locator('#btnDashHoy')
    if hoy_btn.is_visible():
        print("✓ HOY button visible")
        hoy_w = hoy_btn.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if hoy_w <= vp_w:
            print("✓ HOY button fits in viewport")
        else:
            print(f"✗ HOY button overflow: {hoy_w} > {vp_w}")
    
    # Test ESTA SEMANA button
    semana_btn = page.locator('#btnDashSemana')
    if semana_btn.is_visible():
        print("✓ ESTA SEMANA button visible")
        sem_w = semana_btn.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if sem_w <= vp_w:
            print("✓ ESTA SEMANA button fits in viewport")
        else:
            print(f"✗ ESTA SEMANA button overflow: {sem_w} > {vp_w}")
    
    # Test FECHA input
    fecha_inp = page.locator('#dashFecha')
    if fecha_inp.is_visible():
        print("✓ FECHA input visible")
        f_w = fecha_inp.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if f_w <= vp_w:
            print("✓ FECHA input fits in viewport")
        else:
            print(f"✗ FECHA input overflow: {f_w} > {vp_w}")
    
    # Test 3: RANKING panel
    print("\n3. Testing RANKING panel...")
    page.click('[data-tab="ranking"]')
    page.wait_for_timeout(500)
    
    # Test period buttons
    hoy_rank = page.locator('#rankBtnHoy')
    sem_rank = page.locator('#rankBtnSemana')
    
    if hoy_rank.is_visible():
        print("✓ Ranking HOY button visible")
        h_w = hoy_rank.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if h_w <= vp_w:
            print("✓ Ranking HOY button fits")
        else:
            print(f"✗ Ranking HOY button overflow: {h_w} > {vp_w}")
    
    if sem_rank.is_visible():
        print("✓ Ranking SEMANA button visible")
        s_w = sem_rank.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if s_w <= vp_w:
            print("✓ Ranking SEMANA button fits")
        else:
            print(f"✗ Ranking SEMANA button overflow: {s_w} > {vp_w}")
    
    # Test search input
    search_inp = page.locator('#rkBuscarInp')
    if search_inp.is_visible():
        print("✓ Ranking search input visible")
        s_w = search_inp.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if s_w <= vp_w:
            print("✓ Ranking search input fits")
        else:
            print(f"✗ Ranking search input overflow: {s_w} > {vp_w}")
    
    # Test 4: FORENSE area
    print("\n4. Testing FORENSE area...")
    page.click('[data-area="forense"]')
    page.wait_for_timeout(500)
    
    # Test tabs
    tabs = page.locator('.tabs button')
    tab_issues = 0
    for i in range(tabs.count()):
        tab = tabs.nth(i)
        if tab.is_visible():
            t_w = tab.evaluate("el => el.scrollWidth")
            vp_w = page.evaluate("window.innerWidth")
            if t_w > vp_w:
                tab_issues += 1
                print(f"✗ Tab {i} overflow: {t_w} > {vp_w}")
    
    if tab_issues == 0:
        print("✓ All tabs fit in viewport")
    
    # Test auditbar
    audit = page.locator('.auditbar')
    if audit.is_visible():
        a_w = audit.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if a_w <= vp_w:
            print("✓ Auditbar fits in viewport")
        else:
            print(f"✗ Auditbar overflow: {a_w} > {vp_w}")
    
    # Test statstrip
    stats = page.locator('.statstrip')
    if stats.is_visible():
        s_w = stats.evaluate("el => el.scrollWidth")
        vp_w = page.evaluate("window.innerWidth")
        if s_w <= vp_w:
            print("✓ Statstrip fits in viewport")
        else:
            print(f"✗ Statstrip overflow: {s_w} > {vp_w}")
    
    # Test 5: Check for any text overflow in buttons
    print("\n5. Checking button text overflow...")
    all_buttons = page.locator('button.btn')
    btn_text_issues = 0
    for i in range(all_buttons.count()):
        btn = all_buttons.nth(i)
        if btn.is_visible():
            # Check if text content overflows
            btn_html = btn.evaluate("el => el.innerHTML")
            # Simple check: if button has text and is not just an icon
            if len(btn_html.strip()) > 2 and not btn_html.strip().startswith('<'):
                btn_w = btn.evaluate("el => el.scrollWidth")
                vp_w = page.evaluate("window.innerWidth")
                if btn_w > vp_w:
                    btn_text_issues += 1
                    print(f"✗ Button text overflow: '{btn_html[:20]}...' width={btn_w} > {vp_w}")
    
    if btn_text_issues == 0:
        print("✓ No button text overflow detected")
    
    # Test 6: Check input fields
    print("\n6. Checking input fields...")
    all_inputs = page.locator('input.inp, input[type=date], input[inputmode=numeric]')
    input_issues = 0
    for i in range(all_inputs.count()):
        inp = all_inputs.nth(i)
        if inp.is_visible():
            iw = inp.evaluate("el => el.scrollWidth")
            vp_w = page.evaluate("window.innerWidth")
            if iw > vp_w:
                input_issues += 1
                print(f"✗ Input overflow: width={iw} > {vp_w}")
    
    if input_issues == 0:
        print("✓ No input overflow detected")
    
    browser.close()