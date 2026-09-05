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
| 🌾 COSECHA — datos reales | ❌ | CORS bloquea `ConsultarKgVista` desde el navegador |
| 🏆 RANKING — datos reales | ❌ | CORS bloquea `ObtenerRankingVista` |
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
