/* ============================================================
 * PROAGRO ADMIN — panel privado (/admin)
 * App estática (GitHub Pages) + Worker (proagro-api) + D1.
 * El token de sesión vive en sessionStorage (nunca localStorage)
 * y se valida en el Worker en cada petición.
 * ============================================================ */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function esc(x) {
  return String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const BASE = () => (localStorage.getItem("pwf_worker") || "").trim()
  || "https://proagro-api.elherreroanapse.workers.dev";

let TOKEN = sessionStorage.getItem("proagro_admin_token") || "";
let USER = null; // {id, username, display_name, role_level, rol, must_change_password}

const ROL_ICONO = { 1: "👑", 2: "🛡️", 3: "✏️", 4: "👁️" };
const ROL_NOMBRE = { 1: "ADMIN", 2: "MODERADOR", 3: "EDITOR", 4: "CONSULTA" };
const ROL_TXT = { 1: "ADMIN — Nivel 1", 2: "MODERADOR — Nivel 2", 3: "EDITOR — Nivel 3", 4: "CONSULTA — Nivel 4" };

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const r = await fetch(BASE() + path, { ...opts, headers });
  let j = null;
  try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (r.status === 401 && path !== "/api/admin/login") {
    cerrarSesion(false);
    throw new Error("La sesión expiró. Ingresa de nuevo.");
  }
  if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
  return j;
}
function guardarToken(t) { TOKEN = t; sessionStorage.setItem("proagro_admin_token", t); }

// ---------- Vistas ----------
function mostrar(id) {
  ["loginView", "chgView", "panelView"].forEach((v) => {
    const el = $("#" + v);
    if (el) el.classList.toggle("hidden2", v !== id);
  });
}

// ---------- LOGIN ----------
async function login() {
  const id = ($("#admId").value || "").trim();
  const pass = $("#admPass").value || "";
  const msg = $("#admLoginMsg");
  const btn = $("#btnLogin");
  if (!id || !pass) { msg.textContent = "Escribe tu ID y contraseña."; msg.style.color = "var(--warn)"; return; }
  btn.disabled = true;
  msg.textContent = "⏳ Verificando…"; msg.style.color = "var(--muted)";
  try {
    const j = await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "" }, // sin token previo
      body: JSON.stringify({ username: id, password: pass }),
    });
    // quitar el header Authorization vacío que podría colarse
    guardarToken(j.token);
    USER = j.user;
    if (USER.must_change_password) {
      $("#chgUser").textContent = USER.username;
      mostrar("chgView");
    } else {
      entrarPanel();
    }
  } catch (e) {
    msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)";
    btn.disabled = false;
  }
}

// ---------- CAMBIO DE CONTRASEÑA (1er ingreso u opcional) ----------
async function cambiarPassword(obligatorio) {
  const msg = $("#chgMsg");
  const p1 = $("#chgPass1").value || "";
  const p2 = $("#chgPass2").value || "";
  if (p1.length < 6) { msg.textContent = "Mínimo 6 caracteres."; msg.style.color = "var(--warn)"; return; }
  if (p1 !== p2) { msg.textContent = "Las contraseñas no coinciden."; msg.style.color = "var(--warn)"; return; }
  const btn = $("#btnChg");
  btn.disabled = true;
  msg.textContent = "⏳ Guardando…"; msg.style.color = "var(--muted)";
  try {
    await api("/api/admin/me/password", {
      method: "PUT",
      body: JSON.stringify({ actual: "", nueva: p1 }),
    });
    USER.must_change_password = false;
    $("#chgPass1").value = ""; $("#chgPass2").value = "";
    if (obligatorio) entrarPanel();
    else { msg.textContent = "✅ Contraseña actualizada."; msg.style.color = "var(--accent)"; }
  } catch (e) {
    msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)";
  }
  btn.disabled = false;
}

