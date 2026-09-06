# 🔐 PROAGRO ADMIN — Dashboard privado de administración (PLAN)

> **Estado: PLAN — NO implementado todavía.**
> Motivo: la Comunidad/D1 actual aún no está estable en producción
> (el bloque `[d1_databases]` de `cloudflare/wrangler.toml` está comentado,
> sin `database_id` real). Primero hay que conectar D1 siguiendo
> `GUIA_COMUNIDAD.md` y verificar que la Comunidad guarda datos.
> Este documento es la especificación completa para implementar después.

---

## 1. Situación actual (revisada en disco, 2026-09-06)

### Comunidad (ya implementada y publicada)
- Frontend público: `web/` → GitHub Pages `https://anapse.github.io/proagro/`
  (copia en `docs/` sincronizada por commit+push).
- Worker: `cloudflare/worker.js` (957 líneas) — conserva
  `GET /health`, `GET /api/ranking`, `POST /api/cosecha`.
- API Comunidad pública: `/api/community/posts`, `/surveys`, `/supervisors`,
  votos y comentarios (públicos) + `/api/community/admin/*` con un **token
  único compartido** (`COMMUNITY_ADMIN_TOKEN`, header `Authorization: Bearer`).
- Migraciones D1 existentes:
  - `0001_community.sql` — supervisores, supervisor_votes, comments, posts,
    surveys, survey_options, survey_votes (+ índices).
  - `0002_seed_supervisores.sql` — Brigitte, Rosaura, César (idempotente).
- **Pendiente en Cloudflare (manual):** crear D1 `proagro-comunidad`, poner el
  `database_id` en `wrangler.toml`, aplicar migraciones (`--remote`), fijar
  `COMMUNITY_ADMIN_TOKEN` y desplegar el worker. **Hasta que eso ocurra, la
  Comunidad pública muestra "D1 no configurado".**

### Lo que el dashboard nuevo reemplaza
- El botón **🔐 Administración** hoy visible para todos en la Comunidad
  pública (`web/comunidad.js` línea ~196, modal con token).
- La admin por **token compartido** (`COMMUNITY_ADMIN_TOKEN`).
  → Se sustituye por **usuarios con contraseña y roles** en `/admin`.

---

## 2. Objetivo

Dos partes separadas:

| Parte | URL | Acceso |
|---|---|---|
| Pública (trabajadores) | `https://anapse.github.io/proagro/` | libre: consultar, votar, comentar, encuestas |
| Privada (administración) | `https://anapse.github.io/proagro/admin` | solo usuarios admin autenticados |

Conocer la URL `/admin` **no** da acceso: siempre pide ID + contraseña,
validadas por el Worker contra D1 (la base es la fuente de verdad).

---

## 3. Arquitectura

- **Frontend separado** (no toca la app pública salvo quitar el botón admin):
  - `web/admin/index.html` — página `/admin` (login + panel).
  - `web/admin/app.js` — lógica del dashboard (usa los helpers de
    `web/app.js` que ya existen: `esc`, `toastShow`, tema, estilos).
  - `web/admin/styles.css` o reutilizar `web/styles.css` (mismo diseño:
    fondo oscuro, verde PROAGRO, tarjetas redondeadas, responsive).
  - GitHub Pages sirve `web/admin/` como `/admin` automáticamente.
- **Worker**: se **añade** un bloque `/api/admin/*` sin tocar `/api/ranking`,
  `/api/cosecha` ni `/api/community/*` existentes (salvo retirar el modal-token
  de la página pública en `comunidad.js`).
- **D1**: misma base `proagro-comunidad`, binding `DB` (NO crear otra).

---

## 4. Migración nueva: `cloudflare/migrations/0003_admin.sql`

**No borra ni altera las tablas de Comunidad.** Añade:

```sql
-- Usuarios administrativos
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- hash PBKDF2, NUNCA texto plano
  display_name  TEXT NOT NULL DEFAULT '',
  role_level    INTEGER NOT NULL DEFAULT 4,   -- 1..4 (ver Roles)
  active        INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1, -- 1 = pedir cambio en 1er ingreso
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- Sesiones emitidas por el Worker (validadas en cada petición)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT NOT NULL,             -- hash del token de sesión
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user  ON admin_sessions(user_id);

-- Conteo diario de visitas (para estadísticas reales, no inventadas)
CREATE TABLE IF NOT EXISTS visit_stats (
  day TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
);
```

