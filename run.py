# PROAGRO-WEB-FORENSICS — punto de entrada del dashboard (local + VPS).
#
# Configuración centralizada por VARIABLES DE ENTORNO (archivo .env opcional):
#   PORT        puerto HTTP principal    (por defecto: 3792)
#   HTTPS_PORT  puerto HTTPS local       (por defecto: 0 = DESACTIVADO; actívalo
#               solo si necesitas la cámara: HTTPS_PORT=3793 y certificado en tls/)
#   HOST        interfaz de escucha      (por defecto: 0.0.0.0 = todas)
#   NO_BROWSER  1 = no abrir navegador
#
# El servidor SIEMPRE escucha en 0.0.0.0 (configurable con HOST).
# Si el puerto indicado está ocupado, la aplicación NO cambia de puerto sola:
# muestra el error y cómo resolverlo (PORT=...).
import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from forensics import db, SNAPSHOT_DIR
from forensics.app import make_app

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 3792
DEFAULT_HOST = "0.0.0.0"


def load_dotenv(root=ROOT):
    """Carga .env del proyecto si existe (sin dependencias externas)."""
    p = root / ".env"
    if not p.exists():
        return
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)
    except Exception:
        pass


def env_int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except Exception:
        return default


def check_port_free(port, host):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def sweep_stale_audits():
    """Al arrancar: marca como interrumpidas las auditorías 'running' huérfanas
    (p. ej. por un reinicio del servidor) y limpia snapshots incompletos."""
    db.q("UPDATE audits SET status='error', error='interrumpida por reinicio del servidor', "
         "finished_at=datetime('now','localtime') WHERE status='running'")
    for d in SNAPSHOT_DIR.iterdir():
        if d.is_dir() and not (d / "manifest.json").exists():
            shutil.rmtree(d, ignore_errors=True)


def detect_lan_ips():
    """Devuelve (ips:list, labels:dict ip->adaptador, primary:str|None)."""
    ips = {}
    primary = None
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                ips.setdefault(ip, "Red")
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary = s.getsockname()[0]
        ips.setdefault(primary, "Red principal")
        s.close()
    except Exception:
        pass
    try:
        out = subprocess.run(["ipconfig"], capture_output=True, text=True,
                             timeout=20, errors="replace").stdout or ""
        adapter = None
        for line in out.splitlines():
            mh = re.match(r"^([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 \-]{2,70}?)\s*:\s*$", line)
            if mh and not re.search(r"túnel|tunnel|Loopback|isatap|Teredo", line, re.I):
                raw = mh.group(1).strip()
                if "vEthernet" in raw or "WSL" in raw or "Hyper-V" in raw:
                    adapter = "Virtual (WSL/Hyper-V)"
                elif "Inalámbrica" in raw or "Wi-Fi" in raw or "Wireless" in raw or "WLAN" in raw:
                    adapter = "Wi-Fi"
                elif "Ethernet" in raw:
                    adapter = "Ethernet"
                else:
                    adapter = raw.replace("Adaptador de", "").strip()[:30]
                continue
            m = re.search(r"(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})", line)
            if m and adapter:
                ip = m.group(0)
                if not ip.startswith(("127.", "169.254.")) and all(
                        0 <= int(x) <= 255 for x in ip.split(".")):
                    ips[ip] = adapter
                adapter = None
    except Exception:
        pass
    ordered = [primary] + [ip for ip in ips if ip != primary] if primary else list(ips)
    return ordered, ips, primary


def banner(host, port_http, port_https, ips, labels=None, primary=None, https_ok=True):
    labels = labels or {}
    line = "=" * 62
    print(line)
    print("   PROAGRO-WEB-FORENSICS")
    print(line)
    print(f"   Puerto : {port_http}   (variable de entorno PORT; por defecto 3791)")
    print(f"   Bind   : {host}")
    print()
    print("   Acceso local:")
    print(f"      http://127.0.0.1:{port_http}/")
    if https_ok:
        print(f"      https://127.0.0.1:{port_https}/   (HTTPS local, cámara)")
    if ips:
        print()
        print("   Misma red Wi-Fi / LAN (tablet):")
        for ip in ips:
            label = labels.get(ip, "Red")
            arrow = "   ← IP principal" if ip == primary and len(ips) > 1 else ""
            print(f"      http://{ip}:{port_http}/     [HTTP {label}]{arrow}")
            if https_ok:
                print(f"      https://{ip}:{port_https}/   [HTTPS {label}] ← cámara")
    print()
    print("   Si esto corre en un VPS:")
    print(f"      http://IP-DEL-VPS:{port_http}/")
    print()
    print("   AVISO: esta aplicación está escuchando en TODAS las interfaces de red.")
    print("   El panel contiene nombres y kg de trabajadores: en un VPS/Internet")
    print("   permite en el firewall SOLO el/los puerto(s) necesarios y, si puedes,")
    print("   restringe el acceso a tu IP (ver README_VPS.md).")
    if not https_ok:
        print("   HTTPS NO está activado (por defecto). Si necesitas la cámara en una")
        print("   tablet, actívalo:  HTTPS_PORT=%d  (y genera el certificado en tls/)" % (port_http + 1))
    print(line)
    print(f"   BD:    {db.DB_PATH}")
    print("   READ-ONLY · sin credenciales · análisis de la web pública")
    print(line)


