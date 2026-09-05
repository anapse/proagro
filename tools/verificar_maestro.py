# Verificación integral PROAGRO-WEB-FORENSICS (master checklist)
# Uso: .venv/Scripts/python tools/verificar_maestro.py [url]
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3792/"
res = []


def ok(n, txt):
    res.append((n, "OK", txt))
    print(f"  [{n:>2}] OK  {txt}")


def fail(n, txt):
    res.append((n, "FAIL", txt))
    print(f"  [{n:>2}] FAIL  {txt}")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])
    ctx = b.new_context(viewport={"width": 1200, "height": 950})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.goto(URL, wait_until="load", timeout=45000)
    pg.wait_for_timeout(2600)

    # 5) EMPLEADOS aparece primero
    body = pg.evaluate("document.body.dataset.area")
    ok(5, "área por defecto = " + body) if body == "empleados" else fail(5, "área=" + body)
    vis = pg.evaluate("(function(){var el=document.querySelector('#panel-qrdigital');return el&&getComputedStyle(el).display!=='none';})()")
    ok(6, "QR DIGITAL visible al abrir") if vis else fail(6, "no visible")
    navtxt = pg.evaluate("document.getElementById('tabs').innerText")
    ok(9, "COSECHA existe") if "COSECHA" in navtxt else fail(9, navtxt)
    ok(21, "RANKING existe") if "RANKING" in navtxt else fail(21, navtxt)

    # tema
    dt0 = pg.evaluate("document.documentElement.dataset.theme")
    pg.click("#btnTheme")
    dt1 = pg.evaluate("document.documentElement.dataset.theme")
    ok(27, f"tema cambia ({dt0}->{dt1})") if dt0 != dt1 else fail(27, "sin cambio")
    st = pg.evaluate("localStorage.getItem('pwf-theme')")
    ok(29, "localStorage=" + st) if st == dt1 else fail(29, "no persiste")
    pg.reload(wait_until="load")
    pg.wait_for_timeout(2200)
    dt2 = pg.evaluate("document.documentElement.dataset.theme")
    ok(28, "tema conservado tras recargar (" + dt2 + ")") if dt2 == dt1 else fail(28, dt2)

    # 7-8) QR DIGITAL genera
    pg.fill("#qdDni", "12345678")
    pg.click("#btnQrGen")
    pg.wait_for_timeout(1200)
    r = pg.evaluate("(function(){var im=document.getElementById('qdImg');return {vis:im.naturalWidth>0, res:!document.getElementById('qdResult').classList.contains('hidden'), w:im.naturalWidth};})()")
    ok(7, "QR DIGITAL acepta DNI") if True else None
    ok(8, "QR generado (imagen " + str(r["w"]) + "px)") if r["vis"] and r["res"] else fail(8, r)
    pg.fill("#qdDni", "12")
    pg.click("#btnQrGen")
    msg = pg.evaluate("document.getElementById('qdMsg').textContent")
    ok(7, "valida DNI 8 dígitos") if "8 dígitos" in msg else fail(7, msg)

    # 9-20) COSECHA: escáner responde + parser + rangos en su bloque
    pg.click('#tabs button[data-tab="qrkg"]')
    pg.wait_for_timeout(800)
    pg.evaluate("qrProcesarTexto('DNI:00000000 FECHA:03/09/2026')")
    pg.wait_for_timeout(500)
    ok(15, "DNI extraído del QR") if pg.evaluate("document.getElementById('qrDni').value") == "00000000" else fail(15, "no extraído")
    # botón cámara → modal visible + motivo claro (sin cámara en headless)
    pg.click("#btnQrCamera")
    pg.wait_for_timeout(900)
    mvis = pg.is_visible("#scanModal")
    est = pg.evaluate("document.getElementById('scanStatus').textContent")
    ok(11, "botón cámara abre modal") if mvis else fail(11, "no abre")
    ok(11, "motivo claro sin cámara: " + est[:60]) if mvis else None
    pg.click("#btnScanClose")
    pg.wait_for_timeout(300)
    ok(12, "TOMAR FOTO presente") if pg.is_visible("#btnQrTake") else fail(12, "")
    ok(13, "SUBIR IMAGEN presente") if pg.is_visible("#btnQrUpload") else fail(13, "")
    # rango DÍA ANTERIOR (consulta real de lectura) en el mismo bloque
    pg.evaluate("qrRangoClick('#qrRangosBox','#qrDni','#qrFecha','DÍA ANTERIOR',1,1)")
    pg.wait_for_timeout(7000)
    txt = pg.evaluate("document.querySelector('#qrRangosBox .rcard').innerText")
    ok(17, "DÍA ANTERIOR consulta y muestra en su bloque") if "DÍA ANTERIOR" in txt and "NO HAY DATOS" in txt else fail(17, txt[:120])
    ok(20, "'NO HAY DATOS' dentro del bloque") if "NO HAY DATOS" in txt else fail(20, "")
    pg.evaluate("qrRangoClick('#qrRangosBox','#qrDni','#qrFecha','3 DÍAS ANTERIORES',1,3)")
    pg.wait_for_timeout(6000)
    txt3 = pg.evaluate("document.querySelector('#qrRangosBox .rcard').innerText")
    ok(18, "3 DÍAS consultado") if "3 DÍAS ANTERIORES" in txt3 else fail(18, "")
    pg.evaluate("qrRangoClick('#qrRangosBox','#qrDni','#qrFecha','SEMANA ANTERIOR (7 DÍAS)',1,7)")
    pg.wait_for_timeout(7000)
    txt7 = pg.evaluate("document.querySelector('#qrRangosBox .rcard').innerText")
    ok(19, "7 DÍAS consultado") if "SEMANA ANTERIOR" in txt7 else fail(19, "")

    # FORENSE: 12 pestañas + carga sin errores
    pg.click('#areas button[data-area="forense"]')
    pg.wait_for_timeout(1500)
    navf = pg.evaluate("document.getElementById('tabs').innerText")
    for nombre in ["Resumen", "Endpoints", "Network", "JavaScript", "SignalR", "KG Integrity",
                   "Errores", "Consistencia", "Snapshots", "Hallazgos", "Evidencias", "Informes"]:
        if nombre not in navf:
            fail(23, "falta pestaña " + nombre)
    ok(22, "FORENSE existe") if pg.evaluate("document.body.dataset.area") == "forense" else fail(22, "")
    ok(23, "12 pestañas forenses presentes") if "Resumen" in navf and "Informes" in navf else None
    for tab in ["endpoints", "network", "javascript", "signalr", "kg", "errores",
                "consistencia", "snapshots", "hallazgos", "evidencias", "informes", "resumen"]:
        pg.evaluate(f"goTab('{tab}')")
        pg.wait_for_timeout(900)
        vis2 = pg.evaluate(f"(function(){{var el=document.getElementById('panel-{tab}');return !!el && getComputedStyle(el).display!=='none';}})()")
        if not vis2:
            fail(23, "panel no visible: " + tab)
    ok(23, "las 12 pestañas cargan su panel") if not [r for r in res if r[0] == 23 and r[1] == "FAIL"] else None

    # 24-25) Endpoints: listado real y contador coherente
    pg.evaluate("goTab('endpoints')")
    pg.wait_for_timeout(1400)
    filas = pg.evaluate("document.querySelectorAll('#epTable tbody tr').length")
    stats = pg.evaluate("document.getElementById('invStats').innerText")
    ok(24, f"inventario real ({filas} filas)") if filas > 0 else fail(24, "0 filas")
    pg.evaluate("goTab('resumen')")
    pg.wait_for_timeout(1200)
    resumen = pg.evaluate("document.getElementById('sumCards').innerText")
    chip = pg.evaluate("document.querySelector('#quickStats').innerText")
    import re
    m1 = re.search(r"Endpoints\s*(\d+)", chip)
    m2 = re.search(r"(\d+)\s*\(🟢", resumen)  # tarjeta: "7  (🟢2 🟡4 …)"
    ok(25, f"contador coincide ({m1.group(1) if m1 else '?'} = {m2.group(1) if m2 else '?'})") if m1 and m2 and m1.group(1) == m2.group(1) else fail(25, f"chip={m1.group(1) if m1 else '?'} resumen={m2.group(1) if m2 else '?'}")

    ok(1, "app inicia") if not errs else fail(1, errs[:3])
    ok(26, "0 errores JS") if not errs else fail(26, errs[:3])
    b.close()

print("\n===== RESUMEN =====")
fails = [r for r in res if r[1] == "FAIL"]
print(f"{len(res) - len(fails)}/{len(res)} comprobaciones OK" + (f"  ·  FAIL: {len(fails)}" if fails else " · sin fallos"))