**Seed inicial (migración `0004_seed_admin.sql`):** el único usuario de
arranque, creado desde D1 (no desde el frontend):

| username | display_name | role_level | active | must_change_password |
|---|---|---|---|---|
| anapse | Administrador | 1 (ADMIN) | 1 | 1 |

La contraseña inicial **nunca** viaja en el código: en el plan de ejecución se
genera el hash PBKDF2 de la contraseña inicial acordada y se inserta ese hash
en el seed. El worker descarta cualquier INSERT en texto plano.

---

## 5. Roles y permisos (niveles numéricos, extensibles)

| Nivel | Rol | Icono |
|---|---|---|
| 1 | ADMIN | 👑 |
| 2 | MODERADOR | 🛡️ |
| 3 | EDITOR | ✏️ |
| 4 | CONSULTA | 👁️ |

**Matriz de permisos (se aplica en el WORKER, no solo ocultando botones):**

| Acción | N1 Admin | N2 Moderador | N3 Editor | N4 Consulta |
|---|:--:|:--:|:--:|:--:|
| Ver panel / estadísticas | ✅ | ✅ | ✅ (básico) | ✅ (solo ver) |
| Supervisores: ver | ✅ | ✅ | ❌ | ✅ |
| Supervisores: agregar/editar/activar | ✅ | ❌ | ❌ | ❌ |
| Publicaciones: crear/editar | ✅ | ✅ | ✅ (propias/permitidas) | ❌ |
| Publicaciones: ocultar/eliminar | ✅ | ✅ | ❌ | ❌ |
| Encuestas: crear/editar/cerrar | ✅ | ✅ | ❌ | ❌ |
| Encuestas: ver resultados | ✅ | ✅ | ❌ | ✅ |
| Comentarios: moderar (ocultar/restaurar) | ✅ | ✅ | ❌ | ❌ |
| Usuarios admin: crear/editar/roles/activar | ✅ | ❌ | ❌ | ❌ |
| Cambiar contraseña de otro usuario | ✅ | ❌ | ❌ | ❌ |
| Cambiar su propia contraseña | ✅ | ✅ | ✅ | ✅ |
| Configuración | ✅ | ❌ | ❌ | ❌ |

Regla: el Worker responde **403** si `role_level` del usuario autenticado no
alcanza el nivel mínimo del endpoint (un moderador no puede llamar a mano un
endpoint de ADMIN).

---

## 6. Autenticación (segura, app estática + Worker)

1. `POST /api/admin/login` con `{username, password}`.
2. Worker busca `admin_users` por username (D1). Si no existe o `active=0` →
   error genérico (no revelar si el usuario existe).
3. Verifica `password_hash` con **PBKDF2-SHA256** (WebCrypto del Worker,
   salt aleatorio por usuario, miles de iteraciones) — comparación en
   tiempo constante.
4. **Rate limit de login** (en memoria del Worker): máx. 5 intentos fallidos
   por usuario+IP en 15 min → 429 con espera. Evita fuerza bruta.
5. Si `must_change_password=1` → la API responde
   `{must_change_password: true}` y el panel obliga a cambiarla antes de
   seguir (endpoint `PUT /api/admin/me/password`).
6. Sesión: se crea un **token de sesión aleatorio** guardado en
   `admin_sessions` (hash del token en D1 + expiración 8 h). El Worker valida
   **cada** petición admin con ese token (header `Authorization: Bearer`).
   - El frontend lo guarda en memoria; opcionalmente `sessionStorage`
     (se borra al cerrar la pestaña). **Nunca** en `localStorage`.
   - Las cookies HttpOnly no aplican aquí (el frontend vive en GitHub Pages y
     el Worker en otro dominio), por eso se usa token validado por el Worker.
7. `POST /api/admin/logout` → borra la sesión en D1.
8. `GET /api/admin/me` → usuario, nombre, rol, `must_change_password`.
9. Nunca se devuelve `password_hash` en ninguna respuesta. No se imprime nada
   sensible en consola ni logs.

---

## 7. Endpoints `/api/admin/*` (añadidos al Worker)

Autenticación + rol en todos (salvo login):

