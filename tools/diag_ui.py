# Diagnóstico UI con Chromium real: consola, botones y flujo QR->KG.
# Uso: .venv/Scripts/python tools/diag_ui.py [url] [secure:1]
#   secure=1  -> prueba HTTPS con contexto seguro y cámara simulada (fake device)
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3790/"
SECURE = len(sys.argv) > 2 and sys.argv[2] == "1"


def main():
    with sync_playwright() as p:
        launch = {}
        if SECURE:
            launch = {"args": ["--use-fake-ui-for-media-stream",
                               "--use-fake-device-for-media-stream",
                               "--ignore-certificate-errors"]}
        b = p.chromium.launch(headless=True, **launch)
        ctx = b.new_context(viewport={"width": 1000, "height": 850},
                            permissions=["camera"] if SECURE else None)
        pg = ctx.new_page()
        console = []
        pgerr = []
        failed = []
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text[:300]}"))
        pg.on("pageerror", lambda e: pgerr.append(str(e)[:400]))
        pg.on("requestfailed", lambda r: failed.append(f"{r.url[:150]} -> {r.failure}"))
        pg.goto(URL, wait_until="load", timeout=45000)
        pg.wait_for_timeout(1500)
        print("== URL:", URL)
        print("== título:", pg.title())
        print("== secureContext:", pg.evaluate("window.isSecureContext"))
        print("== mediaDevices/getUserMedia:", pg.evaluate("!!navigator.mediaDevices + '/' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)"))
        print("== errores página:", pgerr or "ninguno")
        print("== requests fallidos:", failed or "ninguno")

        pg.click('button[data-tab="qrkg"]')
        pg.wait_for_timeout(600)
        print("== panel QR visible:", pg.is_visible("#panel-qrkg"))
        print("== parser/jsQR:", pg.evaluate("typeof window.parseQrContent + '/' + typeof window.jsQR"))

        # A) botón ESCANEAR QR -> modal + cámara
        pg.click("#btnQrCamera")
        pg.wait_for_timeout(2500)
        print("== scanModal visible:", pg.is_visible("#scanModal"))
        print("== estado escáner:", pg.evaluate("document.getElementById('scanStatus').textContent"))
        if SECURE:
            v = pg.evaluate("(function(){var v=document.getElementById('qrVideo');return {ready:v.readyState, playing:!v.paused, w:v.videoWidth, h:v.videoHeight};})()")
            print("== video cámara:", v)
        pg.click("#btnScanClose")
        pg.wait_for_timeout(300)
        print("== scanModal cerrado:", not pg.is_visible("#scanModal"))

        # B) parser en la página
        r = pg.evaluate("parseQrContent('DNI:12345678 FECHA:03/09/2026 LOTE:206 VARIEDAD:MAGICA')")
        print("== parser:", r["dni"], r["fechaIso"], [c["clave"] for c in r["campos"]])

        # C) consulta manual (DNI 00000000 -> SIN_DATOS esperado) y render de resultado
        pg.fill("#qrDniMan", "00000000")
        pg.fill("#qrFechaMan", "2026-09-03")
        pg.click("#btnBuscarMan")
        pg.wait_for_timeout(7000)
        res = pg.evaluate("window._qrUltimaRespuesta ? {estado: window._qrUltimaRespuesta.estado, http: window._qrUltimaRespuesta.meta.http_status, ms: window._qrUltimaRespuesta.meta.elapsed_ms} : null")
        print("== consulta:", res)
        vis = pg.evaluate("(document.getElementById('qrResultBox').innerText || '').slice(0, 260).replace(/\\n/g, ' | ')")
        print("== resultado box:", vis)
        # D) ver respuesta original en modal
        pg.evaluate("qrVerRespuesta()")
        pg.wait_for_timeout(400)
        print("== modal respuesta visible:", pg.is_visible("#modal"))
        print("== modal contiene endpoint:", pg.evaluate("document.getElementById('modalBox').innerText.includes('ConsultarKgVista')"))
        pg.click(".modal .actions button")
        # E) historial actualizado
        pg.wait_for_timeout(400)
        his = pg.evaluate("document.getElementById('hisTable').innerText.slice(0, 200).replace(/\\n/g, ' | ')")
        print("== historial:", his)
        # F) debug modal
        pg.click("#btnQrDebug")
        pg.wait_for_timeout(600)
        print("== debug modal:", pg.evaluate("document.getElementById('modalBox').innerText.slice(0, 220).replace(/\\n/g, ' | ')"))
        pg.keyboard.press("Escape")
        print("== consola (últimas 10):")
        for c in console[-10:]:
            print("   ", c)
        b.close()


if __name__ == "__main__":
    main()
