# PROAGRO WEB — Empleados y Forense

Herramienta **local (y de VPS)** en **Python/Flask** (no usa Node.js) que combina dos
áreas sobre la misma aplicación:

- **👥 EMPLEADOS** — pantalla amigable para el trabajador (móvil/tablet/PC).
- **🔬 FORENSE** — investigación técnica *read-only* de la web pública
  https://digital.proagro.pe/QrKgAra/QrKgAra (PROAGRO — digitalización de cosecha, ICA).

Todo el proyecto se sirve a sí mismo: la tablet/PC **nunca llama a PROAGRO
directamente**, siempre pasa por esta aplicación (servidor local en `0.0.0.0:3792`).

---

## 👥 EMPLEADOS (parte amigable)

### 📱 QR DIGITAL
Genera un QR con el DNI del trabajador (no es lector): ingresa el DNI → botón
**🔲 QR DIGITAL** → QR grande → **⬇ GUARDAR QR** (PNG). Pantalla centrada y simple.

### 🌾 COSECHA (antes «QR → KG») — «MI COSECHA»
Seguimiento real de la cosecha con **datos del endpoint real** (solo lectura):

1. Elige método (pestañas): **📷 QR** (escanear con cámara, subir imagen) o **👤 DNI**.
   Al detectar/escribir el DNI se muestra **HOY** automáticamente.
2. Períodos: **📅 HOY** y **🌾 ESTA SEMANA** (una línea):
   - **HOY** muestra el último dato disponible: si hoy ya tiene registros los muestra;
     si no, muestra **los de ayer** indicándolo («datos de AYER (dd/mm)»).
   - **ESTA SEMANA** va de **lunes a hoy** (máximo sábado); **el domingo nunca se muestra**.
3. Gráfica de barras grande (un día por barra), con valor KG, día completo
   (Lunes…Sábado), fecha y **carita** 😊😐😞 calculada comparando cada día con el
   anterior de la semana (desde el lunes; nada de "semana anterior").
4. Tarjetas: **🌾 TOTAL** y **📊 PROMEDIO DIARIO** — calculados **solo con los días
   que tienen datos**; un día sin datos muestra **⚠️ NO HAY DATOS** (nunca 0 KG) y no
   entra en el promedio.
5. Mensaje de rendimiento dinámico (😊 ¡Excelente! / 😐 estable / 😞 disminuyó) con
   la variación real (⬆️/⬇️ %).
6. **⚖️ Detalle de pesos — por registro/hora**: aparece abajo siempre (en HOY y en
   ESTA SEMANA), con **botones por cada día** del período (por defecto el último con
   datos). Muestra **un día a la vez**: hora · KG · barra horizontal · ▲/▼ %
   comparado con el registro anterior de ese día · carita grande.

Endpoint real usado (documentado por FORENSE, no inventado):
`POST /QrKgAra/ConsultarKgVista` con `{"dni","fechaIni","fechaFin"}` (formato
`YYYY-MM-DD`); responde `{encontrado, dias[].detalle[]}` con
hora/variedad/kgExportable/kgDescarte. Sonido 🔊 (beep) + voz al detectar QR.

### 🏆 RANKING
Pestaña preparada para su implementación; la referencia técnica ya vive en FORENSE
(`GET /QrKgAra/ObtenerRankingVista`, 🟢 VERIFICADO).

---

## 🔬 FORENSE (parte técnica)

Auditorías automáticas **read-only** de la web pública. Cada hallazgo se clasifica
`HECHO OBSERVADO / INDICIO / HIPÓTESIS / PRUEBA PENDIENTE` (nunca se presenta una
inferencia como un hecho). Pestañas:

- **Resumen** (contadores coherentes con el inventario) · **🔌 Endpoints** ·
  Network · JavaScript/Chunks · SignalR · KG Integrity · Errores · Consistencia ·
  Snapshots · Hallazgos · Evidencias · Informes.