// ---------- ENTRAR AL PANEL ----------
const SECCIONES = [
  { id: "dashboard", icono: "📊", nombre: "Dashboard", min: 4 },
  { id: "supervisores", icono: "👷", nombre: "Supervisores", min: 4 },
  { id: "publicaciones", icono: "📰", nombre: "Publicaciones", min: 3 },
  { id: "encuestas", icono: "📊", nombre: "Encuestas", min: 2 },
  { id: "comentarios", icono: "💬", nombre: "Comentarios", min: 2 },
  { id: "usuarios", icono: "👥", nombre: "Usuarios", min: 1 },
  { id: "estadisticas", icono: "📈", nombre: "Estadísticas", min: 4 },
  { id: "config", icono: "⚙️", nombre: "Configuración", min: 1 },
];
let SEC_ACTUAL = "dashboard";

function entrarPanel() {
  mostrar("panelView");
  $("#hdrUser").textContent = USER.display_name || USER.username;
  $("#hdrRol").textContent = (ROL_ICONO[USER.role_level] || "") + " " + ROL_TXT[USER.role_level];
  pintarMenu();
  irSeccion("dashboard");
}
function pintarMenu() {
  const nav = $("#admMenu");
  nav.innerHTML = SECCIONES
    .filter((s) => USER.role_level <= s.min || s.min === 4)
    .map((s) => `<button class="btn ${s.id === SEC_ACTUAL ? "on" : ""}" data-sec="${s.id}">${s.icono} ${s.nombre}</button>`)
    .join("");
  $$("#admMenu button").forEach((b) => { b.onclick = () => irSeccion(b.dataset.sec); });
}
function irSeccion(id) {
  SEC_ACTUAL = id;
  $$("#admMenu button").forEach((b) => b.classList.toggle("on", b.dataset.sec === id));
  const sec = $("#admSec");
  sec.innerHTML = '<p class="muted">Cargando…</p>';
  const cargadores = {
    dashboard: verDashboard, supervisores: verSupervisores, publicaciones: verPublicaciones,
    encuestas: verEncuestas, comentarios: verComentarios, usuarios: verUsuarios,
    estadisticas: verEstadisticas, config: verConfig,
  };
  (cargadores[id] || verDashboard)(sec).catch((e) => { sec.innerHTML = `<p class="muted">❌ ${esc(e.message)}</p>`; });
}

function cerrarSesion(aviso = true) {
  if (TOKEN) api("/api/admin/logout", { method: "POST" }).catch(() => {});
  TOKEN = ""; USER = null;
  sessionStorage.removeItem("proagro_admin_token");
  if (aviso) alert("Sesión cerrada.");
  $("#admId").value = ""; $("#admPass").value = "";
  mostrar("loginView");
}

// ============================================================
//  DASHBOARD
// ============================================================
async function verDashboard(sec) {
  const stats = (await api("/api/admin/stats")).stats;
  const kpi = (n, l) => `<div class="kpi"><div class="num">${n}</div><div class="lbl">${l}</div></div>`;
  sec.innerHTML = `<h2>📊 DASHBOARD</h2>
    <div class="grid4">
      ${kpi(stats.supervisores.activos, "Supervisores activos")}
      ${kpi(stats.publicaciones.activas, "Publicaciones activas")}
      ${kpi(stats.encuestas.activas, "Encuestas activas")}
      ${kpi(stats.comentarios_mod.visibles, "Comentarios visibles")}
    </div>
    <div class="grid4">
      ${kpi(stats.supervisores.likes, "👍 Likes")}
      ${kpi(stats.supervisores.dislikes, "👎 Dislikes")}
      ${kpi(stats.visitas.hoy, "Visitas hoy")}
      ${kpi(stats.visitas.historico, "Visitas históricas")}
    </div>
    <p class="small muted">Bienvenido/a, <b>${esc(USER.display_name || USER.username)}</b>. Usa el menú para administrar la Comunidad.</p>`;
}

