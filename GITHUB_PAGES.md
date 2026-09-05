# GitHub Pages — PROAGRO WEB (modo 100 % estático)

URL: `https://anapse.github.io/proagro/` — se actualiza sola con cada `git push`
(workflow `.github/workflows/deploy.yml`). Sin VPS, sin backend: es la carpeta `web/`
servida tal cual (rutas relativas, HTTPS incluido).

## Qué funciona 100 % en el navegador
| Función | Cómo |
|---|---|
| 📱 QR DIGITAL | Generador QR local (`vendor/qrcode.min.js`, sin servidor) + ⬇ descarga PNG |
| 📷 Escáner QR / 📸 foto / 📁 subir | `getUserMedia` (GitHub Pages es HTTPS) + jsQR local |
| 👤 DNI · 📅 HOY · 🌾 ESTA SEMANA | Cálculos de fechas/fechas/detalle por día, caritas, total y promedio en el navegador |
| 🔍 Historial/preferencias | `localStorage` (último DNI, tema claro/oscuro, consultas recientes) |
| 🌙/☀️ tema | `localStorage`, sin servidor |
| 🏆 RANKING | Intenta consultar PROAGRO directamente |

## Limitaciones reales (probadas, no supuestas)
Se probó con peticiones HTTP reales (OPTIONS y POST con el origen
`https://anapse.github.io`): **PROAGRO responde 200 pero sin cabeceras CORS
(`Access-Control-Allow-Origin`)**. Consecuencia técnica (política del navegador,
no se puede ni se debe saltar):

| Función | Desde GitHub Pages | Por qué |
|---|---|---|
| 🌾 COSECHA — datos reales | ✅ con Worker · ❌ directo | `POST ConsultarKgVista` vía Cloudflare Worker (gratis) |
| 🏆 RANKING — datos reales | ✅ con Worker · ❌ directo | `GET ObtenerRankingVista` vía Cloudflare Worker (gratis) |
| 🔬 FORENSE (auditorías/endpoints/network/historial) | ❌ | Requiere la API local (SQLite + análisis) y CORS |
| Todo lo demás (QR DIGITAL, escáner, tema, UI) | ✅ | No requiere red a PROAGRO |

La app **lo muestra con claridad**: al consultar HOY/ESTA SEMANA/RANKING desde
GitHub Pages verás el aviso exacto de CORS (no datos falsos ni silencio).

## Para COSECHA/RANKING/FORENSE con datos reales
Corre la misma aplicación en tu PC o VPS (Python/Flask):
`http://IP:3792` (ver `README.md` / `README_VPS.md`). El código es **el mismo**:
al detectar backend (`/api/health`) la app usa la API local y el proxy real a
PROAGRO; sin backend, entra en modo estático automáticamente.

## Sin secretos
GitHub Pages es público: en `web/` solo hay código y assets (logo, fondo, jsQR,
qrcode). Nada de claves, credenciales ni datos de trabajadores (ver `.gitignore`).

## Mecanismo actual (en producción)
Publicado desde la **rama `main`, carpeta `docs/`** (copia del frontend `web/`),
porque la cuenta GitHub tiene **Actions bloqueado por facturación**
(«account is locked due to a billing issue»). Para actualizar la web publicada:
```bash
rm -rf docs && mkdir docs && cp -R web/. docs/
git add -A && git commit -m "docs: sync web" && git push
```
Cuando la facturación se resuelva, el workflow `.github/workflows/deploy.yml`
publicará automáticamente `web/` en cada push (sin `docs/`).


## 🌩️ Worker serverless (Cloudflare) — COSECHA y RANKING con datos reales
GitHub Pages no puede llamar a PROAGRO por CORS, pero un **Worker de Cloudflare
(plan gratuito, ~100.000 peticiones/día, sin tarjeta)** sí: corre en el servidor
de Cloudflare y reenvía SOLO las dos consultas de lectura necesarias.

Código ya incluido: `cloudflare/worker.js` (+ `wrangler.toml`). Solo expone:
- `POST /api/cosecha` → `POST digital.proagro.pe/QrKgAra/ConsultarKgVista` (valida dni 8 dígitos y rango YYYY-MM-DD ≤ 31 días)
- `GET  /api/ranking` → `GET  digital.proagro.pe/QrKgAra/ObtenerRankingVista` (valida top 1..5000 y fechas)
- Todo lo demás: 404/405/400. **Sin proxy abierto, sin URLs arbitrarias, sin escritura.**
  Verificado contra PROAGRO real: cosecha 200 `{encontrado:false}`, ranking 200 con datos; CORS solo para `anapse.github.io` (y localhost de pruebas).

### Desplegarlo (gratis, ~3 minutos, una sola vez)
1. Crea cuenta gratis en https://dash.cloudflare.com → **Workers & Pages** → **Create Worker**.
2. Borra el código de ejemplo y pega el contenido de `cloudflare/worker.js` → **Deploy**.
3. Copia la URL `https://TU-NOMBRE.TU-SUBDOMINIO.workers.dev`.
4. Abre https://anapse.github.io/proagro/ → 🌾 COSECHA → en la caja **🌩️ Worker serverless** pega la URL → **💾 Guardar** (se guarda en ese dispositivo). Pulsa 📅 HOY o 🌾 ESTA SEMANA: ya verás datos reales.
   (Alternativa CLI: `npm i -g wrangler && wrangler login && wrangler deploy cloudflare/worker.js --name proagro-web-api`.)

Con el Worker configurado puedes **apagar la PC**: QR DIGITAL, escáner, COSECHA y
RANKING funcionan desde el teléfono/tablet contra GitHub Pages + Worker.
🔬 FORENSE (auditorías con base local SQLite) sigue requiriendo la versión local/VPS.
