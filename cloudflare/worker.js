// ============================================================
// PROAGRO WEB — Worker (Cloudflare Workers)
// Rutas conservadas (NO modificar): GET / · GET /health ·
//   GET /api/ranking · POST /api/cosecha · OPTIONS
// Añadidas (COMUNIDAD, D1 env.DB → proagro-comunidad):
//   GET  /api/community/supervisors
//   GET  /api/community/supervisors/ranking
//   POST /api/community/supervisors/:id/vote
//   GET  /api/community/supervisors/:id/comments
//   POST /api/community/supervisors/:id/comments
//   GET  /api/community/posts · GET /api/community/posts/:id
//   POST /api/community/posts/:id/comments
//   GET  /api/community/surveys
//   POST /api/community/surveys/:id/vote
//   POST /api/community/media               (R2, opcional)
//   .../admin/...                          (protegidas por token)
// ============================================================

const PROAGRO_ORIGIN = "https://digital.proagro.pe";
const ALLOWED_ORIGIN = "https://anapse.github.io";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin":
      origin === ALLOWED_ORIGIN ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        ? origin
        : "null",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonRes(obj, status, origin, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function validaFecha(x) {
  if (typeof x !== "string" || !RE_ISO.test(x)) return false;
  const d = new Date(x + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/* ============================================================
 *  COMUNIDAD — helpers
 * ============================================================ */

// id anónimo/estable del votante generado por el navegador
const RE_VOTER = /^[A-Za-z0-9._-]{8,80}$/;

// Limpia texto libre: quita etiquetas HTML/JS y recorta longitud.
function limpiarTexto(x, max) {
  if (typeof x !== "string") return "";
  return x
    .replace(/<[^>]*>/g, " ")   // nada de HTML
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 500);
}

// Igual que limpiarTexto pero CONSERVA saltos de línea (para párrafos).
function limpiarParrafo(x, max) {
  if (typeof x !== "string") return "";
  return x
    .replace(/<[^>]*>/g, " ")              // nada de HTML
    .replace(/\r\n?/g, "\n")               // normaliza saltos
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\n{3,}/g, "\n\n")            // colapsa 3+ saltos
    .trim()
    .slice(0, max || 2000);
}

// Sanitiza identificadores simples (sin espacios ni símbolos raros)
function limpioSimple(x, max) {
  if (typeof x !== "string") return "";
  return x.replace(/[^\w áéíóúÁÉÍÓÚñÑüÜ'.,()-]/g, "").trim().slice(0, max || 120);
}

function okVoterId(v) {
  return typeof v === "string" && RE_VOTER.test(v.trim());
}

// rate limit básico por voter (votos y comentarios): N escrituras / minuto
const RATE = new Map(); // voter -> {ts, n}
function rateLimit(voterId, maxPerMin = 12) {
  const now = Date.now();
  // limpieza periódica de entradas viejas (evita crecimiento sin fin)
  if (RATE.size > 5000) {
    for (const [k, v] of RATE) if (now - v.ts > 120000) RATE.delete(k);
  }
  const e = RATE.get(voterId);
  if (!e || now - e.ts > 60000) { RATE.set(voterId, { ts: now, n: 1 }); return true; }
  if (e.n >= maxPerMin) return false;
  e.n += 1;
  return true;
}

// ---- Admin: token (secreto de Cloudflare) ----
function esAdmin(env, request) {
  const tok = env && env.COMMUNITY_ADMIN_TOKEN;
  if (!tok) return false;
  const h = request.headers.get("Authorization") || "";
  return h === "Bearer " + tok;
}

// ---- D1 ----
function necesitaDb(env) {
  return !!(env && env.DB);
}

/* ============================================================
 *  ADMIN (panel privado /api/admin/*) — helpers
 *  Autenticación por usuario+contraseña contra D1 (admin_users),
 *  sesiones con token aleatorio (hash en D1), roles por nivel.
 *  El token ADMIN anterior (COMMUNITY_ADMIN_TOKEN) queda solo
 *  para compatibilidad de /api/community/admin/* y se eliminará
 *  al migrar la página pública por completo.
 * ============================================================ */

// --- PBKDF2 (WebCrypto, compatible con el hash del seed) ---
async function hashPassword(pw, saltB64, iter, hashB64) {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]
    );
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
      keyMaterial, 256
    );
    const want = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
    const got = new Uint8Array(bits);
    if (got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
    return diff === 0;
  } catch (e) { return false; }
}

async function verificarPassword(pw, storedHash) {
  if (typeof pw !== "string" || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iter = Number(parts[2]);
  if (!Number.isInteger(iter) || iter < 1000 || iter > 10000000) return false;
  return hashPassword(pw, parts[3], iter, parts[4]);
}

// Genera un hash nuevo (para crear usuarios / cambiar contraseña)
async function generarHash(pw) {
  const iter = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    keyMaterial, 256
  );
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return "pbkdf2$sha256$" + iter + "$" + b64(salt) + "$" + b64(new Uint8Array(bits));
}

// --- utilidades de sesión ---
async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tokenAleatorio() {
  const u8 = crypto.getRandomValues(new Uint8Array(32));
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RE_USERNAME = /^[A-Za-z0-9._-]{3,40}$/;
const RE_PASSWORD = /^.{6,128}$/;

// Login fallido: rate limit en memoria (por username+IP)
const LOGIN_FAILS = new Map(); // clave -> {n, ts}
function loginBloqueado(clave) {
  const now = Date.now();
  if (LOGIN_FAILS.size > 2000) {
    for (const [k, v] of LOGIN_FAILS) if (now - v.ts > 900000) LOGIN_FAILS.delete(k);
  }
  const e = LOGIN_FAILS.get(clave);
  if (!e || now - e.ts > 900000) return false;
  return e.n >= 5; // máx 5 fallos / 15 min
}
function loginFallido(clave) {
  const now = Date.now();
  const e = LOGIN_FAILS.get(clave);
  if (!e || now - e.ts > 900000) LOGIN_FAILS.set(clave, { n: 1, ts: now });
  else e.n += 1;
}
function loginExitoso(clave) { LOGIN_FAILS.delete(clave); }

const ROLES = { 1: "ADMIN", 2: "MODERADOR", 3: "EDITOR", 4: "CONSULTA" };
const rolNombre = (n) => ROLES[n] || "CONSULTA";

// Valida el token de sesión y devuelve el usuario (o null)
async function sesionUsuario(env, request) {
  if (!necesitaDb(env)) return null;
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+([A-Za-z0-9]+)$/);
  if (!m) return null;
  const th = await sha256Hex(m[1]);
  const fila = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.username, u.display_name, u.role_level, u.active, u.must_change_password
     FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(th).first();
  if (!fila) return null;
  if (new Date(fila.expires_at + "Z") < new Date()) return null;
  if (fila.active !== 1) return null;
  return {
    id: fila.user_id,
    username: fila.username,
    display_name: fila.display_name,
    role_level: fila.role_level,
    rol: rolNombre(fila.role_level),
    must_change_password: !!fila.must_change_password,
  };
}

// Permiso: nivel mínimo requerido (1 = solo ADMIN ... 4 = cualquiera autenticado)
async function exigirRol(env, request, minLevel) {
  const u = await sesionUsuario(env, request);
  if (!u) return { error: "No autorizado", status: 401 };
  if (u.role_level > minLevel) return { error: "No tienes permiso para esta acción", status: 403 };
  return { usuario: u };
}

// Limpia sesiones vencidas de un usuario (al hacer logout o login nuevo)
async function limpiarSesionesUsuario(env, userId) {
  await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id=? OR expires_at < datetime('now')")
    .bind(userId).run();
}