```
POST   /api/admin/login              → {token, user} | {must_change_password}
POST   /api/admin/logout             (rol ≥1)
GET    /api/admin/me                 (rol ≥1)
PUT    /api/admin/me/password        (rol ≥1; cambia su propia contraseña)

GET    /api/admin/users              (rol 1)
POST   /api/admin/users              (rol 1)  {username,password,display_name,role_level,active}
PUT    /api/admin/users/:id          (rol 1)  editar rol/estado/nombre
DELETE /api/admin/users/:id          (rol 1)  desactivar (borrado lógico)
POST   /api/admin/users/:id/reset-password (rol 1)

GET    /api/admin/supervisors        (rol ≤2 o 4)
POST   /api/admin/supervisors        (rol 1)
PUT    /api/admin/supervisors/:id    (rol 1)
DELETE /api/admin/supervisors/:id    (rol 1)  borrado lógico activo=0

GET    /api/admin/posts              (rol ≤3)
POST   /api/admin/posts              (rol ≤2; N3 solo type permitido)
PUT    /api/admin/posts/:id          (rol ≤2; N3 solo las suyas)
DELETE /api/admin/posts/:id          (rol ≤2)  estado inactivo

GET    /api/admin/surveys            (rol ≤2 o 4)
POST   /api/admin/surveys            (rol ≤2)
PUT    /api/admin/surveys/:id        (rol ≤2)  editar, abrir/cerrar
DELETE /api/admin/surveys/:id        (rol ≤2)

GET    /api/admin/comments           (rol ≤2)
PUT    /api/admin/comments/:id       (rol ≤2)  {status: hidden|visible|deleted}
DELETE /api/admin/comments/:id       (rol ≤2)  borrado lógico

GET    /api/admin/stats              (rol ≤4)  conteos reales (0 si no hay datos)
```

Los endpoints existentes `/api/community/admin/*` (token compartido) se
retiran de la página pública al implementar el dashboard (y dejan de usarse
en el frontend); `/api/ranking` y `/api/cosecha` quedan intactos.

**Estadísticas reales** (nada inventado): totales y activos por tabla
(supervisores, posts por tipo, encuestas+ votos, comentarios por estado,
usuarios por rol) + `visit_stats` alimentada con un ping anónimo del frontend
público al worker (`POST /api/community/ping`) para "visitas hoy/semana/mes".

---

## 8. Pantallas del dashboard (`web/admin/`)

### Login (`/admin`)
Caja centrada estilo PROAGRO: 🔐 PROAGRO ADMIN · "Panel de Comunidad" ·
campos **ID** y **CONTRASEÑA** + botón **INGRESAR**. Errores genéricos
("ID o contraseña incorrectos"). Si `must_change_password=1`: pantalla
obligatoria de **cambiar contraseña** antes de entrar.

### Panel principal
Cabecera: "⚙️ PANEL DE ADMINISTRACIÓN · PROAGRO COMUNIDAD",
usuario conectado (`anapse`), rol (`👑 ADMIN — Nivel 1`), botón
**[ CERRAR SESIÓN ]**. Menú lateral (íconos):
📊 Dashboard · 👷 Supervisores · 📰 Publicaciones · 📊 Encuestas ·
💬 Comentarios · 👥 Usuarios · 📈 Estadísticas · ⚙️ Configuración.

- **Dashboard:** tarjetas resumen (supervisores activos, publicaciones,
  encuestas, comentarios pendientes) + últimos registros.
- **👷 Supervisores:** tabla SUPERVISOR | CARGO | ESTADO | LIKES | DISLIKES |
  COMENTARIOS | ACCIONES, con **[ + AGREGAR SUPERVISOR ]** (formulario
  Nombre/Cargo/Estado → D1). Lo agregado **aparece solo en la Comunidad
  pública** (sin tocar código cuando lleguen Juan/María/Carlos).
- **📰 Publicaciones:** crear Noticia/Aviso/Comunicado/Cambio de horario
  (tipo, categoría, título, contenido, imagen opcional si R2 está;
  si no hay R2 el dashboard funciona igual y avisa).
- **📊 Encuestas:** crear con pregunta, opciones, fechas y estado; ver
  resultados con barras.
- **💬 Comentarios:** moderación con estados `visible / hidden / deleted`
  (sin borrado físico innecesario).