// ============================================================
//  SUPERVISORES
// ============================================================
async function verSupervisores(sec) {
  if (USER.role_level > 1) { sec.innerHTML = '<p class="muted">Solo lectura (tu rol no puede modificar supervisores).</p>'; }
  const j = await api("/api/admin/supervisors");
  const filas = (j.supervisores || []).map((s) => `<tr>
    <td><b>${esc(s.nombre)}</b></td><td>${esc(s.cargo || "Supervisor/a")}</td>
    <td>${s.activo ? '<span class="chip" style="color:#4ade80">activo</span>' : '<span class="chip" style="color:var(--muted)">inactivo</span>'}</td>
    <td class="num">${s.likes || 0}</td><td class="num">${s.dislikes || 0}</td><td class="num">${s.comentarios || 0}</td>
    <td style="white-space:nowrap">${USER.role_level <= 1 ? `
      <button class="btn small" onclick="ADM.editarSup(${s.id}, ${JSON.stringify(esc(s.nombre))}, ${JSON.stringify(esc(s.cargo || "Supervisor/a"))}, ${s.activo})">✏️</button>
      <button class="btn small" onclick="ADM.toggleSup(${s.id}, ${s.activo ? "false" : "true"})">${s.activo ? "⏸" : "▶️"}</button>` : ""}
    </td></tr>`).join("");
  sec.innerHTML = `<h2>👷 SUPERVISORES</h2>
    ${USER.role_level <= 1 ? `<div class="cardbox"><h3>＋ Agregar supervisor</h3>
      <div class="grid2">
        <div><label>Nombre</label><input id="admSupNombre" class="inp" style="width:100%" maxlength="80" placeholder="Ej. Juan"></div>
        <div><label>Cargo</label><input id="admSupCargo" class="inp" style="width:100%" maxlength="80" placeholder="Ej. Supervisor"></div>
      </div>
      <button class="btn primary" id="admSupAdd" style="margin-top:8px">＋ AGREGAR SUPERVISOR</button>
      <div id="admSupMsg" class="small"></div></div>` : ""}
    <div class="cardbox"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>Supervisor</th><th>Cargo</th><th>Estado</th><th class="num">Likes</th><th class="num">Dislikes</th><th class="num">Comentarios</th><th>Acciones</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="7" class="muted">Sin supervisores</td></tr>'}</tbody></table></div></div>`;
  const add = $("#admSupAdd");
  if (add) add.onclick = async () => {
    const msg = $("#admSupMsg");
    const nombre = ($("#admSupNombre").value || "").trim();
    const cargo = ($("#admSupCargo").value || "").trim() || "Supervisor/a";
    if (!nombre) { msg.textContent = "El nombre es obligatorio."; msg.style.color = "var(--warn)"; return; }
    try {
      await api("/api/admin/supervisors", { method: "POST", body: JSON.stringify({ nombre, cargo, activo: true }) });
      irSeccion("supervisores");
    } catch (e) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
  };
}

// ============================================================
//  PUBLICACIONES — crear, editar (✏️), ocultar/publicar
// ============================================================
let postEditando = null; // id de la publicación en edición (null = crear)
let postsCache = {};     // id -> publicación (para editar sin otra petición)

