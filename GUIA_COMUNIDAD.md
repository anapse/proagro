# 💬 COMUNIDAD — Guía de despliegue (Cloudflare)

La sección **COMUNIDAD** (📰 Noticias · 📊 Encuestas · 🏆 Supervisores) ya está
implementada en `web/` (frontend) y en `cloudflare/worker.js` (API). El
frontend se publica igual que siempre (GitHub Pages). Lo que falta es **una
sola vez** conectar el Worker a Cloudflare D1 para que la Comunidad pueda
guardar datos. Son 5 pasos, todos desde la carpeta `cloudflare/`.

> Nota: la API de Comunidad responde con un aviso claro ("D1 no configurado")
> si el Worker se despliega sin D1 — nada se rompe, solo avisa.

---

## Paso 0 — Requisitos

- Tener Node.js (ya está instalado en el PC).
- Estar logueado en Cloudflare desde el navegador
  (cuenta `elherreroanapse@gmail.com`, la misma del Worker actual).
- La primera vez, el login de wrangler pedirá abrir una página de Cloudflare
  y dar clic en *Allow* (solo la primera vez).

Abre una terminal en la carpeta del proyecto y entra a la carpeta del worker:

```bash
cd "C:\Users\Osiris\Desktop\PROAGRO-WEB-FORENSICS\cloudflare"
```

---

## Paso 1 — Crear la base de datos D1 (solo la primera vez)

Si **ya existe** una base llamada `proagro-comunidad` en el dashboard de
Cloudflare, sáltate este paso (no crees otra).

```bash
npx wrangler d1 create proagro-comunidad
```

Te devolverá una línea como:

```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

## Paso 2 — Poner el database_id en wrangler.toml

Ejecuta para ver el id de la base (aunque la hayas creado antes):

```bash
npx wrangler d1 list
```

Copia el `database_id` de `proagro-comunidad`, abre `cloudflare/wrangler.toml`
con el Bloc de notas y **descomenta** el bloque `[d1_databases]`
(quita los `#` del inicio) dejándolo así:

```toml
[[d1_databases]]
binding = "DB"                 # env.DB (NO cambiar el nombre)
database_name = "proagro-comunidad"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← el id real
```

Guarda el archivo.

---

## Paso 3 — Crear las tablas (aplicar migraciones)

Desde la misma carpeta `cloudflare/`:

```bash
npx wrangler d1 migrations apply proagro-comunidad --remote
```

Debe mostrar que aplicó `0001_community.sql` y `0002_seed_supervisores.sql`.
Esto crea las tablas y agrega los 3 supervisores iniciales
(Brigitte, Rosaura y César). Si algún día lo ejecutas dos veces, no duplica
nada (las migraciones son seguras).

> 💡 Para probar antes en local (sin tocar la nube) se puede usar
> `--local`, pero para la app real siempre `--remote`.

---

## Paso 4 — Poner el token de administración (secreto)

Elige una contraseña larga (solo tú la usarás para entrar a
**🔐 Administración** dentro de la Comunidad). Ejecuta:

```bash
npx wrangler secret put COMMUNITY_ADMIN_TOKEN
```

Te pedirá escribir el valor: pega tu contraseña y presiona Enter
(no se ve mientras escribes, es normal). No la compartas con nadie.

---

## Paso 5 — Publicar el Worker

```bash
npx wrangler deploy
```

Debe decir `Uploaded proagro-api` y `Deployed ... workers.dev`.

---

## Comprobar que quedó bien

Abre en el navegador:

```
https://proagro-api.elherreroanapse.workers.dev/api/community/supervisors
```

Debe responder algo como:

```json
{"ok":true,"supervisores":[{"nombre":"Brigitte",...},{"nombre":"Rosaura",...},{"nombre":"César",...}]}
```

Si responde eso, ¡la Comunidad ya guarda datos! Entra a la app
(GitHub Pages), abre **💬 COMUNIDAD → 🏆 SUPERVISORES** y prueba dar un 👍.
Para publicar avisos/encuestas: **🔐 Administración** + el token del Paso 4.

---

## [Opcional] Imágenes en noticias/avisos (R2)

Si quieres poder adjuntar una imagen a una noticia:

1. Crea el bucket en el dashboard de Cloudflare → **R2**: `proagro-media`.
2. En `wrangler.toml` descomenta el bloque `[r2_buckets]` (binding `MEDIA`,
   bucket `proagro-media`).
3. (Opcional) Para que las imágenes se vean con URL pública activa en R2 la
   opción *Public access* del bucket y copia la URL `pub-...r2.dev` en la
   variable `MEDIA_PUBLIC_URL`.
4. Vuelve a ejecutar `npx wrangler deploy`.

Sin R2, el resto de la Comunidad funciona igual (solo no se pueden subir
imágenes y el formulario lo avisa).

---

## Notas

- **No crear una segunda base**: usa siempre `proagro-comunidad` y el binding
  `env.DB` (el código espera ese nombre exacto).
- El voto por persona es único (por identificador anónimo del dispositivo):
  si alguien da 👍 y luego 👎, se cambia; si repite el mismo, se quita.
- Los comentarios se guardan sin HTML (se limpia solo) y con máximo 500
  caracteres. Los votos tienen un límite por minuto para evitar abuso.
- Todo el código de la Comunidad está en:
  `web/comunidad.js` · `web/index.html` · `web/styles.css` ·
  `cloudflare/worker.js` · `cloudflare/migrations/`.