// Conteos de votos por supervisor en un solo query
const SQL_VOTOS_SUP = `
  SELECT sv.supervisor_id AS id,
         COALESCE(SUM(CASE WHEN sv.vote_type='like' THEN 1 ELSE 0 END),0) AS likes,
         COALESCE(SUM(CASE WHEN sv.vote_type='dislike' THEN 1 ELSE 0 END),0) AS dislikes
  FROM supervisor_votes sv GROUP BY sv.supervisor_id`;

const SQL_SUPERVISORES = `
  SELECT s.id, s.nombre, s.cargo, s.activo, s.created_at
  FROM supervisores s`;

async function supervisorVotos(env, origin) {
  const r = await env.DB.prepare(SQL_VOTOS_SUP).all();
  const map = {};
  for (const row of (r.results || [])) map[row.id] = { likes: row.likes, dislikes: row.dislikes };
  return map;
}

async function votoActualDe(env, supervisorId, voterId) {
  const r = await env.DB.prepare(
    "SELECT vote_type FROM supervisor_votes WHERE supervisor_id=? AND voter_id=?"
  ).bind(supervisorId, voterId).first();
  return r ? r.vote_type : null;
}

function armarRanking(lista, votos) {
  return lista
    .map((s) => {
      const v = votos[s.id] || { likes: 0, dislikes: 0 };
      const total = v.likes + v.dislikes;
      const pct = total > 0 ? Math.round((v.likes / total) * 100) : 0;
      return {
        id: s.id, nombre: s.nombre, cargo: s.cargo, activo: !!s.activo,
        created_at: s.created_at, likes: v.likes, dislikes: v.dislikes,
        total_votos: total, porcentaje_positivo: pct,
      };
    })
    .sort((a, b) =>
      b.likes - a.likes !== 0 ? b.likes - a.likes
      : a.dislikes - b.dislikes !== 0 ? a.dislikes - b.dislikes
      : a.id - b.id)
    .map((s, i) => ({ ...s, puesto: i + 1 }));
}