async function verPublicaciones(sec) {
  const j = await api("/api/admin/posts");
  postsCache = {};
  (j.posts || []).forEach((p) => { postsCache[p.id] = p; });
  const puedeEscribir = USER.role_level <= 3;
  const puedeOcultar = USER.role_level <= 2;
  const filas = (j.posts || []).map((p) => `<tr>
    <td><span class="chip">${p.type === "noticia" ? "📰" : p.type === "horario" ? "📅" : "📢"} ${esc(p.type)}</span></td>
    <td><b>${esc(p.title)}</b></td>
    <td>${p.status === "activo" ? '<span class="chip" style="color:#4ade80">activo</span>' : '<span class="chip" style="color:var(--muted)">' + esc(p.status) + '</span>'}</td>
    <td class="small muted">${esc((p.created_at || "").slice(0, 16))}</td>
    <td style="white-space:nowrap">
      ${puedeEscribir ? `<button class="btn small" onclick="ADM.editarPost(${p.id})" title="Editar">✏️ Editar</button>` : ""}
      ${puedeOcultar ? `<button class="btn small warn" onclick="ADM.togglePost(${p.id}, '${p.status}')">${p.status === "activo" ? "Ocultar" : "Publicar"}</button>` : ""}
    </td></tr>`).join("");
  const tipos = `<option value="aviso">📢 Aviso oficial</option><option value="noticia">📰 Noticia</option><option value="comunicado">📢 Comunicado</option><option value="horario">📅 Cambio de horario</option>`;
  sec.innerHTML = `<h2>📰 PUBLICACIONES</h2>
    ${puedeEscribir ? `<div class="cardbox"><h3 id="admPostH3">＋ Nueva publicación</h3>
      <div class="grid2">
        <div><label>Tipo</label><select id="admPostTipo" class="inp" style="width:100%">${tipos}</select></div>
        <div><label>Categoría (opcional)</label><input id="admPostCat" class="inp" style="width:100%" maxlength="40" placeholder="Ej. Horario"></div>
      </div>
      <label>Título</label><input id="admPostTitulo" class="inp" style="width:100%" maxlength="150" placeholder="Título">
      <label>Contenido</label><textarea id="admPostTexto" class="inp" style="width:100%" rows="3" maxlength="2000" placeholder="Redacta…"></textarea>
      <p class="small muted">Imagen: disponible cuando R2 esté configurado (no rompe nada mientras tanto).</p>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="admPostPub" style="margin-top:8px">📤 PUBLICAR</button>
        <button class="btn ghost" id="admPostCancelar" style="margin-top:8px;display:none">Cancelar edición</button>
      </div>
      <div id="admPostMsg" class="small"></div></div>` : ""}
    <div class="cardbox"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>Tipo</th><th>Título</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="5" class="muted">Sin publicaciones</td></tr>'}</tbody></table></div></div>`;
  const pub = $("#admPostPub");
  const cancelar = $("#admPostCancelar");
  if (pub) pub.onclick = async () => {
    const msg = $("#admPostMsg");
    const title = ($("#admPostTitulo").value || "").trim();
    const content = ($("#admPostTexto").value || "").trim();
    if (!title || !content) { msg.textContent = "Título y contenido obligatorios."; msg.style.color = "var(--warn)"; return; }
    pub.disabled = true;
    try {
      if (postEditando) {
        // editar publicación existente (PUT)
        await api("/api/admin/posts/" + postEditando, {
          method: "PUT",
          body: JSON.stringify({
            type: $("#admPostTipo").value,
            category: $("#admPostCat").value.trim(),
            title, content,
          }),
        });
        postEditando = null;
      } else {
        // crear publicación nueva (POST)
        await api("/api/admin/posts", {
          method: "POST",
          body: JSON.stringify({
            type: $("#admPostTipo").value, category: $("#admPostCat").value.trim(),
            title, content, author: USER.display_name || USER.username,
          }),
        });
      }
      irSeccion("publicaciones");
    } catch (e) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; pub.disabled = false; }
  };
  if (cancelar) cancelar.onclick = () => {
    postEditando = null;
    cancelar.style.display = "none";
    $("#admPostH3").textContent = "＋ Nueva publicación";
    $("#admPostPub").textContent = "📤 PUBLICAR";
    $("#admPostTitulo").value = "";
    $("#admPostTexto").value = "";
    $("#admPostCat").value = "";
    $("#admPostTipo").value = "aviso";
    const msg = $("#admPostMsg"); if (msg) { msg.textContent = ""; }
  };
}

// ============================================================
//  ENCUESTAS
// ============================================================
async function verEncuestas(sec) {
  const puedeEscribir = USER.role_level <= 2;
  const j = await api("/api/admin/surveys");
  const lista = (j.encuestas || []).map((e) => {
    const total = e.total_votos || 0;
    const opts = (e.opciones || []).map((o) => {
      const pct = total > 0 ? Math.round((o.votos / total) * 100) : 0;
      return `<div class="cm-surv-res"><div class="cm-surv-lbl">${esc(o.option_text)} <b class="num">${o.votos} · ${pct}%</b></div>
        <div class="bar-h"><div style="width:${pct}%"></div></div></div>`;
    }).join("");
    return `<div class="cardbox cm-surv"><h3 style="text-transform:none">📊 ${esc(e.question)}</h3>
      <p class="small muted">${total} voto(s) · estado: ${e.status === "activa" ? "activa" : "cerrada"}</p>${opts}
      ${puedeEscribir ? `<button class="btn small" onclick="ADM.toggleSurvey(${e.id}, '${e.status}')" style="margin-top:8px">${e.status === "activa" ? "🔒 Cerrar" : "🔓 Abrir"}</button>` : ""}</div>`;
  }).join("");
  sec.innerHTML = `<h2>📊 ENCUESTAS</h2>
    ${puedeEscribir ? `<div class="cardbox"><h3>＋ Crear encuesta</h3>
      <label>Pregunta</label><input id="admSurvQ" class="inp" style="width:100%" maxlength="300" placeholder="¿Qué horario prefieres?">
      <label>Opciones (una por línea, mínimo 2)</label>
      <textarea id="admSurvOpts" class="inp" style="width:100%" rows="4" placeholder="6:00 AM - 2:00 PM&#10;7:00 AM - 3:00 PM&#10;8:00 AM - 4:00 PM"></textarea>
      <button class="btn primary" id="admSurvAdd" style="margin-top:8px">＋ CREAR ENCUESTA</button>
      <div id="admSurvMsg" class="small"></div></div>` : ""}
    ${lista || '<div class="cardbox"><p class="muted">Sin encuestas todavía.</p></div>'}`;
  const add = $("#admSurvAdd");
  if (add) add.onclick = async () => {
    const msg = $("#admSurvMsg");
    const q = ($("#admSurvQ").value || "").trim();
    const options = ($("#admSurvOpts").value || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!q || options.length < 2) { msg.textContent = "Pregunta + al menos 2 opciones."; msg.style.color = "var(--warn)"; return; }
    try {
      await api("/api/admin/surveys", { method: "POST", body: JSON.stringify({ question: q, options }) });
      irSeccion("encuestas");
    } catch (e) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
  };
}

