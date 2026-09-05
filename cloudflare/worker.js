// PROAGRO WEB — Worker serverless mínimo (Cloudflare Workers)
// SOLO dos endpoints de lectura validados hacia PROAGRO. Sin proxy abierto.
// - POST /api/cosecha   -> ConsultarKgVista  {dni,fechaIni,fechaFin}
// - GET  /api/ranking   -> ObtenerRankingVista (top, fechaIni, fechaFin)
// Cualquier otra ruta/método/parámetro -> 404/405/400. Sin URLs arbitrarias.

const PROAGRO = "https://digital.proagro.pe";
const RUTAS = {
  cosecha: PROAGRO + "/QrKgAra/ConsultarKgVista",   // POST (solo lectura)
  ranking: PROAGRO + "/QrKgAra/ObtenerRankingVista", // GET  (solo lectura)
};
const ORIGENES_PERMITIDOS = [
  "https://anapse.github.io",
];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 31; // el front usa hoy/semana (<=7); margen de seguridad

function corsHeaders(origin) {
  const permitido = origin && (ORIGENES_PERMITIDOS.includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.github\.io$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (permitido) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function fechaValida(v) {
  if (typeof v !== "string" || !FECHA_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    // ---------- POST /api/cosecha ----------
    if (url.pathname === "/api/cosecha") {
      if (request.method !== "POST") return json({ error: "Solo POST" }, 405, origin);
      let body = {};
      try { body = await request.json(); } catch (e) { return json({ error: "JSON inválido" }, 400, origin); }
      const dni = String(body.dni || "");
      const ini = String(body.fechaIni || "");
      const fin = String(body.fechaFin || "");
      if (!/^\d{8}$/.test(dni)) return json({ error: "dni debe tener 8 dígitos" }, 400, origin);
      if (!fechaValida(ini) || !fechaValida(fin)) return json({ error: "fechaIni/fechaFin deben ser YYYY-MM-DD" }, 400, origin);
      const dias = (new Date(fin) - new Date(ini)) / 86400000;
      if (dias < 0 || dias > MAX_DIAS) return json({ error: "rango inválido (máx " + MAX_DIAS + " días)" }, 400, origin);
      const resp = await fetch(RUTAS.cosecha, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni, fechaIni: ini, fechaFin: fin }),
      });
      const texto = await resp.text();
      return new Response(texto, { status: resp.status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } });
    }

    // ---------- GET /api/ranking ----------
    if (url.pathname === "/api/ranking") {
      if (request.method !== "GET") return json({ error: "Solo GET" }, 405, origin);
      let top = parseInt(url.searchParams.get("top") || "10", 10);
      if (isNaN(top) || top < 1 || top > 5000) return json({ error: "top entre 1 y 5000" }, 400, origin);
      const ini = url.searchParams.get("fechaIni") || "";
      const fin = url.searchParams.get("fechaFin") || "";
      if (!fechaValida(ini) || !fechaValida(fin)) return json({ error: "fechaIni/fechaFin requeridas (YYYY-MM-DD)" }, 400, origin);
      const q = new URLSearchParams({ top: String(top), fechaIni: ini, fechaFin: fin });
      const resp = await fetch(RUTAS.ranking + "?" + q.toString(), { headers: { Accept: "application/json" } });
      const texto = await resp.text();
      return new Response(texto, { status: resp.status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } });
    }

    return json({ error: "No existe: usa /api/cosecha o /api/ranking" }, 404, origin);
  },
};
