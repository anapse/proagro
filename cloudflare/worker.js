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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

    return jsonRes({ ok: false, error: "Ruta no encontrada" }, 404, origin);
  },
};