// ============================================================
//  COMENTARIOS (moderación)
// ============================================================
async function verComentarios(sec) {
  if (USER.role_level > 2) { sec.innerHTML = '<p class="muted">Tu rol no puede moderar comentarios.</p>'; return; }
  const j = await api("/api/admin/comments");
  const filas = (j.comentarios || []).map((c) => `<tr>
    <td class="small muted">${esc((c.created_at || "").slice(0, 16))}</td>
    <td class="small">${c.supervisor_id ? "👷 " + esc(c.supervisor_nombre || ("#" + c.supervisor_id)) : c.post_id ? "📰 post #" + c.post_id : "—"}</td>
    <td>${esc((c.content || "").slice(0, 90))}</td>
    <td>${c.status === "visible" ? '<span class="chip" style="color:#4ade80">visible</span>' : '<span class="chip" style="color:var(--muted)">' + esc(c.status) + '</span>'}</td>
    <td style="white-space:nowrap">
      ${c.status === "visible"
        ? `<button class="btn small warn" onclick="ADM.setCom(${c.id}, 'hidden')">🙈 Ocultar</button>`
        : `<button class="btn small" onclick="ADM.setCom(${c.id}, 'visible')">👁️ Mostrar</button>`}
      <button class="btn small warn" onclick="ADM.setCom(${c.id}, 'deleted')">🗑</button>
    </td></tr>`).join("");
  sec.innerHTML = `<h2>💬 MODERACIÓN DE COMENTARIOS</h2>
    <div class="cardbox"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>Fecha</th><th>En</th><th>Comentario</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="5" class="muted">Sin comentarios</td></tr>'}</tbody></table></div></div>`;
}

