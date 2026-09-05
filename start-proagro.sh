#!/usr/bin/env bash
# ============================================================
#  PROAGRO-WEB-FORENSICS — arranque para Linux / VPS
#  Puerto: 3792 (variable PORT)  ·  Bind: 0.0.0.0 (variable HOST)
#  La aplicación es PYTHON (Flask). Crea .venv e instala
#  dependencias la primera vez. No necesita npm.
#  HTTPS desactivado por defecto (HTTPS_PORT=0).
#  Uso:
#     chmod +x start-proagro.sh
#     ./start-proagro.sh
#  Con puerto distinto:  PORT=3795 ./start-proagro.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3792}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
export HTTPS_PORT="${HTTPS_PORT:-0}"
export NO_BROWSER=1

echo "========================================"
echo "  PROAGRO-WEB-FORENSICS"
echo "========================================"
echo "  Puerto : $PORT   (variable PORT; por defecto 3792)"
echo "  Bind   : $HOST"
echo "  Local  : http://127.0.0.1:${PORT}"
echo "  VPS    : http://IP-DEL-VPS:${PORT}"
echo "  AVISO  : esta aplicación escucha en TODAS las interfaces de red."
echo "========================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] No se encontró python3. Instálalo, p. ej. en Ubuntu/Debian:"
  echo "        sudo apt update && sudo apt install -y python3 python3-venv python3-pip"
  exit 1
fi
echo "Python: $(python3 --version)"

PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "Creando entorno Python e instalando dependencias (primera vez)..."
  python3 -m venv .venv
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r requirements.txt || {
    echo "[AVISO] Faltó algún paquete opcional; instalando lo esencial..."
    "$PY" -m pip install flask requests beautifulsoup4
  }
else
  # .venv copiado/roto (apunta a otro Python): se detecta y se recrea
  if ! "$PY" --version >/dev/null 2>&1; then
    echo "[AVISO] .venv roto (copiado de otra máquina) — recreando..."
    rm -rf .venv
    python3 -m venv .venv
    "$PY" -m pip install --upgrade pip
    "$PY" -m pip install -r requirements.txt || \
      "$PY" -m pip install flask requests beautifulsoup4
  fi
fi

# El propio run.py comprueba el puerto y avisa si está ocupado (no cambia solo).
exec "$PY" run.py --no-browser
