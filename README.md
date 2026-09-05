# PROAGRO-WEB-FORENSICS

Herramienta **read-only** de análisis técnico/forense de la aplicación pública
**https://digital.proagro.pe/QrKgAra/QrKgAra** (PROAGRO — digitalización de cosecha, ICA).
Investiga indicios sobre el recorrido del dato **Kg / peso / cosecha** desde el
navegador hasta las consultas públicas, **sin afirmar pérdida de datos sin evidencia**.

Cada hallazgo se clasifica como `HECHO OBSERVADO`, `INDICIO`, `HIPÓTESIS` o
`PRUEBA PENDIENTE`. Todo el análisis inicial es **GET / solo lectura**:
no se envían formularios ni se modifican datos.

## Requisitos
- Windows 10/11, Python 3.10+ (el proyecto trae su propio `.venv`).
- Internet (el sitio es público).

## Instalación (una sola vez)
```bat
cd %USERPROFILE%\Desktop\PROAGRO-WEB-FORENSICS
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m playwright install chromium
```

## Ejecutar
```bat
.venv\Scripts\python run.py            :: abre http://127.0.0.1:3792
.venv\Scripts\python run.py --port 3800
```
El servidor escucha en **0.0.0.0**, de modo que la MISMA aplicación se abre desde
otros dispositivos de la red local:

```
PC:     http://127.0.0.1:3792/
TABLET: http://192.168.1.4:3792/      <- IP real de esta PC (misma Wi-Fi)
```

Al iniciar, la consola detecta automáticamente las IP IPv4 de la PC y muestra las
URLs para la tablet. Para que la tablet pueda entrar:

1. **Firewall (solo red privada):** ejecuta como administrador
   `ABRIR_PUERTO_3792.bat` (crea las reglas TCP 3792/3792 → perfil *privado* únicamente).
   Alternativa manual: Panel → Firewall → Configuración avanzada → Reglas de
   entrada → Nueva regla → Puerto → TCP 3792/3792 → Permitir → marcar SOLO Privada.
2. La tablet debe estar en la **misma Wi-Fi** y abrir `http://IP-DE-LA-PC:3792`.
3. Si no carga: desactiva el *aislamiento AP/cliente* en el router Wi-Fi.

El dashboard incluye la pestaña **📷 QR → KG** (lector QR con cámara/foto +
consulta real a PROAGRO); para la cámara desde la tablet se necesita el
**HTTPS local** de abajo.

### HTTPS local (cámara desde la tablet)
El servidor arranca en **HTTP :PORT** (env `PORT`, por defecto **3792**) y **HTTPS :PORT+1** (env `HTTPS_PORT`, por defecto **3792**):
- PC: `http://127.0.0.1:3792` (HTTPS solo si `HTTPS_PORT` se activa)
- Tablet: `http://IP-PC:3792` (sin cámara); con `HTTPS_PORT=3793` activo, `https://IP-PC:3793` (cámara ✅)
- Certificado autogenerado en `tls/cert.pem` + `tls/key.pem` (clave privada LOCAL;
  no compartir). Regenerar si cambia la IP: `.venv\Scripts\python tools\crear_certificado_https.py`
- En la tablet, la 1ª vez: Chrome → "Avanzado" → "Continuar a IP-PC (no seguro)".
- Firewall: `ABRIR_PUERTO_3792.bat` como administrador (puertos 3792 y 3792,
  solo perfil privado). La red Wi-Fi debe estar como "Privada".
Pasos recomendados en el dashboard:
1. **[＋ NUEVA AUDITORÍA]** — crea el proyecto `PROAGRO` con la URL (o edítala).
2. **[▶ ANALIZAR]** — opciones: captura con Chromium, rango de fechas, nº de
   consultas de consistencia. El análisis tarda ~1 min y es read-only.
3. Revisa las pestañas (Network, Endpoints, JavaScript, SignalR, KG Integrity,
   Errores, Consistencia, Snapshots, Hallazgos, Evidencias, Informes).
4. **[⬇ INFORME]** — genera `HTML + JSON + PDF` (PDF vía Chromium headless).

### Pestaña 📷 QR → KG (desde la PC o la tablet)
1. **[📷 ESCANEAR QR]** abre la cámara (usa la trasera en tablet) y detecta el QR
   automáticamente con jsQR (servido local). Alternativas: **[📸 Tomar foto]** o
   **[📁 Subir imagen]** (funcionan aunque el navegador bloquee la cámara por HTTP).
2. El parser flexible extrae DNI/fecha/lote/variedad/cuadrilla/grupo… del contenido
   (texto plano o JSON) y deja confirmar DNI y fecha.
