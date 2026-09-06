// ============================================================
// Arnés de pruebas del panel ADMIN (local, sin red)
// Carga cloudflare/worker.js real + migraciones 0001-0004 sobre
// SQLite en memoria y ejercita la checklist de aceptación.
// ============================================================
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(":memory:");
for (const f of ["0001_community.sql", "0002_seed_supervisores.sql", "0003_admin.sql", "0004_seed_admin.sql"]) {
  db.exec(readFileSync(join(here, "cloudflare", "migrations", f), "utf8"));
}

// ---- adaptador D1 sobre node:sqlite ----
const DB = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      bind(...args) {
        return {
          async all() { const rows = stmt.all(...args); return { results: rows }; },
          async first() { return stmt.get(...args) || null; },
          async run() {
            const info = stmt.run(...args);
            return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
          },
        };
      },
      async all() { const rows = stmt.all(); return { results: rows }; },
      async first() { return stmt.get() || null; },
      async run() { const info = stmt.run(); return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } }; },
    };
  },
};

const mod = await import("./cloudflare/worker.js");
const worker = mod.default;
const ENV = { DB };
const ORIGIN = "https://anapse.github.io";

let pass = 0, fail = 0;
function check(nombre, cond, extra = "") {
  if (cond) { pass++; console.log("  ✅ " + nombre); }
  else { fail++; console.log("  ❌ " + nombre + (extra ? " — " + extra : "")); }
}
async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN };
  if (token) headers["Authorization"] = "Bearer " + token;
  const r = await worker.fetch(new Request("https://proagro-api.elherreroanapse.workers.dev" + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }), ENV);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}

console.log("== Checklist panel ADMIN ==");

// 2. ID incorrecto falla
let r = await req("POST", "/api/admin/login", { username: "noexiste", password: "123456" });
check("2. ID incorrecto -> 401", r.status === 401 && r.j.ok === false, r.status);

// 3. contraseña incorrecta falla
r = await req("POST", "/api/admin/login", { username: "anapse", password: "clave-mala" });
check("3. contraseña incorrecta -> 401", r.status === 401, r.status);

// 4. ADMIN puede entrar (contraseña inicial 16546203)
r = await req("POST", "/api/admin/login", { username: "anapse", password: "16546203" });
check("4. login anapse OK -> 200 + token", r.status === 200 && !!r.j.token, r.status);
check("4b. respuesta NO contiene password_hash", !JSON.stringify(r.j).includes("password_hash") && !JSON.stringify(r.j).includes("16546203"));
const T = r.j.token;
check("4c. must_change_password = true (1er ingreso)", r.j.user.must_change_password === true);

// me
r = await req("GET", "/api/admin/me", null, T);
check("4d. /me devuelve ADMIN nivel 1", r.status === 200 && r.j.user.role_level === 1 && r.j.user.rol === "ADMIN", JSON.stringify(r.j));

// sin token -> 401
r = await req("GET", "/api/admin/stats");
check("sin sesión -> 401", r.status === 401);

// 17. contraseñas nunca aparecen en respuestas
r = await req("GET", "/api/admin/users", null, T);
check("17. /users no expone password_hash", r.status === 200 && !JSON.stringify(r.j).includes("password_hash"));

// 6-8. ADMIN agrega supervisor -> aparece en D1 y en Comunidad pública
r = await req("POST", "/api/admin/supervisors", { nombre: "Juan Pérez", cargo: "Supervisor", activo: true }, T);
check("6. ADMIN agrega supervisor -> 200 id", r.status === 200 && !!r.j.id, r.status);
const supId = r.j.id;
r = await req("GET", "/api/admin/supervisors", null, T);
check("7. supervisor aparece en D1 (admin)", r.status === 200 && (r.j.supervisores || []).some((s) => s.nombre === "Juan Pérez"));
r = await req("GET", "/api/community/supervisors");
check("8. supervisor aparece en Comunidad pública", r.status === 200 && (r.j.supervisores || []).some((s) => s.nombre === "Juan Pérez"));

// 9. editar supervisor
r = await req("PUT", "/api/admin/supervisors/" + supId, { nombre: "Juan Pérez R.", cargo: "Supervisor de campo" }, T);
check("9. ADMIN edita supervisor -> 200", r.status === 200, r.status);

// 10. desactivarlo
r = await req("PUT", "/api/admin/supervisors/" + supId, { activo: false }, T);
check("10. ADMIN desactiva supervisor -> 200", r.status === 200);
r = await req("GET", "/api/community/supervisors");
check("10b. desactivado ya no sale en Comunidad pública", !(r.j.supervisores || []).some((s) => s.id === supId));
// reactivar para no dejar raro
await req("PUT", "/api/admin/supervisors/" + supId, { activo: true }, T);

// 11. crear usuario MODERADOR
r = await req("POST", "/api/admin/users", { username: "carlos", password: "clave123", display_name: "Carlos", role_level: 2, active: true }, T);
check("11. ADMIN crea MODERADOR -> 200", r.status === 200, r.status + " " + JSON.stringify(r.j));
const carlosId = r.j.id;

// 12. MODERADOR inicia sesión
r = await req("POST", "/api/admin/login", { username: "carlos", password: "clave123" });
check("12. MODERADOR entra -> 200", r.status === 200 && !!r.j.token, r.status);
const TC = r.j.token;