def ensure_https_cert(ips):
    """Devuelve (cert, key) generando el certificado si no existe."""
    tls_dir = ROOT / "tls"
    cert = tls_dir / "cert.pem"
    key = tls_dir / "key.pem"
    if cert.exists() and key.exists():
        return cert, key
    print("No hay certificado HTTPS — generándolo ahora (openssl)…")
    ips_args = [ip for ip in ips if not ip.startswith("127.")] or ["127.0.0.1"]
    try:
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "crear_certificado_https.py"),
                            *ips_args], capture_output=True, text=True, timeout=180)
        print(r.stdout[-700:] if r.returncode == 0 else r.stderr[-700:])
    except Exception as e:
        print("No se pudo generar el certificado automáticamente:", e)
        print("Ejecuta a mano: .venv\\Scripts\\python tools\\crear_certificado_https.py")
    return (cert if cert.exists() else None, key if key.exists() else None)


def main():
    load_dotenv()
    ap = argparse.ArgumentParser(description="PROAGRO-WEB-FORENSICS (local + VPS)")
    ap.add_argument("--port", type=int, default=None,
                    help=f"puerto HTTP (env PORT, por defecto {DEFAULT_PORT})")
    ap.add_argument("--https-port", type=int, default=None,
                    help="puerto HTTPS (env HTTPS_PORT; 0/omitido = desactivado)")
    ap.add_argument("--no-https", action="store_true", help="no levantar HTTPS (por defecto)")
    ap.add_argument("--host", default=None, help=f"interfaz (env HOST, por defecto {DEFAULT_HOST})")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    host = args.host or os.environ.get("HOST", "").strip() or DEFAULT_HOST
    port = args.port or env_int("PORT", DEFAULT_PORT)
    https_port = 0 if args.no_https else (args.https_port if args.https_port is not None
                                          else env_int("HTTPS_PORT", 0))

    db.init_db()
    sweep_stale_audits()
    db.project_default()

    # ---- comprobación estricta del puerto (sin cambio automático) ----
    if not check_port_free(port, host):
        print("=" * 62)
        print("   ERROR: el puerto %d ya está en uso." % port)
        print("=" * 62)
        print("   Posibles causas:")
        print("     · Ya hay otra instancia de PROAGRO-WEB-FORENSICS corriendo.")
        print("     · Otra aplicación usa el puerto (p. ej. en un VPS).")
        print()
        print("   Qué hacer:")
        print("     · Elegir otro puerto y volver a iniciar, por ejemplo:")
        print("         PORT=3795  .venv\\Scripts\\python run.py      (Windows)")
        print("         PORT=3795  .venv/bin/python run.py          (Linux)")
        print("     · O detener la otra aplicación si ya no la necesitas.")
        print("   NO se cambió de puerto automáticamente.")
        sys.exit(2)

    ips_ordered, labels, primary = detect_lan_ips()
    app = make_app()

    cert = key = None
    https_ok = https_port > 0 and https_port != port
    if https_ok:
        if not check_port_free(https_port, host):
            print(f"AVISO: el puerto HTTPS {https_port} está ocupado — HTTPS no se levantará.")
            https_ok = False
        else:
            cert, key = ensure_https_cert(ips_ordered)
            if not (cert and key):
                print("AVISO: sin certificado — HTTPS no se levantará (usa la URL HTTP).")
                https_ok = False

    from forensics import app as appmod
    appmod.set_server_cfg(port=port, https_port=https_port if https_ok else 0,
                          https_on=https_ok, host=host)

    banner(host, port, https_port if https_ok else 0, ips_ordered, labels, primary, https_ok)
    sys.stdout.flush()

    if not args.no_browser and os.environ.get("NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()

    from werkzeug.serving import make_server
    http_srv = make_server(host, port, app, threaded=True)
    if https_ok:
        def serve_https():
            try:
                ssl_srv = make_server(host, https_port, app, threaded=True,
                                      ssl_context=(str(cert), str(key)))
                print(f" * HTTPS en https://{host}:{https_port} (certificado local)")
                ssl_srv.serve_forever()
            except Exception as e:
                print("ERROR HTTPS:", e)
        threading.Thread(target=serve_https, daemon=True).start()
    print(f" * HTTP en http://{host}:{port}")
    http_srv.serve_forever()


if __name__ == "__main__":
    main()