- **🔌 ENDPOINTS ENCONTRADOS**: inventario con estado forense
  🟢 VERIFICADO / 🟡 ENCONTRADO EN CÓDIGO / 🔵 REFERENCIADO / 🔴 ERROR, método,
  función JS que lo usa, parámetros reales del código, archivo/línea, respuesta
  esperada, HTTP y fecha. Incluye: buscador, filtros (GET/POST/estado/QR/KG/DNI/…),
  **📥 exportar JSON/CSV**, secciones 🧩 FUNCIONES→ENDPOINTS, 📄 FORMULARIOS,
  📷 QR (librerías cargadas vs usadas), 📊 CAMPOS detectados, 🗺️ MAPA de la web.
- Historial local de consultas KG y el documento del endpoint viven aquí (no en
  EMPLEADOS).

El análisis descarga HTML + **todos** los JS/bundles públicos (SHA-256), busca
patrones (ajax/fetch/axios/URLs/SignalR/WebSocket), construye el mapa de endpoints
**sin inventar nada**, prueba solo endpoints de lectura (`Obtener/Consultar/Buscar…`)
y genera informe `HTML + JSON + PDF`.

---

## Arquitectura

```
TABLET / PC (navegador)
        │  http://IP-local:3792
        ▼
PROAGRO WEB (Flask, 0.0.0.0:3792)   ← esta aplicación
        │  POST /api/consultar-kg (proxy, solo lectura)
        ▼
digital.proagro.pe  ConsultarKgVista / ObtenerRankingVista
        ▼
JSON real → gráfica/tarjetas/detalle en EMPLEADOS · inventario en FORENSE
```

## Requisitos e instalación
- Python 3.11+ (Windows o Linux), internet para el sitio público.
```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Linux: .venv/bin/python
```
(opcional, solo auditorías con navegador) `.venv/Scripts/python -m playwright install chromium`

## Ejecutar
```bash
.venv/Scripts/python run.py           # HTTP 0.0.0.0:3792
PORT=3800 .venv/Scripts/python run.py # otro puerto (env PORT)
```
- Config centralizada por entorno (`PORT`=3792, `HOST`=0.0.0.0, `HTTPS_PORT`=0).
  Si el puerto está ocupado avisa y no cambia solo.
- La consola detecta la IP LAN y muestra las URLs para la tablet.
- **Firewall (solo red privada):** `ABRIR_PUERTO_3792.bat` como administrador
  (TCP 3792, perfil *privado* únicamente).

### Cámara desde la tablet (HTTPS opcional)
La cámara del navegador exige contexto seguro. Si la necesitas, activa HTTPS:
`HTTPS_PORT=3793 .venv/Scripts/python run.py` (certificado autogenerado en `tls/`;
primera visita: Avanzado → Continuar). Sin HTTPS, COSECHA sigue funcionando con
👤 DNI y 📁 SUBIR IMAGEN.

## VPS / producción
- Windows: `INICIAR_PROAGRO_VPS.bat` (primer plano) o `INSTALAR_SERVICIO_VPS.bat`
  (tarea del sistema, arranca sola, log persistente `proagro.log`).
- Linux: `chmod +x start-proagro.sh && ./start-proagro.sh`.
- Guía completa: `README_VPS.md`.

## Pruebas
```bash
.venv/Scripts/python -m unittest discover -s tests          # 17 tests offline
.venv/Scripts/python tools/verificar_maestro.py http://127.0.0.1:3792/   # checklist 26 pts
```

## Seguridad y alcance
- **Solo lectura**: nunca POST/PUT/PATCH/DELETE contra PROAGRO; sin credenciales.
- Sin secretos en el repo (`.gitignore` excluye `data/`, `snapshots/`, `reports/`,
  `evidence/`, `tls/`, `.env`, logs — contienen datos personales/clave privada).
- Sin acceso al servidor/BD de PROAGRO: solo lo observable por HTTP público.
