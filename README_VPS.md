# PROAGRO-WEB-FORENSICS — despliegue en VPS (guía simple)

Carpeta **autocontenida** (solo rutas relativas): comprímela en ZIP, súbela al VPS,
extráela y ejecuta. La aplicación es **Python 3.11+ / Flask + SQLite** (no es Node.js:
no hay `npm install` ni `node_modules`).

## Puerto y bind (centralizado por entorno)
- Puerto HTTP: **3792** — variable `PORT` (por defecto `3792`)
- Bind: **0.0.0.0** — variable `HOST` (todas las interfaces)
- HTTPS: **desactivado por defecto** (`HTTPS_PORT=0`). Solo si algún día necesitas
  la cámara desde una tablet, actívalo: `HTTPS_PORT=3793` + certificado en `tls/`.
- Config opcional en `.env` (copia de `.env.example`). **Sin secretos en el proyecto.**
- Si el puerto está ocupado la app **no cambia sola**: muestra el error y cómo usar `PORT=...`.

## Linux / Ubuntu-Debian
```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip
unzip PROAGRO-WEB-FORENSICS.zip
cd PROAGRO-WEB-FORENSICS
chmod +x start-proagro.sh
./start-proagro.sh          # crea .venv + dependencias la 1ª vez; puerto 3792
# Abrir:  http://IP-DEL-VPS:3792
```
- En segundo plano: `nohup ./start-proagro.sh > proagro.log 2>&1 &`
- Detener: `pkill -f "run.py --no-browser"`
- Reiniciar: volver a lanzar `./start-proagro.sh` (si está corriendo, detén antes).

## Windows (PC o VPS Windows)
- `INICIAR_PROAGRO_VPS.bat` → prueba en primer plano (auto-crea `.venv`, puerto 3792).
- Para que **no se cierre al desconectarte del RDP**: `INSTALAR_SERVICIO_VPS.bat`
  como administrador (una vez). Queda como tarea del sistema `PROAGRO-Forensics`:
  arranca sola al encender el VPS, corre sin sesión abierta y escribe todo en `proagro.log`.
- Detener: `DETENER_SERVICIO_VPS.bat` · Desinstalar: `schtasks /Delete /TN "PROAGRO-Forensics" /F`

## Firewall del VPS (abre SOLO 3792; no toques 3790)
Ubuntu/Debian con UFW:
```bash
sudo ufw status                          # ¿UFW activo?
sudo ufw allow 3792/tcp                  # http://IP-DEL-VPS:3792
# Solo desde tu trabajo (recomendado):
sudo ufw allow from TU_IP to any port 3792 proto tcp
```
Si el proveedor usa security group / firewall de nube, permite ahí también el TCP 3792.
Verifica: `sudo ufw status | grep 3792`

## ⚠️ Seguridad
- Escucha en `0.0.0.0` y **no pide contraseña**: el panel muestra nombres/kg de
  trabajadores e historial de DNIs. Prefiere `ufw allow from TU_IP …` o túnel SSH
  (`ssh -L 3792:127.0.0.1:3792 usuario@VPS` y abrir `http://127.0.0.1:3792`).
- Solo lectura sobre PROAGRO; sin credenciales; sin funciones de escritura.

## Qué NO subir en el ZIP
- `.venv/` (se recrea) y `__pycache__/`
- `tls/key.pem` (clave privada) si existe
- Opcional: `data/forensics.db` (historial local de DNIs), `snapshots/`, `reports/`, `evidence/`

## Producción
`run.py` usa servidor Werkzeug con threads (suficiente para uso personal/tablets).
Para más carga: `nohup … &` o systemd/nginx delante. No usa nodemon; no hay comando npm
porque no es Node.js.
