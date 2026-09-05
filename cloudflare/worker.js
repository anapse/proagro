// PROAGRO WEB — Worker serverless mínimo (Cloudflare Workers)
// SOLO endpoints de lectura validados hacia PROAGRO. Sin proxy abierto.
//   GET  /             -> info
//   GET  /health       -> {"ok":true,...}
//   POST /api/cosecha  -> ConsultarKgVista  {dni,fechaIni,fechaFin}
//   GET  /api/ranking  -> ObtenerRankingVista?top&fechaIni&fechaFin
// CORS: únicamente https://anapse.github.io (+ localhost para desarrollo).

const PROAGRO = "https://digital.proagro.pe";
const ORIGENES = ["https://anapse.github.io"];

function corsOrigen(origin) {
  if (!origin) return "";
  const ok = ORIGENES.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? origin : "";
}

function cabeceras(origen) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (origen) {
    h["Access-Control-Allow-Origin"] = origen;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function validaFecha(x) {
  if (typeof x !== "string" || !RE_ISO.test(x)) return false;
  const d = new Date(x + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

function json(resp, status = 200, origen) {
  return new Response(JSON.stringify(resp), { status, headers: cabeceras(origen) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metodo = request.method.toUpperCase();
    const origen = corsOrigen(request.headers.get("Origin"));
    const path = url.pathname;

    if (metodo === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras(origen) });

    // ---- info / salud ----
    if (metodo === "GET" && (path === "/" || path === "")) {
      return json({ ok: true, service: "PROAGRO API Worker", rutas: ["/", "/health", "POST /api/cosecha", "GET /api/ranking"], docs: "https://github.com/anapse/proagro" }, 200, origen);
    }
    if (metodo === "GET" && path === "/health") {
      return json({ ok: true, service: "PROAGRO API Worker", status: "online", timestamp: new Date().toISOString() }, 200, origen);
    }

    // ---- COSECHA (solo POST, solo lectura) ----
    if (path === "/api/cosecha") {
      if (metodo !== "POST") return json({ error: "Método no permitido (usa POST)" }, 405, origen);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: "JSON inválido" }, 400, origen); }
      const dni = typeof body.dni === "string" ? body.dni.trim() : "";
      const fechaIni = typeof body.fechaIni === "string" ? body.fechaIni : "";
      const fechaFin = typeof body.fechaFin === "string" ? body.fechaFin : "";
      if (!/^\d{8}$/.test(dni)) return json({ error: "DNI debe tener exactamente 8 dígitos" }, 400, origen);
      if (!validaFecha(fechaIni)) return json({ error: "fechaIni debe ser YYYY-MM-DD válida" }, 400, origen);
      if (!validaFecha(fechaFin)) return json({ error: "fechaFin debe ser YYYY-MM-DD válida" }, 400, origen);
      if (fechaIni > fechaFin) return json({ error: "fechaIni no puede ser posterior a fechaFin" }, 400, origen);
      const dias = (Date.parse(fechaFin) - Date.parse(fechaIni)) / 86400000;
      if (dias > 31) return json({ error: "Rango máximo 31 días" }, 400, origen);

      const resp = await fetch(PROAGRO + "/QrKgAra/ConsultarKgVista", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ dni, fechaIni, fechaFin }),
      });
      const texto = await resp.text();
      return new Response(texto, { status: resp.status, headers: cabeceras(origen) });
    }

    // ---- RANKING (solo GET, solo lectura) ----
    if (path === "/api/ranking") {
      if (metodo !== "GET") return json({ error: "Método no permitido (usa GET)" }, 405, origen);
      const top = parseInt(url.searchParams.get("top") || "10", 10);
      const fechaIni = url.searchParams.get("fechaIni") || "";
      const fechaFin = url.searchParams.get("fechaFin") || "";
      if (!Number.isInteger(top) || top < 1 || top > 5000) return json({ error: "top debe estar entre 1 y 5000" }, 400, origen);
      if (!validaFecha(fechaIni)) return json({ error: "fechaIni obligatoria (YYYY-MM-DD)" }, 400, origen);
      if (!validaFecha(fechaFin)) return json({ error: "fechaFin obligatoria (YYYY-MM-DD)" }, 400, origen);

      const q = new URLSearchParams({ top: String(top), fechaIni, fechaFin });
      const resp = await fetch(PROAGRO + "/QrKgAra/ObtenerRankingVista?" + q.toString());
      const texto = await resp.text();
      return new Response(texto, { status: resp.status, headers: cabeceras(origen) });
    }

    return json({ error: "No encontrado. Rutas: /, /health, /api/cosecha, /api/ranking" }, 404, origen);
  },
};