// 13. MODERADOR NO puede acciones de ADMIN
r = await req("GET", "/api/admin/users", null, TC);
check("13. MODERADOR no ve /users -> 403", r.status === 403, r.status);
r = await req("POST", "/api/admin/supervisors", { nombre: "X", cargo: "Y", activo: true }, TC);
check("13b. MODERADOR no crea supervisor -> 403", r.status === 403, r.status);
r = await req("DELETE", "/api/admin/users/" + carlosId, null, TC);
check("13c. MODERADOR no borra usuarios -> 403", r.status === 403, r.status);
// MODERADOR sí modera comentarios y crea publicaciones/encuestas
r = await req("POST", "/api/community/supervisors/1/comments", { voter_id: "voter_prueba_001", content: "Comentario de prueba para moderación" });
check("pre: comentario público creado", r.status === 200);
r = await req("GET", "/api/admin/comments", null, TC);
check("13d. MODERADOR ve comentarios -> 200", r.status === 200 && (r.j.comentarios || []).length >= 1, r.status);
const comId = (r.j.comentarios || [])[0].id;
r = await req("PUT", "/api/admin/comments/" + comId, { status: "hidden" }, TC);
check("13e. MODERADOR oculta comentario -> 200", r.status === 200, r.status);
r = await req("POST", "/api/admin/posts", { type: "aviso", category: "", title: "Aviso moderador", content: "Contenido del moderador" }, TC);
check("13f. MODERADOR crea publicación -> 200", r.status === 200, r.status);
r = await req("POST", "/api/admin/surveys", { question: "¿Prueba?", options: ["A", "B", "C"] }, TC);
check("13g. MODERADOR crea encuesta -> 200", r.status === 200, r.status);

// 15. EDITOR limitado
r = await req("POST", "/api/admin/users", { username: "ana", password: "clave123", display_name: "Ana", role_level: 3, active: true }, T);
const editorId = r.j.id;
r = await req("POST", "/api/admin/login", { username: "ana", password: "clave123" });
const TE = r.j.token;
r = await req("GET", "/api/admin/users", null, TE);
check("15. EDITOR no ve /users -> 403", r.status === 403, r.status);
r = await req("POST", "/api/admin/supervisors", { nombre: "X", cargo: "Y", activo: true }, TE);
check("15b. EDITOR no crea supervisor -> 403", r.status === 403, r.status);
r = await req("POST", "/api/admin/posts", { type: "noticia", category: "", title: "Nota editor", content: "Contenido editor" }, TE);
check("15c. EDITOR sí crea publicación -> 200", r.status === 200, r.status);
r = await req("GET", "/api/admin/comments", null, TE);
check("15d. EDITOR no modera comentarios -> 403", r.status === 403, r.status);

// 16. CONSULTA solo consulta
r = await req("POST", "/api/admin/users", { username: "rosa", password: "clave123", display_name: "Rosa", role_level: 4, active: true }, T);
r = await req("POST", "/api/admin/login", { username: "rosa", password: "clave123" });
const TR = r.j.token;
r = await req("GET", "/api/admin/stats", null, TR);
check("16. CONSULTA ve estadísticas -> 200", r.status === 200, r.status);
r = await req("POST", "/api/admin/posts", { type: "aviso", category: "", title: "X", content: "Y" }, TR);
check("16b. CONSULTA no publica -> 403", r.status === 403, r.status);
r = await req("POST", "/api/admin/supervisors", { nombre: "X", cargo: "Y", activo: true }, TR);
check("16c. CONSULTA no crea supervisor -> 403", r.status === 403, r.status);

// 14. ADMIN cambia roles (editor -> consulta)
r = await req("PUT", "/api/admin/users/" + editorId, { role_level: 4, active: true }, T);
check("14. ADMIN cambia rol de usuario -> 200", r.status === 200, r.status);
r = await req("GET", "/api/admin/users", null, T);
const u = (r.j.usuarios || []).find((x) => x.id === editorId);
check("14b. rol cambiado a 4 (CONSULTA)", u && u.role_level === 4, JSON.stringify(u));

// 1. /admin es frontend estático (no aplica en worker); login sin credenciales
r = await req("POST", "/api/admin/login", {});
check("1b. login vacío -> 401", r.status === 401, r.status);

// 5. ADMIN cierra sesión
r = await req("POST", "/api/admin/logout", null, T);
check("5. logout -> 200", r.status === 200, r.status);
r = await req("GET", "/api/admin/me", null, T);
check("5b. token revocado -> 401 tras logout", r.status === 401, r.status);

// limpieza de datos de prueba
await req("DELETE", "/api/admin/supervisors/" + supId, null, T);
await req("DELETE", "/api/admin/users/" + carlosId, null, T);
await req("DELETE", "/api/admin/users/" + editorId, null, T);
await req("DELETE", "/api/admin/users/" + (await req("GET", "/api/admin/users", null, T).then(x => { const u2 = (x.j.usuarios||[]).find(y => y.username === "rosa"); return u2 ? u2.id : 0; })), null, T);

console.log("\n== RESULTADO: " + pass + " OK · " + fail + " FALLOS ==");
process.exit(fail ? 1 : 0);