/* ============================================================
 *  fetch principal
 * ============================================================ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Página principal / salud
    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonRes(
        { ok: true, service: "PROAGRO API Worker", status: "online", timestamp: new Date().toISOString() },
        200,
        origin
      );
    }

    // ==========================================
    // RANKING PROAGRO  (GET /api/ranking)
    // ==========================================
    if (url.pathname === "/api/ranking") {
      if (request.method !== "GET") {
        return jsonRes({ ok: false, error: "Método no permitido (usa GET)" }, 405, origin);
      }
      const top = url.searchParams.get("top") || "5000";
      const fechaIni = url.searchParams.get("fechaIni");
      const fechaFin = url.searchParams.get("fechaFin");
      const lotes = url.searchParams.get("lotes") || "";
      const variedades = url.searchParams.get("variedades") || "";

      if (!fechaIni || !fechaFin || !validaFecha(fechaIni) || !validaFecha(fechaFin)) {
        return jsonRes({ ok: false, error: "fechaIni y fechaFin obligatorias (YYYY-MM-DD)" }, 400, origin);
      }
      const topNumber = Number(top);
      if (!Number.isInteger(topNumber) || topNumber < 1 || topNumber > 5000) {
        return jsonRes({ ok: false, error: "Parámetro top inválido (1-5000)" }, 400, origin);
      }

      const target = new URL("/QrKgAra/ObtenerRankingVista", PROAGRO_ORIGIN);
      target.searchParams.set("top", String(topNumber));
      target.searchParams.set("fechaIni", fechaIni);
      target.searchParams.set("fechaFin", fechaFin);
      target.searchParams.set("lotes", lotes);
      target.searchParams.set("variedades", variedades);

      try {
        const response = await fetch(target.toString(), {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "PROAGRO-Web-Worker" },
        });
        const body = await response.text();
        return new Response(body, {
          status: response.status,
          headers: {
            "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
            ...corsHeaders(origin),
          },
        });
      } catch (error) {
        return jsonRes({ ok: false, error: "No se pudo conectar con PROAGRO" }, 502, origin);
      }
    }

    // ==========================================
    // COSECHA PROAGRO  (POST /api/cosecha)
    // ==========================================
    if (url.pathname === "/api/cosecha") {
      if (request.method !== "POST") {
        return jsonRes({ ok: false, error: "Método no permitido (usa POST)" }, 405, origin);
      }
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
      }
      const dni = typeof body.dni === "string" ? body.dni.trim() : "";
      const fechaIni = typeof body.fechaIni === "string" ? body.fechaIni : "";
      const fechaFin = typeof body.fechaFin === "string" ? body.fechaFin : "";
      if (!/^\d{8}$/.test(dni)) {
        return jsonRes({ ok: false, error: "DNI debe tener exactamente 8 dígitos" }, 400, origin);
      }
      if (!validaFecha(fechaIni) || !validaFecha(fechaFin)) {
        return jsonRes({ ok: false, error: "fechaIni y fechaFin obligatorias (YYYY-MM-DD)" }, 400, origin);
      }
      if (fechaIni > fechaFin) {
        return jsonRes({ ok: false, error: "fechaIni no puede ser posterior a fechaFin" }, 400, origin);
      }
      const dias = (Date.parse(fechaFin) - Date.parse(fechaIni)) / 86400000;
      if (dias > 31) {
        return jsonRes({ ok: false, error: "Rango máximo 31 días" }, 400, origin);
      }
      try {
        const response = await fetch(PROAGRO_ORIGIN + "/QrKgAra/ConsultarKgVista", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ dni, fechaIni, fechaFin }),
        });
        const text = await response.text();
        return new Response(text, {
          status: response.status,
          headers: {
            "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
            ...corsHeaders(origin),
          },
        });
      } catch (error) {
        return jsonRes({ ok: false, error: "No se pudo conectar con PROAGRO" }, 502, origin);
      }
    }

    /* ============================================================
     *  COMUNIDAD
     * ============================================================ */
    const p = url.pathname;

    // ----- GET /api/community/supervisors  (+ ?voter_id=) -----
    if (p === "/api/community/supervisors" && request.method === "GET") {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      try {
        const lista = (await env.DB.prepare(SQL_SUPERVISORES + " WHERE s.activo=1 ORDER BY s.nombre").all()).results || [];
        const votos = await supervisorVotos(env, origin);
        const ranking = armarRanking(lista, votos);
        // voto del votante actual (para marcar botones)
        const voterId = (url.searchParams.get("voter_id") || "").trim();
        let miVoto = {};
        if (okVoterId(voterId)) {
          const rr = await env.DB.prepare(
            "SELECT supervisor_id, vote_type FROM supervisor_votes WHERE voter_id=?"
          ).bind(voterId).all();
          for (const row of (rr.results || [])) miVoto[row.supervisor_id] = row.vote_type;
        }
        return jsonRes({ ok: true, supervisores: ranking, mi_voto: miVoto }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- GET /api/community/supervisors/ranking -----
    if (p === "/api/community/supervisors/ranking" && request.method === "GET") {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      try {
        const lista = (await env.DB.prepare(SQL_SUPERVISORES + " WHERE s.activo=1").all()).results || [];
        const votos = await supervisorVotos(env, origin);
        return jsonRes({ ok: true, ranking: armarRanking(lista, votos) }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- POST /api/community/supervisors/:id/vote -----
    let m = p.match(/^\/api\/community\/supervisors\/(\d+)\/vote$/);
    if (m) {
      if (request.method !== "POST") {
        return jsonRes({ ok: false, error: "Método no permitido (usa POST)" }, 405, origin);
      }
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      let body;
      try { body = await request.json(); } catch (e) {
        return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
      }
      const supervisorId = Number(m[1]);
      const voterId = typeof body.voter_id === "string" ? body.voter_id.trim() : "";
      const voteType = body.vote_type;
      if (!okVoterId(voterId)) {
        return jsonRes({ ok: false, error: "voter_id inválido o ausente" }, 400, origin);
      }
      if (voteType !== "like" && voteType !== "dislike") {
        return jsonRes({ ok: false, error: "vote_type debe ser 'like' o 'dislike'" }, 400, origin);
      }
      if (!rateLimit(voterId)) {
        return jsonRes({ ok: false, error: "Demasiadas acciones. Espera un momento." }, 429, origin);
      }
      try {
        const existe = await env.DB.prepare("SELECT id FROM supervisores WHERE id=? AND activo=1")
          .bind(supervisorId).first();
        if (!existe) return jsonRes({ ok: false, error: "Supervisor no encontrado" }, 404, origin);

        const actual = await votoActualDe(env, supervisorId, voterId);
        let accion;
        if (actual === null) {
          await env.DB.prepare(
            "INSERT INTO supervisor_votes (supervisor_id, voter_id, vote_type) VALUES (?,?,?)"
          ).bind(supervisorId, voterId, voteType).run();
          accion = "creado";
        } else if (actual === voteType) {
          // pulsa su mismo voto → lo quita (toggle)
          await env.DB.prepare(
            "DELETE FROM supervisor_votes WHERE supervisor_id=? AND voter_id=?"
          ).bind(supervisorId, voterId).run();
          accion = "quitado";
        } else {
          await env.DB.prepare(
            "UPDATE supervisor_votes SET vote_type=?, updated_at=datetime('now') WHERE supervisor_id=? AND voter_id=?"
          ).bind(voteType, supervisorId, voterId).run();
          accion = "cambiado";
        }
        const votos = await supervisorVotos(env, origin);
        const v = votos[supervisorId] || { likes: 0, dislikes: 0 };
        return jsonRes({ ok: true, accion, supervisor_id: supervisorId,
          mi_voto: accion === "quitado" ? null : voteType,
          likes: v.likes, dislikes: v.dislikes }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- GET/POST /api/community/supervisors/:id/comments -----
    m = p.match(/^\/api\/community\/supervisors\/(\d+)\/comments$/);
    if (m) {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      const supervisorId = Number(m[1]);
      if (request.method === "GET") {
        try {
          const rr = await env.DB.prepare(
            "SELECT id, content, created_at FROM comments WHERE supervisor_id=? AND status='visible' ORDER BY id DESC LIMIT 100"
          ).bind(supervisorId).all();
          return jsonRes({ ok: true, comentarios: (rr.results || []) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const voterId = typeof body.voter_id === "string" ? body.voter_id.trim() : "";
        const content = limpiarParrafo(body.content, 500);
        if (!okVoterId(voterId)) {
          return jsonRes({ ok: false, error: "voter_id inválido o ausente" }, 400, origin);
        }
        if (!content) {
          return jsonRes({ ok: false, error: "Comentario vacío" }, 400, origin);
        }
        if (content.length < 2) {
          return jsonRes({ ok: false, error: "Comentario demasiado corto" }, 400, origin);
        }
        if (!rateLimit(voterId)) {
          return jsonRes({ ok: false, error: "Demasiados comentarios. Espera un momento." }, 429, origin);
        }
        try {
          const existe = await env.DB.prepare("SELECT id FROM supervisores WHERE id=? AND activo=1")
            .bind(supervisorId).first();
          if (!existe) return jsonRes({ ok: false, error: "Supervisor no encontrado" }, 404, origin);
          const ins = await env.DB.prepare(
            "INSERT INTO comments (supervisor_id, voter_id, content) VALUES (?,?,?)"
          ).bind(supervisorId, voterId, content).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id, content }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // ----- GET /api/community/posts?type=&category= -----
    if (p === "/api/community/posts" && request.method === "GET") {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      try {
        const tipo = limpioSimple(url.searchParams.get("type") || "", 20);
        const cat = limpioSimple(url.searchParams.get("category") || "", 40);
        let sql = "SELECT id, type, category, title, content, image_key, image_url, author, created_at FROM posts WHERE status='activo'";
        const binds = [];
        if (tipo) { sql += " AND type=?"; binds.push(tipo); }
        if (cat) { sql += " AND category=?"; binds.push(cat); }
        sql += " ORDER BY id DESC LIMIT 100";
        const rr = await env.DB.prepare(sql).bind(...binds).all();
        return jsonRes({ ok: true, posts: (rr.results || []) }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- GET /api/community/posts/:id (con comentarios) -----
    m = p.match(/^\/api\/community\/posts\/(\d+)$/);
    if (m) {
      if (request.method !== "GET") {
        return jsonRes({ ok: false, error: "Método no permitido (usa GET)" }, 405, origin);
      }
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      try {
        const post = await env.DB.prepare(
          "SELECT id, type, category, title, content, image_key, image_url, author, created_at FROM posts WHERE id=? AND status='activo'"
        ).bind(Number(m[1])).first();
        if (!post) return jsonRes({ ok: false, error: "Publicación no encontrada" }, 404, origin);
        const cc = await env.DB.prepare(
          "SELECT id, content, created_at FROM comments WHERE post_id=? AND status='visible' ORDER BY id DESC LIMIT 100"
        ).bind(post.id).all();
        return jsonRes({ ok: true, post, comentarios: (cc.results || []) }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- POST /api/community/posts/:id/comments -----
    m = p.match(/^\/api\/community\/posts\/(\d+)\/comments$/);
    if (m) {
      if (request.method !== "POST") {
        return jsonRes({ ok: false, error: "Método no permitido (usa POST)" }, 405, origin);
      }
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      let body;
      try { body = await request.json(); } catch (e) {
        return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
      }
      const voterId = typeof body.voter_id === "string" ? body.voter_id.trim() : "";
      const content = limpiarParrafo(body.content, 500);
      if (!okVoterId(voterId)) return jsonRes({ ok: false, error: "voter_id inválido o ausente" }, 400, origin);
      if (!content || content.length < 2) return jsonRes({ ok: false, error: "Comentario inválido" }, 400, origin);
      if (!rateLimit(voterId)) return jsonRes({ ok: false, error: "Demasiados comentarios. Espera un momento." }, 429, origin);
      try {
        const existe = await env.DB.prepare("SELECT id FROM posts WHERE id=? AND status='activo'")
          .bind(Number(m[1])).first();
        if (!existe) return jsonRes({ ok: false, error: "Publicación no encontrada" }, 404, origin);
        const ins = await env.DB.prepare(
          "INSERT INTO comments (post_id, voter_id, content) VALUES (?,?,?)"
        ).bind(Number(m[1]), voterId, content).run();
        return jsonRes({ ok: true, id: ins.meta.last_row_id, content }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- GET /api/community/surveys (+ ?voter_id= para marcar) -----
    if (p === "/api/community/surveys" && request.method === "GET") {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      try {
        const voterId = (url.searchParams.get("voter_id") || "").trim();
        const rr = await env.DB.prepare(
          "SELECT id, question, status, start_at, end_at, created_at FROM surveys WHERE status='activa' ORDER BY id DESC LIMIT 50"
        ).all();
        const encuestas = [];
        for (const s of (rr.results || [])) {
          const opts = await env.DB.prepare(
            "SELECT id, option_text FROM survey_options WHERE survey_id=? ORDER BY id"
          ).bind(s.id).all();
          const vs = await env.DB.prepare(
            "SELECT option_id, COUNT(*) AS n FROM survey_votes WHERE survey_id=? GROUP BY option_id"
          ).bind(s.id).all();
          const votos = vs.results || [];
          const totalVotos = votos.reduce((x, y) => x + y.n, 0);
          let yaVoto = null;
          if (okVoterId(voterId)) {
            const miv = await env.DB.prepare(
              "SELECT option_id FROM survey_votes WHERE survey_id=? AND voter_id=?"
            ).bind(s.id, voterId).first();
            yaVoto = miv ? miv.option_id : null;
          }
          encuestas.push({
            id: s.id, question: s.question, status: s.status,
            start_at: s.start_at, end_at: s.end_at, created_at: s.created_at,
            opciones: (opts.results || []).map(o => ({ ...o, votos: (votos.find(v => v.option_id === o.id) || {}).n || 0 })),
            total_votos: totalVotos, ya_vote_option_id: yaVoto,
          });
        }
        return jsonRes({ ok: true, encuestas }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- POST /api/community/surveys/:id/vote -----
    m = p.match(/^\/api\/community\/surveys\/(\d+)\/vote$/);
    if (m) {
      if (request.method !== "POST") {
        return jsonRes({ ok: false, error: "Método no permitido (usa POST)" }, 405, origin);
      }
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      let body;
      try { body = await request.json(); } catch (e) {
        return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
      }
      const surveyId = Number(m[1]);
      const voterId = typeof body.voter_id === "string" ? body.voter_id.trim() : "";
      const optionId = Number(body.option_id);
      if (!okVoterId(voterId)) return jsonRes({ ok: false, error: "voter_id inválido o ausente" }, 400, origin);
      if (!Number.isInteger(optionId) || optionId < 1) {
        return jsonRes({ ok: false, error: "option_id inválido" }, 400, origin);
      }
      if (!rateLimit(voterId)) return jsonRes({ ok: false, error: "Demasiadas acciones. Espera un momento." }, 429, origin);
      try {
        const enc = await env.DB.prepare("SELECT id FROM surveys WHERE id=? AND status='activa'")
          .bind(surveyId).first();
        if (!enc) return jsonRes({ ok: false, error: "Encuesta no encontrada o cerrada" }, 404, origin);
        const opt = await env.DB.prepare("SELECT id FROM survey_options WHERE id=? AND survey_id=?")
          .bind(optionId, surveyId).first();
        if (!opt) return jsonRes({ ok: false, error: "Opción inválida para esta encuesta" }, 400, origin);
        const ya = await env.DB.prepare("SELECT id FROM survey_votes WHERE survey_id=? AND voter_id=?")
          .bind(surveyId, voterId).first();
        if (ya) return jsonRes({ ok: false, error: "Ya votaste en esta encuesta" }, 409, origin);
        await env.DB.prepare(
          "INSERT INTO survey_votes (survey_id, option_id, voter_id) VALUES (?,?,?)"
        ).bind(surveyId, optionId, voterId).run();
        const vs = await env.DB.prepare(
          "SELECT option_id, COUNT(*) AS n FROM survey_votes WHERE survey_id=? GROUP BY option_id"
        ).bind(surveyId).all();
        return jsonRes({ ok: true, ya_vote_option_id: optionId, resultados: (vs.results || []) }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
      }
    }

    // ----- POST /api/community/media  (R2 — opcional) -----
    if (p === "/api/community/media") {
      if (request.method !== "POST") {
        return jsonRes({ ok: false, error: "Método no permitido (usa POST)" }, 405, origin);
      }
      if (!esAdmin(env, request)) {
        return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      }
      if (!env || !env.MEDIA) {
        return jsonRes({ ok: false, error: "R2 (binding MEDIA) no configurado en el Worker" }, 501, origin);
      }
      const ct = (request.headers.get("Content-Type") || "").toLowerCase();
      const MIMES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
      const ext = MIMES[ct];
      if (!ext) {
        return jsonRes({ ok: false, error: "Solo se aceptan imágenes JPEG, PNG o WEBP" }, 400, origin);
      }
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > 5 * 1024 * 1024) {
        return jsonRes({ ok: false, error: "La imagen supera el máximo de 5 MB" }, 413, origin);
      }
      try {
        const buf = await request.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) {
          return jsonRes({ ok: false, error: "La imagen supera el máximo de 5 MB" }, 413, origin);
        }
        // clave segura: aleatoria, sin nada del cliente
        const key = "community/" + crypto.randomUUID() + ext;
        await env.MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });
        const publicUrl = (env.MEDIA_PUBLIC_URL || "").replace(/\/$/, "");
        return jsonRes({ ok: true, image_key: key,
          image_url: publicUrl ? publicUrl + "/" + key : null }, 200, origin);
      } catch (e) {
        return jsonRes({ ok: false, error: "Error al subir: " + e.message }, 500, origin);
      }
    }

    // ================= ADMIN (protegido) =================
    // GET/POST /api/community/admin/supervisors
    if (p === "/api/community/admin/supervisors") {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "GET") {
        try {
          const lista = (await env.DB.prepare(SQL_SUPERVISORES + " ORDER BY s.id").all()).results || [];
          const votos = await supervisorVotos(env, origin);
          return jsonRes({ ok: true, supervisores: armarRanking(lista, votos) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const nombre = limpioSimple(body.nombre, 80);
        const cargo = limpioSimple(body.cargo, 80) || "Supervisor/a";
        if (!nombre) return jsonRes({ ok: false, error: "nombre obligatorio" }, 400, origin);
        try {
          const dup = await env.DB.prepare("SELECT id FROM supervisores WHERE nombre=? COLLATE NOCASE")
            .bind(nombre).first();
          if (dup) return jsonRes({ ok: false, error: "Ya existe un supervisor con ese nombre" }, 409, origin);
          const ins = await env.DB.prepare("INSERT INTO supervisores (nombre, cargo, activo) VALUES (?,?,1)")
            .bind(nombre, cargo).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // PATCH/DELETE /api/community/admin/supervisors/:id
    m = p.match(/^\/api\/community\/admin\/supervisors\/(\d+)$/);
    if (m) {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      const supervisorId = Number(m[1]);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = [];
        const binds = [];
        if (body.nombre !== undefined) {
          const nombre = limpioSimple(body.nombre, 80);
          if (!nombre) return jsonRes({ ok: false, error: "nombre vacío" }, 400, origin);
          sets.push("nombre=?"); binds.push(nombre);
        }
        if (body.cargo !== undefined) {
          const cargo = limpioSimple(body.cargo, 80);
          if (!cargo) return jsonRes({ ok: false, error: "cargo vacío" }, 400, origin);
          sets.push("cargo=?"); binds.push(cargo);
        }
        if (body.activo !== undefined) {
          const activo = body.activo ? 1 : 0;
          sets.push("activo=?"); binds.push(activo);
        }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        sets.push("updated_at=datetime('now')");
        binds.push(supervisorId);
        try {
          await env.DB.prepare("UPDATE supervisores SET " + sets.join(", ") + " WHERE id=?")
            .bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "DELETE") {
        try {
          // No destructivo: desactiva (borrado lógico)
          await env.DB.prepare("UPDATE supervisores SET activo=0, updated_at=datetime('now') WHERE id=?")
            .bind(supervisorId).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // GET/POST /api/community/admin/posts
    if (p === "/api/community/admin/posts") {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "GET") {
        try {
          const rr = await env.DB.prepare(
            "SELECT id, type, category, title, content, image_key, image_url, author, status, created_at FROM posts ORDER BY id DESC LIMIT 200"
          ).all();
          return jsonRes({ ok: true, posts: (rr.results || []) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const tipo = limpioSimple(body.type || "aviso", 20);
        const category = limpioSimple(body.category, 40);
        const title = limpiarTexto(body.title, 150);
        const content = limpiarParrafo(body.content, 2000);
        const image_key = limpioSimple(body.image_key, 200);
        const image_url = limpiarTexto(body.image_url, 500);
        const author = limpiarTexto(body.author, 80) || "Administración";
        if (tipo !== "noticia" && tipo !== "aviso") {
          return jsonRes({ ok: false, error: "type debe ser 'noticia' o 'aviso'" }, 400, origin);
        }
        if (!title || !content) {
          return jsonRes({ ok: false, error: "title y content obligatorios" }, 400, origin);
        }
        if (image_url && !/^https?:\/\//.test(image_url)) {
          return jsonRes({ ok: false, error: "image_url debe ser una URL http(s) válida" }, 400, origin);
        }
        try {
          const ins = await env.DB.prepare(
            "INSERT INTO posts (type, category, title, content, image_key, image_url, author) VALUES (?,?,?,?,?,?,?)"
          ).bind(tipo, category || null, title, content, image_key || null, image_url || null, author).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // PATCH/DELETE /api/community/admin/posts/:id
    m = p.match(/^\/api\/community\/admin\/posts\/(\d+)$/);
    if (m) {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      const postId = Number(m[1]);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = [];
        const binds = [];
        if (body.title !== undefined) {
          const t = limpiarTexto(body.title, 150);
          if (!t) return jsonRes({ ok: false, error: "title vacío" }, 400, origin);
          sets.push("title=?"); binds.push(t);
        }
        if (body.content !== undefined) {
          const c = limpiarParrafo(body.content, 2000);
          if (!c) return jsonRes({ ok: false, error: "content vacío" }, 400, origin);
          sets.push("content=?"); binds.push(c);
        }
        if (body.type !== undefined) {
          const tipo = limpioSimple(body.type, 20);
          if (tipo !== "noticia" && tipo !== "aviso") {
            return jsonRes({ ok: false, error: "type inválido" }, 400, origin);
          }
          sets.push("type=?"); binds.push(tipo);
        }
        if (body.category !== undefined) {
          sets.push("category=?"); binds.push(limpioSimple(body.category, 40) || null);
        }
        if (body.status !== undefined) {
          const st = limpioSimple(body.status, 20);
          if (st !== "activo" && st !== "inactivo") {
            return jsonRes({ ok: false, error: "status inválido" }, 400, origin);
          }
          sets.push("status=?"); binds.push(st);
        }
        if (body.image_key !== undefined || body.image_url !== undefined) {
          if (body.image_url && !/^https?:\/\//.test(String(body.image_url))) {
            return jsonRes({ ok: false, error: "image_url debe ser http(s)" }, 400, origin);
          }
          if (body.image_key !== undefined) { sets.push("image_key=?"); binds.push(limpioSimple(body.image_key, 200) || null); }
          if (body.image_url !== undefined) { sets.push("image_url=?"); binds.push(body.image_url ? limpiarTexto(body.image_url, 500) : null); }
        }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        sets.push("updated_at=datetime('now')");
        binds.push(postId);
        try {
          await env.DB.prepare("UPDATE posts SET " + sets.join(", ") + " WHERE id=?")
            .bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "DELETE") {
        try {
          await env.DB.prepare("UPDATE posts SET status='inactivo', updated_at=datetime('now') WHERE id=?")
            .bind(postId).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // GET/POST /api/community/admin/surveys
    if (p === "/api/community/admin/surveys") {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "GET") {
        try {
          const rr = await env.DB.prepare(
            "SELECT id, question, status, start_at, end_at, created_at FROM surveys ORDER BY id DESC LIMIT 100"
          ).all();
          const lista = [];
          for (const s of (rr.results || [])) {
            const opts = await env.DB.prepare(
              "SELECT id, option_text FROM survey_options WHERE survey_id=? ORDER BY id"
            ).bind(s.id).all();
            const vs = await env.DB.prepare(
              "SELECT option_id, COUNT(*) AS n FROM survey_votes WHERE survey_id=? GROUP BY option_id"
            ).bind(s.id).all();
            const total = (vs.results || []).reduce((x, y) => x + y.n, 0);
            lista.push({ ...s,
              opciones: (opts.results || []).map(o => ({ ...o, votos: ((vs.results || []).find(v => v.option_id === o.id) || {}).n || 0 })),
              total_votos: total });
          }
          return jsonRes({ ok: true, encuestas: lista }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const question = limpiarTexto(body.question, 300);
        const options = Array.isArray(body.options)
          ? body.options.map((o) => limpiarTexto(o, 150)).filter(Boolean).slice(0, 10)
          : [];
        if (!question) return jsonRes({ ok: false, error: "question obligatoria" }, 400, origin);
        if (options.length < 2) {
          return jsonRes({ ok: false, error: "Se necesitan al menos 2 opciones" }, 400, origin);
        }
        try {
          const ins = await env.DB.prepare("INSERT INTO surveys (question) VALUES (?)")
            .bind(question).run();
          const surveyId = ins.meta.last_row_id;
          for (const o of options) {
            await env.DB.prepare("INSERT INTO survey_options (survey_id, option_text) VALUES (?,?)")
              .bind(surveyId, o).run();
          }
          return jsonRes({ ok: true, id: surveyId }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // PATCH /api/community/admin/surveys/:id
    m = p.match(/^\/api\/community\/admin\/surveys\/(\d+)$/);
    if (m) {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = [];
        const binds = [];
        if (body.question !== undefined) {
          const q = limpiarTexto(body.question, 300);
          if (!q) return jsonRes({ ok: false, error: "question vacía" }, 400, origin);
          sets.push("question=?"); binds.push(q);
        }
        if (body.status !== undefined) {
          const st = limpioSimple(body.status, 20);
          if (st !== "activa" && st !== "cerrada") {
            return jsonRes({ ok: false, error: "status inválido (activa|cerrada)" }, 400, origin);
          }
          sets.push("status=?"); binds.push(st);
        }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        binds.push(Number(m[1]));
        try {
          await env.DB.prepare("UPDATE surveys SET " + sets.join(", ") + " WHERE id=?")
            .bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    // GET /api/community/admin/comments (moderación)
    if (p === "/api/community/admin/comments") {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "GET") {
        try {
          const rr = await env.DB.prepare(
            "SELECT id, supervisor_id, post_id, voter_id, content, status, created_at FROM comments ORDER BY id DESC LIMIT 200"
          ).all();
          return jsonRes({ ok: true, comentarios: (rr.results || []) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }
    // DELETE/PATCH /api/community/admin/comments/:id
    m = p.match(/^\/api\/community\/admin\/comments\/(\d+)$/);
    if (m) {
      if (!esAdmin(env, request)) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);
      if (request.method === "DELETE") {
        try {
          await env.DB.prepare("UPDATE comments SET status='hidden', updated_at=datetime('now') WHERE id=?")
            .bind(Number(m[1])).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (request.method === "PATCH") {  // restaurar
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        if (body.status !== "visible" && body.status !== "hidden") {
          return jsonRes({ ok: false, error: "status inválido" }, 400, origin);
        }
        try {
          await env.DB.prepare("UPDATE comments SET status=?, updated_at=datetime('now') WHERE id=?")
            .bind(body.status, Number(m[1])).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
    }

    /* ============================================================
     *  ADMIN — panel privado (/api/admin/*)
     *  Autenticación: usuario+contraseña (D1) · sesión por token.
     *  Roles: 1 ADMIN · 2 MODERADOR · 3 EDITOR · 4 CONSULTA
     * ============================================================ */
    const esAdminPath = p === "/api/admin/login"; // sin auth
    if (p.startsWith("/api/admin/")) {
      if (!necesitaDb(env)) return jsonRes({ ok: false, error: "D1 no configurado en el Worker" }, 503, origin);

      // ---------- LOGIN ----------
      if (p === "/api/admin/login" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const username = limpiarTexto(body.username, 40).toLowerCase();
        const password = typeof body.password === "string" ? body.password : "";
        if (!RE_USERNAME.test(username) || !password) {
          return jsonRes({ ok: false, error: "ID o contraseña incorrectos" }, 401, origin);
        }
        const ip = request.headers.get("CF-Connecting-IP") || "?";
        const clave = username + "|" + ip;
        if (loginBloqueado(clave)) {
          return jsonRes({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429, origin);
        }
        try {
          const u = await env.DB.prepare(
            "SELECT id, username, password_hash, display_name, role_level, active, must_change_password FROM admin_users WHERE username=?"
          ).bind(username).first();
          if (!u || u.active !== 1 || !(await verificarPassword(password, u.password_hash))) {
            loginFallido(clave);
            return jsonRes({ ok: false, error: "ID o contraseña incorrectos" }, 401, origin);
          }
          loginExitoso(clave);
          await limpiarSesionesUsuario(env, u.id);
          const token = tokenAleatorio();
          const th = await sha256Hex(token);
          const exp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
          await env.DB.prepare(
            "INSERT INTO admin_sessions (user_id, token_hash, expires_at) VALUES (?,?,?)"
          ).bind(u.id, th, exp).run();
          await env.DB.prepare("UPDATE admin_users SET last_login_at=datetime('now') WHERE id=?")
            .bind(u.id).run();
          return jsonRes({
            ok: true,
            token,
            expira: exp,
            user: {
              id: u.id, username: u.username, display_name: u.display_name,
              role_level: u.role_level, rol: rolNombre(u.role_level),
              must_change_password: !!u.must_change_password,
            },
          }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // resto: exige sesión válida
      const auth = await sesionUsuario(env, request);
      if (!auth) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
      const user = auth;

      // ---------- LOGOUT ----------
      if (p === "/api/admin/logout" && request.method === "POST") {
        try {
          const h = request.headers.get("Authorization") || "";
          const m = h.match(/^Bearer\s+([A-Za-z0-9]+)$/);
          if (m) {
            const th = await sha256Hex(m[1]);
            await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(th).run();
          }
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ---------- ME ----------
      if (p === "/api/admin/me" && request.method === "GET") {
        return jsonRes({ ok: true, user }, 200, origin);
      }

      // ---------- CAMBIAR MI CONTRASEÑA ----------
      if (p === "/api/admin/me/password" && request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const actual = typeof body.actual === "string" ? body.actual : "";
        const nueva = typeof body.nueva === "string" ? body.nueva : "";
        if (!RE_PASSWORD.test(nueva)) {
          return jsonRes({ ok: false, error: "La contraseña debe tener entre 6 y 128 caracteres" }, 400, origin);
        }
        try {
          const u = await env.DB.prepare(
            "SELECT id, password_hash, must_change_password FROM admin_users WHERE id=?"
          ).bind(user.id).first();
          if (!u) return jsonRes({ ok: false, error: "No autorizado" }, 401, origin);
          // Si aún no cambió la inicial, no hace falta la contraseña actual (1er ingreso)
          if (!u.must_change_password && !(await verificarPassword(actual, u.password_hash))) {
            return jsonRes({ ok: false, error: "La contraseña actual no es correcta" }, 400, origin);
          }
          const nuevoHash = await generarHash(nueva);
          await env.DB.prepare(
            "UPDATE admin_users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?"
          ).bind(nuevoHash, user.id).run();
          return jsonRes({ ok: true, message: "Contraseña actualizada" }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ============================================================
      //  USUARIOS ADMIN — solo ADMIN (nivel 1)
      // ============================================================
      const requiere = async (min, fn) => {
        if (user.role_level > min) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        try { return await fn(); } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      };

      // GET /api/admin/users
      if (p === "/api/admin/users" && request.method === "GET") {
        return requiere(1, async () => {
          const rr = await env.DB.prepare(
            "SELECT id, username, display_name, role_level, active, must_change_password, created_at, last_login_at FROM admin_users ORDER BY role_level, username"
          ).all();
          // nunca devolver password_hash
          return jsonRes({ ok: true, usuarios: (rr.results || []).map((x) => ({ ...x, rol: rolNombre(x.role_level) })) }, 200, origin);
        });
      }
      // POST /api/admin/users (crear usuario admin/moderador/editor/consulta)
      if (p === "/api/admin/users" && request.method === "POST") {
        return requiere(1, async () => {
          let body;
          try { body = await request.json(); } catch (e) {
            return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
          }
          const username = limpiarTexto(body.username, 40).toLowerCase();
          const password = typeof body.password === "string" ? body.password : "";
          const display_name = limpiarTexto(body.display_name, 80);
          let role_level = Number(body.role_level);
          if (!RE_USERNAME.test(username)) return jsonRes({ ok: false, error: "ID inválido (3-40 letras/números)" }, 400, origin);
          if (!RE_PASSWORD.test(password)) return jsonRes({ ok: false, error: "La contraseña debe tener entre 6 y 128 caracteres" }, 400, origin);
          if (![1, 2, 3, 4].includes(role_level)) role_level = 2;
          const existe = await env.DB.prepare("SELECT id FROM admin_users WHERE username=?").bind(username).first();
          if (existe) return jsonRes({ ok: false, error: "Ese ID de acceso ya existe" }, 409, origin);
          const hash = await generarHash(password);
          const ins = await env.DB.prepare(
            "INSERT INTO admin_users (username, password_hash, display_name, role_level, active, must_change_password) VALUES (?,?,?,?,1,1)"
          ).bind(username, hash, display_name || username, role_level).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id }, 200, origin);
        });
      }
      // PUT/DELETE /api/admin/users/:id
      m = p.match(/^\/api\/admin\/users\/(\d+)$/);
      if (m) {
        const uid = Number(m[1]);
        if (request.method === "PUT") {
          return requiere(1, async () => {
            let body;
            try { body = await request.json(); } catch (e) {
              return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
            }
            const sets = []; const binds = [];
            if (body.display_name !== undefined) { sets.push("display_name=?"); binds.push(limpiarTexto(body.display_name, 80)); }
            if (body.role_level !== undefined) {
              const rl = Number(body.role_level);
              if (![1, 2, 3, 4].includes(rl)) return jsonRes({ ok: false, error: "Nivel inválido (1-4)" }, 400, origin);
              sets.push("role_level=?"); binds.push(rl);
            }
            if (body.active !== undefined) { sets.push("active=?"); binds.push(body.active ? 1 : 0); }
            if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
            binds.push(uid);
            await env.DB.prepare("UPDATE admin_users SET " + sets.join(", ") + ", updated_at=datetime('now') WHERE id=?").bind(...binds).run();
            return jsonRes({ ok: true }, 200, origin);
          });
        }
        if (request.method === "DELETE") {
          return requiere(1, async () => {
            // no permitir borrarse a sí mismo ni eliminar al último ADMIN
            if (uid === user.id) return jsonRes({ ok: false, error: "No puedes eliminar tu propio usuario" }, 400, origin);
            const objetivo = await env.DB.prepare("SELECT role_level FROM admin_users WHERE id=?").bind(uid).first();
            if (objetivo && objetivo.role_level === 1) {
              const admins = await env.DB.prepare("SELECT COUNT(*) n FROM admin_users WHERE role_level=1 AND active=1").first();
              if ((admins && admins.n) <= 1) return jsonRes({ ok: false, error: "Debe existir al menos un ADMIN activo" }, 400, origin);
            }
            await env.DB.prepare("UPDATE admin_users SET active=0, updated_at=datetime('now') WHERE id=?").bind(uid).run();
            await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id=?").bind(uid).run();
            return jsonRes({ ok: true }, 200, origin);
          });
        }
        return jsonRes({ ok: false, error: "Método no permitido" }, 405, origin);
      }
      // POST /api/admin/users/:id/reset-password — solo ADMIN (restablece y obliga cambio)
      m = p.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
      if (m && request.method === "POST") {
        if (user.role_level > 1) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        return requiere(1, async () => {
          let body;
          try { body = await request.json(); } catch (e) {
            return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
          }
          const nueva = typeof body.password === "string" ? body.password : "";
          if (!RE_PASSWORD.test(nueva)) {
            return jsonRes({ ok: false, error: "La contraseña debe tener entre 6 y 128 caracteres" }, 400, origin);
          }
          const nuevoHash = await generarHash(nueva);
          await env.DB.prepare(
            "UPDATE admin_users SET password_hash=?, must_change_password=1, updated_at=datetime('now') WHERE id=?"
          ).bind(nuevoHash, Number(m[1])).run();
          await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id=?").bind(Number(m[1])).run();
          return jsonRes({ ok: true, message: "Contraseña restablecida" }, 200, origin);
        });
      }
      // ============================================================
      //  SUPERVISORES (admin) — CRUD con permisos
      //  Nivel 1 puede todo; niveles 2-4 solo lectura (GET)
      // ============================================================
      // GET /api/admin/supervisors — cualquier usuario autenticado
      if (p === "/api/admin/supervisors" && request.method === "GET") {
        try {
          const lista = (await env.DB.prepare("SELECT id, nombre, cargo, activo, created_at FROM supervisores ORDER BY activo DESC, nombre").all()).results || [];
          const votos = await supervisorVotos(env, origin); // mapa {id: {likes, dislikes}}
          const conVotos = lista.map((s) => {
            const v = votos[s.id] || { likes: 0, dislikes: 0 };
            return { ...s, likes: v.likes || 0, dislikes: v.dislikes || 0, comentarios: 0, activo: !!s.activo };
          });
          // conteo real de comentarios por supervisor
          const cc = await env.DB.prepare("SELECT supervisor_id, COUNT(*) n FROM comments WHERE supervisor_id IS NOT NULL GROUP BY supervisor_id").all();
          for (const s of conVotos) {
            const f = (cc.results || []).find((c) => c.supervisor_id === s.id);
            if (f) s.comentarios = f.n;
          }
          return jsonRes({ ok: true, supervisores: conVotos }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      // POST /api/admin/supervisors — solo ADMIN (nivel 1)
      if (p === "/api/admin/supervisors" && request.method === "POST") {
        if (user.role_level > 1) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const nombre = limpiarTexto(body.nombre, 80);
        const cargo = limpiarTexto(body.cargo, 80) || "Supervisor/a";
        if (!nombre) return jsonRes({ ok: false, error: "El nombre es obligatorio" }, 400, origin);
        const activo = body.activo === undefined ? 1 : (body.activo ? 1 : 0);
        try {
          const ins = await env.DB.prepare("INSERT INTO supervisores (nombre, cargo, activo) VALUES (?,?,?)")
            .bind(nombre, cargo, activo).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      // PUT/DELETE /api/admin/supervisors/:id — solo ADMIN
      m = p.match(/^\/api\/admin\/supervisors\/(\d+)$/);
      if (m && request.method === "PUT") {
        if (user.role_level > 1) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = []; const binds = [];
        if (body.nombre !== undefined) {
          const nombre = limpiarTexto(body.nombre, 80);
          if (!nombre) return jsonRes({ ok: false, error: "El nombre es obligatorio" }, 400, origin);
          sets.push("nombre=?"); binds.push(nombre);
        }
        if (body.cargo !== undefined) { sets.push("cargo=?"); binds.push(limpiarTexto(body.cargo, 80) || "Supervisor/a"); }
        if (body.activo !== undefined) { sets.push("activo=?"); binds.push(body.activo ? 1 : 0); }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        binds.push(Number(m[1]));
        try {
          await env.DB.prepare("UPDATE supervisores SET " + sets.join(", ") + " WHERE id=?").bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (m && request.method === "DELETE") {
        if (user.role_level > 1) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        try {
          // borrado lógico: se conserva el histórico de votos/comentarios
          await env.DB.prepare("UPDATE supervisores SET activo=0 WHERE id=?").bind(Number(m[1])).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ============================================================
      //  PUBLICACIONES (admin) — nivel ≤3 crea/edita; ocultar ≤2
      // ============================================================
      if (p === "/api/admin/posts" && request.method === "GET") {
        try {
          const rr = await env.DB.prepare("SELECT id, type, category, title, content, image_key, image_url, author, status, created_at FROM posts ORDER BY id DESC LIMIT 200").all();
          return jsonRes({ ok: true, posts: (rr.results || []).map((x) => ({ ...x, status_activo: x.status === "activo" })) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (p === "/api/admin/posts" && request.method === "POST") {
        if (user.role_level > 3) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const type = ["noticia", "aviso", "comunicado", "horario"].includes(body.type) ? body.type : "aviso";
        const title = limpiarTexto(body.title, 150);
        const content = limpiarParrafo(body.content, 2000);
        const category = limpiarTexto(body.category, 40);
        const author = limpiarTexto(body.author, 80) || user.display_name || user.username;
        if (!title || !content) return jsonRes({ ok: false, error: "Título y contenido obligatorios" }, 400, origin);
        try {
          const ins = await env.DB.prepare(
            "INSERT INTO posts (type, category, title, content, image_key, image_url, author, status) VALUES (?,?,?,?,?,?,?,'activo')"
          ).bind(type, category, title, content, body.image_key || null, body.image_url || null, author).run();
          return jsonRes({ ok: true, id: ins.meta.last_row_id }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      // PUT/DELETE /api/admin/posts/:id — editar ≤3, ocultar/borrar ≤2
      m = p.match(/^\/api\/admin\/posts\/(\d+)$/);
      if (m && request.method === "PUT") {
        if (user.role_level > 3) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = []; const binds = [];
        if (body.title !== undefined) { const t = limpiarTexto(body.title, 150); if (!t) return jsonRes({ ok: false, error: "Título vacío" }, 400, origin); sets.push("title=?"); binds.push(t); }
        if (body.content !== undefined) { const c = limpiarParrafo(body.content, 2000); if (!c) return jsonRes({ ok: false, error: "Contenido vacío" }, 400, origin); sets.push("content=?"); binds.push(c); }
        if (body.category !== undefined) { sets.push("category=?"); binds.push(limpiarTexto(body.category, 40)); }
        if (body.status !== undefined && user.role_level <= 2) {
          const st = ["activo", "inactivo", "hidden"].includes(body.status) ? body.status : "activo";
          sets.push("status=?"); binds.push(st);
        }
        if (body.image_url !== undefined) { sets.push("image_url=?"); binds.push(limpiarTexto(body.image_url, 500) || null); }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        binds.push(Number(m[1]));
        try {
          await env.DB.prepare("UPDATE posts SET " + sets.join(", ") + ", updated_at=datetime('now') WHERE id=?").bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (m && request.method === "DELETE") {
        if (user.role_level > 2) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        try {
          await env.DB.prepare("UPDATE posts SET status='inactivo', updated_at=datetime('now') WHERE id=?").bind(Number(m[1])).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ============================================================
      //  ENCUESTAS (admin) — crear/editar/cerrar nivel ≤2
      // ============================================================
      if (p === "/api/admin/surveys" && request.method === "GET") {
        try {
          const rr = await env.DB.prepare("SELECT id, question, status, created_at FROM surveys ORDER BY id DESC LIMIT 100").all();
          const encuestas = [];
          for (const e of (rr.results || [])) {
            const opts = (await env.DB.prepare("SELECT id, option_text FROM survey_options WHERE survey_id=? ORDER BY id").bind(e.id).all()).results || [];
            const votos = (await env.DB.prepare("SELECT option_id, COUNT(*) n FROM survey_votes WHERE survey_id=? GROUP BY option_id").bind(e.id).all()).results || [];
            const total = (await env.DB.prepare("SELECT COUNT(*) n FROM survey_votes WHERE survey_id=?").bind(e.id).first());
            encuestas.push({ ...e, opciones: opts.map((o) => ({ ...o, votos: (votos.find((v) => v.option_id === o.id) || {}).n || 0 })), total_votos: (total && total.n) || 0 });
          }
          return jsonRes({ ok: true, encuestas }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      if (p === "/api/admin/surveys" && request.method === "POST") {
        if (user.role_level > 2) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const question = limpiarTexto(body.question, 300);
        const options = Array.isArray(body.options)
          ? body.options.map((o) => limpiarTexto(o, 150)).filter(Boolean).slice(0, 10)
          : [];
        if (!question || options.length < 2) {
          return jsonRes({ ok: false, error: "Pregunta y al menos 2 opciones son obligatorias" }, 400, origin);
        }
        try {
          const ins = await env.DB.prepare("INSERT INTO surveys (question) VALUES (?)").bind(question).run();
          const sid = ins.meta.last_row_id;
          for (const o of options) {
            await env.DB.prepare("INSERT INTO survey_options (survey_id, option_text) VALUES (?,?)").bind(sid, o).run();
          }
          return jsonRes({ ok: true, id: sid }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      // PUT /api/admin/surveys/:id (editar pregunta/estado)
      m = p.match(/^\/api\/admin\/surveys\/(\d+)$/);
      if (m && request.method === "PUT") {
        if (user.role_level > 2) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        let body;
        try { body = await request.json(); } catch (e) {
          return jsonRes({ ok: false, error: "JSON inválido" }, 400, origin);
        }
        const sets = []; const binds = [];
        if (body.question !== undefined) { const q = limpiarTexto(body.question, 300); if (!q) return jsonRes({ ok: false, error: "Pregunta vacía" }, 400, origin); sets.push("question=?"); binds.push(q); }
        if (body.status !== undefined) {
          const st = ["activa", "cerrada"].includes(body.status) ? body.status : "activa";
          sets.push("status=?"); binds.push(st);
        }
        if (!sets.length) return jsonRes({ ok: false, error: "Nada que actualizar" }, 400, origin);
        binds.push(Number(m[1]));
        try {
          await env.DB.prepare("UPDATE surveys SET " + sets.join(", ") + ", updated_at=datetime('now') WHERE id=?").bind(...binds).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ============================================================
      //  COMENTARIOS (moderación) — nivel ≤2
      // ============================================================
      if (p === "/api/admin/comments" && request.method === "GET") {
        if (user.role_level > 2) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        try {
          const rr = await env.DB.prepare(
            "SELECT c.id, c.supervisor_id, c.post_id, c.content, c.status, c.created_at, s.nombre AS supervisor_nombre FROM comments c LEFT JOIN supervisores s ON s.id=c.supervisor_id ORDER BY c.id DESC LIMIT 200"
          ).all();
          return jsonRes({ ok: true, comentarios: (rr.results || []) }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }
      // PUT/DELETE /api/admin/comments/:id  {status: visible|hidden|deleted}
      m = p.match(/^\/api\/admin\/comments\/(\d+)$/);
      if (m && (request.method === "PUT" || request.method === "DELETE")) {
        if (user.role_level > 2) return jsonRes({ ok: false, error: "No tienes permiso para esta acción" }, 403, origin);
        try {
          let status = "hidden";
          if (request.method === "DELETE") {
            status = "deleted";
          } else {
            let body = {};
            try { body = await request.json(); } catch (e) { body = {}; }
            if (["visible", "hidden", "deleted"].includes(body.status)) status = body.status;
          }
          await env.DB.prepare("UPDATE comments SET status=?, updated_at=datetime('now') WHERE id=?").bind(status, Number(m[1])).run();
          return jsonRes({ ok: true }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      // ============================================================
      //  ESTADÍSTICAS — cualquier usuario autenticado
      // ============================================================
      if (p === "/api/admin/stats" && request.method === "GET") {
        try {
          const cnt = async (sql) => { const r = await env.DB.prepare(sql).first(); return (r && r.n) || 0; };
          const hoy = new Date().toISOString().slice(0, 10);
          const semanaIni = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
          const mesIni = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
          const stats = {
            visitas: {
              hoy: await cnt("SELECT SUM(hits) n FROM visit_stats WHERE day='" + hoy + "'"),
              semana: await cnt("SELECT SUM(hits) n FROM visit_stats WHERE day>='" + semanaIni + "'"),
              mes: await cnt("SELECT SUM(hits) n FROM visit_stats WHERE day>='" + mesIni + "'"),
              historico: await cnt("SELECT SUM(hits) n FROM visit_stats"),
            },
            supervisores: {
              total: await cnt("SELECT COUNT(*) n FROM supervisores"),
              activos: await cnt("SELECT COUNT(*) n FROM supervisores WHERE activo=1"),
              likes: await cnt("SELECT COUNT(*) n FROM supervisor_votes WHERE vote_type='like'"),
              dislikes: await cnt("SELECT COUNT(*) n FROM supervisor_votes WHERE vote_type='dislike'"),
              comentarios: await cnt("SELECT COUNT(*) n FROM comments"),
            },
            encuestas: {
              total: await cnt("SELECT COUNT(*) n FROM surveys"),
              votos: await cnt("SELECT COUNT(*) n FROM survey_votes"),
              activas: await cnt("SELECT COUNT(*) n FROM surveys WHERE status='activa'"),
            },
            publicaciones: {
              total: await cnt("SELECT COUNT(*) n FROM posts"),
              noticias: await cnt("SELECT COUNT(*) n FROM posts WHERE type='noticia'"),
              avisos: await cnt("SELECT COUNT(*) n FROM posts WHERE type='aviso'"),
              activas: await cnt("SELECT COUNT(*) n FROM posts WHERE status='activo'"),
            },
            comentarios_mod: {
              total: await cnt("SELECT COUNT(*) n FROM comments"),
              visibles: await cnt("SELECT COUNT(*) n FROM comments WHERE status='visible'"),
              moderados: await cnt("SELECT COUNT(*) n FROM comments WHERE status!='visible'"),
            },
          };
          return jsonRes({ ok: true, stats }, 200, origin);
        } catch (e) {
          return jsonRes({ ok: false, error: "Error de base de datos: " + e.message }, 500, origin);
        }
      }

      return jsonRes({ ok: false, error: "Ruta no encontrada" }, 404, origin);
    }

    return jsonRes({ ok: false, error: "Ruta no encontrada" }, 404, origin);
  },
};
