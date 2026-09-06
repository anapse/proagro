// Prueba E2E real contra el worker desplegado (producción)
const W = "https://proagro-api.elherreroanapse.workers.dev";
const api = async (path, opts = {}) => {
  const r = await fetch(W + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
};
const admin = (tok) => ({ Authorization: "Bearer " + tok });

let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + " — " + x); } };

// login admin
let r = await api("/api/admin/login", { method: "POST", body: { username: "anapse", password: "16546203" } });
const T = r.j.token;
check("login ADMIN producción", r.status === 200 && !!T, r.status);

// agregar supervisor de prueba
const nom = "Test E2E " + Date.now().toString().slice(-4);
r = await api("/api/admin/supervisors", { method: "POST", body: { nombre: nom, cargo: "Supervisor/a de prueba", activo: true }, headers: admin(T) });
check("agregar supervisor", r.status === 200 && !!r.j.id, r.status + " " + JSON.stringify(r.j));
const supId = r.j.id;

// aparece en la Comunidad pública (sin token)
r = await api("/api/community/supervisors");
check("supervisor visible en Comunidad pública", (r.j.supervisores || []).some((s) => s.nombre === nom));

// editar supervisor
r = await api("/api/admin/supervisors/" + supId, { method: "PUT", body: { cargo: "Supervisor/a actualizado" }, headers: admin(T) });
check("editar supervisor", r.status === 200, r.status);

// crear moderador de prueba
const mnom = "mod" + Date.now().toString().slice(-4);
r = await api("/api/admin/users", { method: "POST", body: { username: mnom, password: "clave123456", display_name: "Moderador E2E", role_level: 2, active: true }, headers: admin(T) });
check("crear MODERADOR", r.status === 200, r.status + " " + JSON.stringify(r.j));

// moderador login
r = await api("/api/admin/login", { method: "POST", body: { username: mnom, password: "clave123456" } });
check("MODERADOR login", r.status === 200 && !!r.j.token, r.status);
const TM = r.j.token;

// moderador NO puede ver usuarios (403)
r = await api("/api/admin/users", { headers: admin(TM) });
check("MODERADOR no ve /users (403)", r.status === 403, String(r.status));

// moderador SÍ puede moderar (ver comentarios)
r = await api("/api/admin/comments", { headers: admin(TM) });
check("MODERADOR ve comentarios", r.status === 200, String(r.status));

// limpieza: desactivar supervisor y moderador de prueba
r = await api("/api/admin/supervisors/" + supId, { method: "DELETE", headers: admin(T) });
check("limpiar supervisor de prueba", r.status === 200, String(r.status));
r = await api("/api/admin/users", { headers: admin(T) });
const mu = (r.j.usuarios || []).find((u) => u.username === mnom);
if (mu) await api("/api/admin/users/" + mu.id, { method: "DELETE", headers: admin(T) });
check("limpiar moderador de prueba", !!mu);

// logout
r = await api("/api/admin/logout", { method: "POST", headers: admin(T) });
check("logout", r.status === 200, String(r.status));
r = await api("/api/admin/me", { headers: admin(T) });
check("token revocado tras logout (401)", r.status === 401, String(r.status));

console.log("\n== PRODUCCIÓN: " + pass + " OK · " + fail + " FALLOS ==");
process.exit(fail ? 1 : 0);