3. **[🔎 BUSCAR KG]** llama al servidor local, que consulta el endpoint REAL
   documentado `POST /QrKgAra/ConsultarKgVista` con
   `{"dni","fechaIni","fechaFin"}` (solo lectura; la tablet nunca llama a PROAGRO).
4. Muestra nombre, kgExportable/kgDescarte/kgTotal, detalle por día, y
   **[🔬 VER RESPUESTA DEL ENDPOINT]** con la respuesta cruda guardada en
   `data/kg_queries/` (SHA-256). Historial local en SQLite (`kg_queries`).

Botones de consulta rápida (dentro de QR → KG, base = fecha seleccionada):
**📅 DÍA ANTERIOR**, **📅 3 DÍAS ANTERIORES**, **📅 SEMANA ANTERIOR (7 DÍAS)**:
cada uno hace UNA consulta de rango real (`fechaIni`/`fechaFin`) y dibuja una
tarjeta **por día** bajo su botón (✅ con KG / ⚠️ NO HAY DATOS / ❌ error HTTP /
🌐 error de conexión, diferenciados; los días sin datos no se ocultan) más el
TOTAL DEL PERÍODO sumando solo los KG devueltos. Sonido de confirmación al
escanear el QR (🔊 beep + voz "QR detectado" si el navegador la permite) y tonos
distintos al obtener datos / sin datos / error — nunca repetidos en bucle.

También por línea de comandos (sin servidor):
```bat
.venv\Scripts\python tools\run_audit_cli.py --browser
.venv\Scripts\python tools\cleanup_audit.py <audit_id>
.venv\Scripts\python -m unittest discover -s tests        :: tests offline
```

## Qué hace cada auditoría
1. Descarga el HTML principal (headers + SHA-256) y analiza recursos/formularios.
2. Descarga **todos** los JS públicos (a `snapshots/<ts>/javascript/` y
   `evidence/javascript/` con SHA-256).
3. Escanea bundles: llamadas AJAX/fetch/axios, URLs, keywords KG
   (kg, peso, cosecha, trabajador, DNI, lote, variedad, ranking…), SignalR/WebSocket.
4. Construye el **mapa de endpoints** clasificados
   `OBSERVADO / REFERENCIADO / POSIBLE` (nunca inventa endpoints).
5. Sonda **solo endpoints de lectura** (`Obtener/Consultar/Buscar/Listar/Ver…`)
   con GET normales; **nunca** toca acciones de escritura.
6. Consulta pública `ObtenerRankingVista` (top, fechaIni, fechaFin, lotes, variedades).
7. Ventanas de fechas + **consistencia** (N consultas idénticas → compara SHA-256,
   nº de registros y sumas de kg).
8. Errores HTTP, HTTP-200-con-error-JSON y errores JS de consola (modo navegador).
9. Patrones de **posible fallo silencioso** (POSSIBLE_SILENT_FAILURE): catch vacío,
   fetch sin `response.ok`, $.ajax sin handler error, etc.
10. **KG-INTEGRITY**: mapa Pantalla → función → request → endpoint → respuesta.
11. Snapshot completo con manifiesto SHA-256 + comparación con la auditoría anterior.
12. Informe `PROAGRO_WEB_FORENSICS_<fecha>.html|json|pdf`.

## Estructura
```
PROAGRO-WEB-FORENSICS/
├── run.py                     # dashboard (Flask) en http://0.0.0.0:PORT (3792)
├── forensics/                 # paquete: db (SQLite), audit (orquestador),
│   ├── engine/                #   http, html_analyzer, js_scanner, endpoints,
│   │                          #   network_probe, silent, signalr, kg, browser
│   ├── report.py              # informes HTML/JSON/PDF
│   └── app.py                 # API JSON del dashboard
├── web/                       # frontend (pestañas)
├── tools/                     # run_audit_cli.py, cleanup_audit.py
├── tests/                     # unittest (offline)
├── data/forensics.db          # SQLite
├── evidence/javascript/       # copia persistente de los JS
├── snapshots/<YYYY-MM-DD_HH-MM-SS>/   # html/ javascript/ responses/ headers/
│                                     # network/ logs/ analysis/ + manifest.json
└── reports/PROAGRO_WEB_FORENSICS_*.{html,json,pdf}
```

## Alcance y limitaciones (importante)
- Sin acceso al servidor/BD/credenciales: solo lo observable por HTTP público.
- No se ejecutan POST/PUT/PATCH/DELETE; no se registra, modifica ni borra nada.
- La prueba de **concurrencia** es opcional (1–20 GET) y solo con clic explícito.
- «Consultar mi Kg» usa POST JSON con DNI: requiere autorización; el análisis
  documenta el flujo pero **no lo ejecuta**.
- Los cambios entre consultas pueden deberse a actividad legítima en curso.
