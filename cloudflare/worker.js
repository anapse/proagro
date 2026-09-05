// PROAGRO WEB — Worker final (Cloudflare Workers)
// Conserva el código de ranking desplegado y añade POST /api/cosecha.
// Rutas: GET / · GET /health · GET /api/ranking · POST /api/cosecha · OPTIONS

const PROAGRO_ORIGIN = "https://digital.proagro.pe";
const ALLOWED_ORIGIN = "https://anapse.github.io";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin":
      origin === ALLOWED_ORIGIN ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        ? origin
        : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

export default {
  async fetch(request) {
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

    return jsonRes({ ok: false, error: "Ruta no encontrada" }, 404, origin);
  },
};