- **👥 Usuarios:** tabla ID | NOMBRE | NIVEL | ESTADO | ACCIONES y
  **[ + AGREGAR USUARIO ]** (nombre, ID, contraseña, nivel, activo).
  Solo ADMIN ve y usa esta sección.
- **📈 Estadísticas:** números reales + gráficos responsive (barras
  construidas con el mismo CSS/SVG del proyecto — sin librerías externas).
- **⚙️ Configuración:** solo ADMIN (datos del sitio, umbrales).

---

## 9. Archivos del plan de ejecución

**Crear:**
- `cloudflare/migrations/0003_admin.sql` (tablas admin_users, admin_sessions, visit_stats)
- `cloudflare/migrations/0004_seed_admin.sql` (usuario anapse con hash)
- `web/admin/index.html` · `web/admin/app.js` (dashboard completo)
- `test_admin.mjs` (arnés de pruebas con D1 simulado)

**Modificar (mínimo imprescindible):**
- `cloudflare/worker.js` — añadir bloque `/api/admin/*` + helpers de hash PBKDF2
  y sesiones (NO toca ranking/cosecha ni la API pública de comunidad).
- `web/comunidad.js` — **quitar el botón 🔐 Administración público** y el modal
  con token (el acceso pasa a `/admin`).
- `docs/` — sincronizar tras cada cambio + commit + push (regla del proyecto).
- `GUIA_ADMIN.md` — pasos de despliegue (aplicar migraciones 0003/0004,
  cambiar contraseña inicial, crear moderadores).

**No se modifica:** QR DIGITAL, COSECHA, RANKING, FORENSE, ni la lógica
pública de votos/comentarios/encuestas.

---

## 10. Pruebas obligatorias (checklist de aceptación)

1. `/admin` muestra login (y no da acceso sin autenticar). ✅ objetivo
2. ID incorrecto → error. · 3. contraseña incorrecta → error.
4. anapse (ADMIN) entra con la contraseña inicial.
5. ADMIN cierra sesión. · 6. ADMIN agrega supervisor.
7. Supervisor aparece en D1. · 8. Supervisor aparece en la Comunidad pública.
9. ADMIN edita supervisor. · 10. ADMIN lo desactiva.
11. ADMIN crea usuario MODERADOR. · 12. MODERADOR inicia sesión.
13. MODERADOR no puede ejecutar acciones exclusivas de ADMIN (403).
14. ADMIN cambia roles. · 15. EDITOR con permisos limitados.
16. CONSULTA solo consulta (403 al intentar escribir).
17. Las contraseñas nunca aparecen en respuestas de API.
18. No hay credenciales hardcodeadas en el frontend (solo hash en seed D1).
19-22. QR DIGITAL, COSECHA, RANKING y FORENSE siguen funcionando.

Verificación con el mismo método de esta sesión: arnés Node con D1 simulado
(SQLite) ejecutando las migraciones reales + navegador contra worker local.

---

## 11. Configuración manual pendiente en Cloudflare (al implementar)

1. Aplicar `npx wrangler d1 migrations apply proagro-comunidad --remote`
   (aplica 0001→0004; las 0001/0002 ya se aplicaron antes).
2. Cambiar la contraseña inicial en el primer ingreso (obligatorio por
   `must_change_password`).
3. `npx wrangler deploy` para publicar los endpoints `/api/admin/*`.
4. (Opcional, solo cuando haya imágenes) crear bucket R2 y descomentar el
   bloque `[r2_buckets]` de `wrangler.toml`.

---

## 12. Cómo se usará (guía rápida para el propietario)

- **Entrar:** navegador → `https://anapse.github.io/proagro/admin` → ID
  `anapse` + contraseña inicial (te la doy en el momento de implementar, para
  generar su hash) → el sistema **obliga a cambiarla** en el primer ingreso.
- **Agregar supervisor:** 👷 Supervisores → [+ AGREGAR SUPERVISOR] → aparece
  solo en Comunidad. Sin tocar código.
- **Agregar moderador:** 👥 Usuarios → [+ AGREGAR USUARIO] → nivel
  2-MODERADOR (solo visible para ADMIN).
- **Cambiar contraseña:** ⚙️ o menú del usuario → Cambiar contraseña
  (el ADMIN además puede resetear la de otros desde 👥 Usuarios).
- **Publicar aviso:** 📰 Publicaciones → tipo Aviso → PUBLICAR.
