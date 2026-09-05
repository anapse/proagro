# Genera el certificado HTTPS local autofirmado para PROAGRO-WEB-FORENSICS
# (IP LAN de esta PC + localhost). Uso:
#   .venv/Scripts/python tools/crear_certificado_https.py [IP1 IP2 ...]
# Salida: tls/cert.pem (certificado) y tls/key.pem (clave privada).
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TLS = ROOT / "tls"
TLS.mkdir(parents=True, exist_ok=True)


def detect_ips():
    import socket
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return ips


def main():
    ips = [a for a in sys.argv[1:]] or detect_ips()
    sans = ["IP:127.0.0.1", "DNS:localhost"]
    for ip in ips:
        if ip and not ip.startswith("127."):
            sans.append(f"IP:{ip}")
    cnf = TLS / "openssl.cnf"
    cnf.write_text(
        "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n"
        "[dn]\nCN=PROAGRO-WEB-FORENSICS-LOCAL\n"
        "[v3]\nsubjectAltName=" + ",".join(sans) +
        "\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n",
        encoding="utf-8",
    )
    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", str(TLS / "key.pem"), "-out", str(TLS / "cert.pem"),
        "-days", "825", "-config", str(cnf),
    ]
    print("Generando certificado con SAN:", sans)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print("ERROR:", r.stderr[-1500:])
        sys.exit(1)
    print("OK:")
    print("  certificado:", TLS / "cert.pem")
    print("  clave privada:", TLS / "key.pem")
    print()
    print("La clave privada es LOCAL de esta PC: no la compartas ni la subas.")
    print("En la tablet, la PRIMERA vez, acepta el aviso del certificado")
    print("(Chrome: 'Avanzado' -> 'Continuar a 192.168.1.x').")


if __name__ == "__main__":
    main()