// ============================================================
//  USUARIOS (solo ADMIN)
// ============================================================
async function verUsuarios(sec) {
  if (USER.role_level > 1) { sec.innerHTML = '<p class="muted">Solo el ADMIN administra usuarios.</p>'; return; }
  const j = await api("/api/admin/users");
  const filas = (j.usuarios || []).map((u) => `<tr>
    <td><b>${esc(u.username)}</b></td>
    <td>${esc(u.display_name || "—")}</td>
    <td>${(ROL_ICONO[u.role_level] || "")} ${esc(u.rol || "")} <span class="small muted">Nivel ${u.role_level}</span></td>
    <td>${u.active ? '<span class="chip" style="color:#4ade80">Activo</span>' : '<span class="chip" style="color:var(--muted)">Inactivo</span>'}</td>
    <td style="white-space:nowrap">
      <button class="btn small" onclick="ADM.editarUser(${u.id}, '${u.username}', '${esc(u.display_name || "")}', ${u.role_level}, ${u.active})">✏️</button>
      ${u.username !== USER.username ? `<button class="btn small warn" onclick="ADM.toggleUser(${u.id}, ${u.active ? "false" : "true"})">${u.active ? "⏸" : "▶️"}</button>
      <button class="btn small warn" onclick="ADM.resetPass(${u.id})">🔑</button>` : ""}
    </td></tr>`).join("");
  sec.innerHTML = `<h2>👥 USUARIOS ADMINISTRATIVOS</h2>
    <div class="cardbox"><h3>＋ Agregar usuario</h3>
      <div class="grid2">
        <div><label>Nombre</label><input id="admUserNom" class="inp" style="width:100%" maxlength="80" placeholder="Ej. Carlos"></div>
        <div><label>ID de acceso</label><input id="admUserId" class="inp" style="width:100%" maxlength="40" placeholder="Ej. carlos"></div>
        <div><label>Contraseña</label><input id="admUserPass" type="text" class="inp" style="width:100%" maxlength="128" placeholder="Mínimo 6 caracteres"></div>
        <div><label>Nivel</label><select id="admUserRol" class="inp" style="width:100%">
          <option value="2">🛡️ 2 - MODERADOR</option><option value="3">✏️ 3 - EDITOR</option>
          <option value="4">👁️ 4 - CONSULTA</option><option value="1">👑 1 - ADMIN</option></select></div>
      </div>
      <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="admUserAct" checked> Activo</label>
      <button class="btn primary" id="admUserAdd" style="margin-top:8px">＋ CREAR USUARIO</button>
      <div id="admUserMsg" class="small"></div></div>
    <div class="cardbox"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>ID</th><th>Nombre</th><th>Nivel</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;
  const add = $("#admUserAdd");
  if (add) add.onclick = async () => {
    const msg = $("#admUserMsg");
    const username = ($("#admUserId").value || "").trim();
    const password = $("#admUserPass").value || "";
    const display_name = ($("#admUserNom").value || "").trim();
    if (!username || username.length < 3) { msg.textContent = "ID de acceso: mínimo 3 caracteres."; msg.style.color = "var(--warn)"; return; }
    if (password.length < 6) { msg.textContent = "Contraseña: mínimo 6 caracteres."; msg.style.color = "var(--warn)"; return; }
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, password, display_name, role_level: Number($("#admUserRol").value), active: $("#admUserAct").checked }),
      });
      irSeccion("usuarios");
    } catch (e) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
  };
}

// ============================================================
//  ESTADÍSTICAS
// ============================================================
async function verEstadisticas(sec) {
  const j = await api("/api/admin/stats");
  const s = j.stats;
  const bar = (n, max) => { const pct = max > 0 ? Math.round((n / max) * 100) : 0; return `<div class="bar-h"><div style="width:${pct}%"></div></div><span class="small muted">${n}</span>`; };
  const mxVis = Math.max(s.visitas.historico, 1);
  const mxSup = Math.max(s.supervisores.likes + s.supervisores.dislikes, 1);
  const mxEnc = Math.max(s.encuestas.votos, 1);
  const mxPub = Math.max(s.publicaciones.total, 1);
  const mxCom = Math.max(s.comentarios_mod.total, 1);
  sec.innerHTML = `<h2>📈 ESTADÍSTICAS</h2>
    <div class="cardbox"><h3>📊 VISITAS</h3>
      <div class="grid4">
        <div class="kpi"><div class="num">${s.visitas.hoy}</div><div class="lbl">Hoy</div></div>
        <div class="kpi"><div class="num">${s.visitas.semana}</div><div class="lbl">Semana</div></div>
        <div class="kpi"><div class="num">${s.visitas.mes}</div><div class="lbl">Mes</div></div>
        <div class="kpi"><div class="num">${s.visitas.historico}</div><div class="lbl">Histórico</div></div>
      </div></div>
    <div class="cardbox"><h3>👷 SUPERVISORES</h3>
      <p>Total: <b>${s.supervisores.total}</b> · Activos: <b>${s.supervisores.activos}</b></p>
      <p class="small">👍 Likes (${s.supervisores.likes})</p>${bar(s.supervisores.likes, mxSup)}
      <p class="small">👎 Dislikes (${s.supervisores.dislikes})</p>${bar(s.supervisores.dislikes, mxSup)}
      <p class="small">💬 Comentarios: <b>${s.supervisores.comentarios}</b></p></div>
    <div class="cardbox"><h3>📊 ENCUESTAS</h3>
      <p>Total: <b>${s.encuestas.total}</b> · Activas: <b>${s.encuestas.activas}</b> · Votos (${s.encuestas.votos})</p>
      ${bar(s.encuestas.votos, mxEnc)}</div>
    <div class="cardbox"><h3>📰 PUBLICACIONES</h3>
      <p>Total: <b>${s.publicaciones.total}</b> · Activas: <b>${s.publicaciones.activas}</b> · Noticias: <b>${s.publicaciones.noticias}</b> · Avisos: <b>${s.publicaciones.avisos}</b></p>
      ${bar(s.publicaciones.activas, mxPub)}</div>
    <div class="cardbox"><h3>💬 COMENTARIOS</h3>
      <p>Total: <b>${s.comentarios_mod.total}</b> · Visibles: <b>${s.comentarios_mod.visibles}</b> · Moderados/ocultos: <b>${s.comentarios_mod.moderados}</b></p>
      ${bar(s.comentarios_mod.visibles, mxCom)}</div>`;
}

// ============================================================
//  CONFIGURACIÓN (solo ADMIN)
// ============================================================
function verConfig(sec) {
  sec.innerHTML = `<h2>⚙️ CONFIGURACIÓN</h2>
    <div class="cardbox"><h3>🔑 Cambiar mi contraseña</h3>
      <label>Contraseña actual</label><input id="cfgPass0" type="password" class="inp" style="width:100%" maxlength="128" autocomplete="current-password">
      <label>Contraseña nueva</label><input id="cfgPass1" type="password" class="inp" style="width:100%" maxlength="128" autocomplete="new-password">
      <label>Repite la contraseña nueva</label><input id="cfgPass2" type="password" class="inp" style="width:100%" maxlength="128" autocomplete="new-password">
      <div id="cfgMsg" class="small"></div>
      <button class="btn primary" id="cfgBtn" style="margin-top:8px">💾 CAMBIAR CONTRASEÑA</button></div>
    <div class="cardbox"><h3>ℹ️ Información</h3>
      <p class="small muted">Worker: <span class="mono">${esc(BASE())}</span></p>
      <p class="small muted">Base de datos: <b>proagro-comunidad</b> (binding DB) — única fuente de verdad.</p>
      <p class="small muted">Sesión válida por 8 horas. Al cerrar sesión el token se revoca en el Worker.</p></div>`;
  const btn = $("#cfgBtn");
  if (btn) btn.onclick = async () => {
    const msg = $("#cfgMsg");
    const p0 = $("#cfgPass0").value || "", p1 = $("#cfgPass1").value || "", p2 = $("#cfgPass2").value || "";
    if (p1.length < 6) { msg.textContent = "Mínimo 6 caracteres."; msg.style.color = "var(--warn)"; return; }
    if (p1 !== p2) { msg.textContent = "Las contraseñas nuevas no coinciden."; msg.style.color = "var(--warn)"; return; }
    btn.disabled = true;
    try {
      await api("/api/admin/me/password", { method: "PUT", body: JSON.stringify({ actual: p0, nueva: p1 }) });
      msg.textContent = "✅ Contraseña actualizada."; msg.style.color = "var(--accent)";
      $("#cfgPass0").value = ""; $("#cfgPass1").value = ""; $("#cfgPass2").value = "";
    } catch (e) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
    btn.disabled = false;
  };
}

// ---------- acciones globales para onclick inline ----------
window.ADM = {
  editarSup(id, nombre, cargo, activo) {
    const nombreN = prompt("Nombre del supervisor:", nombre);
    if (nombreN === null) return;
    const cargoN = prompt("Cargo:", cargo);
    if (cargoN === null) return;
    api("/api/admin/supervisors/" + id, {
      method: "PUT",
      body: JSON.stringify({ nombre: nombreN.trim(), cargo: cargoN.trim(), activo }),
    }).then(() => irSeccion("supervisores")).catch((e) => alert("❌ " + e.message));
  },
  toggleSup(id, activo) {
    api("/api/admin/supervisors/" + id, { method: "PUT", body: JSON.stringify({ activo }) })
      .then(() => irSeccion("supervisores")).catch((e) => alert("❌ " + e.message));
  },
  togglePost(id, status) {
    api("/api/admin/posts/" + id, { method: "PUT", body: JSON.stringify({ status: status === "activo" ? "inactivo" : "activo" }) })
      .then(() => irSeccion("publicaciones")).catch((e) => alert("❌ " + e.message));
  },
  editarPost(id) {
    const p = postsCache[id];
    if (!p) { alert("No se pudo cargar la publicación."); return; }
    postEditando = id;
    const h3 = $("#admPostH3"), pub = $("#admPostPub"), can = $("#admPostCancelar");
    if (h3) h3.textContent = "✏️ Editando publicación #" + id;
    if (pub) pub.textContent = "💾 GUARDAR CAMBIOS";
    if (can) can.style.display = "";
    const tipo = $("#admPostTipo"), cat = $("#admPostCat"), tit = $("#admPostTitulo"), txt = $("#admPostTexto"), msg = $("#admPostMsg");
    if (tipo) tipo.value = ["noticia", "aviso", "comunicado", "horario"].includes(p.type) ? p.type : "aviso";
    if (cat) cat.value = p.category || "";
    if (tit) tit.value = p.title || "";
    if (txt) txt.value = p.content || "";
    if (msg) { msg.textContent = "Editando. Cambia lo que necesites y pulsa GUARDAR CAMBIOS."; msg.style.color = "var(--accent)"; }
    // subir hasta el formulario
    const f = document.querySelector("#admPostH3");
    if (f) f.scrollIntoView({ behavior: "smooth", block: "center" });
  },
  toggleSurvey(id, status) {
    api("/api/admin/surveys/" + id, { method: "PUT", body: JSON.stringify({ status: status === "activa" ? "cerrada" : "activa" }) })
      .then(() => irSeccion("encuestas")).catch((e) => alert("❌ " + e.message));
  },
  setCom(id, status) {
    if (status === "deleted" && !confirm("¿Marcar como eliminado?")) return;
    api("/api/admin/comments/" + id, { method: status === "deleted" ? "DELETE" : "PUT", body: JSON.stringify({ status }) })
      .then(() => irSeccion("comentarios")).catch((e) => alert("❌ " + e.message));
  },
  editarUser(id, username, display_name, role_level, active) {
    const nombreN = prompt("Nombre:", display_name || username);
    if (nombreN === null) return;
    const rolS = prompt("Nivel (1 ADMIN · 2 MODERADOR · 3 EDITOR · 4 CONSULTA):", String(role_level));
    if (rolS === null) return;
    const rl = Number(rolS);
    if (![1, 2, 3, 4].includes(rl)) { alert("Nivel inválido."); return; }
    api("/api/admin/users/" + id, { method: "PUT", body: JSON.stringify({ display_name: nombreN.trim(), role_level: rl, active }) })
      .then(() => irSeccion("usuarios")).catch((e) => alert("❌ " + e.message));
  },
  toggleUser(id, active) {
    api("/api/admin/users/" + id, { method: "PUT", body: JSON.stringify({ active }) })
      .then(() => irSeccion("usuarios")).catch((e) => alert("❌ " + e.message));
  },
  resetPass(id) {
    const p = prompt("Nueva contraseña para este usuario (mínimo 6):");
    if (!p || p.length < 6) { alert("Contraseña demasiado corta."); return; }
    api("/api/admin/users/" + id + "/reset-password", { method: "POST", body: JSON.stringify({ password: p }) })
      .then(() => alert("✅ Contraseña restablecida. El usuario deberá cambiarla en su primer ingreso."))
      .catch((e) => alert("❌ " + e.message));
  },
};

// ---------- eventos ----------
$("#btnLogin").onclick = () => login();
$("#btnChg").onclick = () => cambiarPassword(true);
$("#btnLogout").onclick = () => cerrarSesion();
$("#admPass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#admId").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#chgPass2").addEventListener("keydown", (e) => { if (e.key === "Enter") cambiarPassword(true); });

// ---------- arranque: sesión previa válida ----------
(async () => {
  if (!TOKEN) { mostrar("loginView"); return; }
  try {
    const j = await api("/api/admin/me");
    USER = j.user;
    if (USER.must_change_password) {
      $("#chgUser").textContent = USER.username;
      mostrar("chgView");
    } else {
      entrarPanel();
    }
  } catch (e) {
    mostrar("loginView");
  }
})();
