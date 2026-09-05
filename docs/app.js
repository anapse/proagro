/* PROAGRO-WEB-FORENSICS — lógica del dashboard (vanilla JS) */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (n) => n == null ? "" : (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB"
  : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B");

const state = {
  projects: [], curProject: null, audits: [], curAudit: null,
  auditRunning: null, jsAnalysis: null,
};
let pollTimer = null;
let cfg = {};               // config real del servidor (puertos) vía /api/health
let staticMode = false;
const DEFAULT_WORKER = "https://proagro-api.elherreroanapse.workers.dev"; // 🌩️ Worker serverless (PROAGRO)
let workerUrl = "";
try { workerUrl = (localStorage.getItem("pwf_worker") || "").trim() || DEFAULT_WORKER; } catch (e) { workerUrl = DEFAULT_WORKER; }
let cacheNombres = {};
try { cacheNombres = JSON.parse(localStorage.getItem("pwf_nombres") || "{}") || {}; } catch (e) { }
function nombreDeDni(dni) { return (dni && cacheNombres[dni]) || ""; }
function alistaNombre(dni, nombre) {
  const n = String(nombre || "").trim();
  if (/^\d{8}$/.test(String(dni || "")) && n) { cacheNombres[dni] = n; try { localStorage.setItem("pwf_nombres", JSON.stringify(cacheNombres)); } catch (e) { } renderTagNombre(); }
}
function renderTagNombre() {
  const tag = $("#dashDniTag"); if (!tag) return;
  const n = nombreDeDni(dashDni);
  tag.textContent = n ? "👤 " + n + "  ·  DNI " + (dashDni || "—") : "DNI: " + (dashDni || "—");
}

/* ---- áreas 👥 EMPLEADOS / 🔬 FORENSE ---- */
const TABS_EMPLEADOS = [["qrdigital", "📱 QR DIGITAL"], ["qrkg", "🌾 COSECHA"], ["ranking", "🏆 RANKING"]];
const TABS_FORENSE = [["resumen", "Resumen"], ["endpoints", "🔌 Endpoints"], ["network", "Network"],
  ["javascript", "JavaScript"], ["signalr", "SignalR"], ["kg", "KG Integrity"], ["errores", "Errores"],
  ["consistencia", "Consistencia"], ["snapshots", "Snapshots"], ["hallazgos", "Hallazgos"],
  ["evidencias", "Evidencias"], ["informes", "Informes"]];
const areaDeTab = (n) => (n === "qrdigital" || n === "qrkg" || n === "ranking") ? "empleados" : "forense";

function renderNav() {
  const lista = state.area === "empleados" ? TABS_EMPLEADOS : TABS_FORENSE;
  const nav = $("#tabs");
  if (!nav) return;
  nav.innerHTML = lista.map(([t, lbl]) =>
    `<button data-tab="${t}">${lbl}</button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => goTab(b.dataset.tab));
}
function syncAreaButtons() {
  $$("#areas button").forEach(b => b.classList.toggle("active", b.dataset.area === state.area));
}
function goTab(name) {
  state.area = areaDeTab(name);
  document.body.dataset.area = state.area;
  syncAreaButtons();
  renderNav();
  return loadTab(name);
}
function showArea(area, tab) {
  state.area = area;
  document.body.dataset.area = area;
  syncAreaButtons();
  renderNav();
  return goTab(tab || (area === "empleados" ? "qrdigital" : "resumen"));
}

/* ---- tema claro / oscuro (localStorage) ---- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $("#btnTheme");
  if (b) b.textContent = t === "light" ? "☀️" : "🌙";
  try { localStorage.setItem("pwf-theme", t); } catch (e) { }
}
function hoyLocalISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function themeInit() {
  let t = null;
  try { t = localStorage.getItem("pwf-theme"); } catch (e) { }
  // Por defecto: TEMA CLARO (estilo PROAGRO SaaS de la imagen de referencia)
  applyTheme(t === "dark" ? "dark" : "light");
}

function normalizarRespuesta(raw, body) {
  const dias = (raw.dias || []).map(d => ({
    fecha: d.fecha,
    registros: d.registros != null ? d.registros : ((d.items || d.detalle || []).length),
    items: (d.items || d.detalle || []).map(it => (it && typeof it === "object") ? it : {}),
  }));
  return { ok: true, estado: raw.encontrado ? "OK" : "SIN_DATOS",
    consulta: { dni: body.dni, fechaIni: body.fechaIni, fechaFin: body.fechaFin },
    resultado: { encontrado: !!raw.encontrado, nombre: raw.nombre || null, dias,
      claves_respuesta: raw.claves_respuesta || Object.keys(raw) },
    meta: { http_status: 200, elapsed_ms: 0, via: raw.via || "worker" } };
}
async function apiProagroDirecta(body) {
  // 1) Si hay Worker configurado (serverless): GitHub Pages -> Worker -> PROAGRO.
  const wu = workerUrl.trim();
  if (wu) {
    try {
      const r = await fetch(wu.replace(/\/$/, "") + "/api/cosecha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni: body.dni, fechaIni: body.fechaIni, fechaFin: body.fechaFin }),
      });
      if (!r.ok) return { estado: "HTTP " + r.status, meta: { http_status: r.status } };
      const raw = await r.json().catch(() => null);
      if (!raw) return { estado: "RESPUESTA_INESPERADA", error: "JSON inesperado del Worker" };
      raw.via = "worker";
      return normalizarRespuesta(raw, body);
    } catch (e) {
      return { estado: "WORKER", ok: false,
        error: "🌩️ No se pudo contactar el Worker (" + wu + "). Revisa que esté desplegado o la URL guardada." };
    }
  }
  // 2) Sin Worker: intento DIRECTA navegador -> PROAGRO (bloqueado por CORS; documentado).
  try {
    const r = await fetch("https://digital.proagro.pe/QrKgAra/ConsultarKgVista", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni: body.dni, fechaIni: body.fechaIni, fechaFin: body.fechaFin }),
    });
    if (!r.ok) return { estado: "HTTP " + r.status, meta: { http_status: r.status } };
    const raw = await r.json().catch(() => null);
    if (!raw) return { estado: "RESPUESTA_INESPERADA", error: "JSON inesperado" };
    raw.via = "directo";
    return normalizarRespuesta(raw, body);
  } catch (e) {
    return { estado: "CORS", ok: false,
      error: "❌ CORS: PROAGRO no permite consulta directa desde GitHub Pages. Configura arriba el Worker serverless gratuito (o usa la versión local) para datos reales." };
  }
}
async function api(url, opts = {}) {
  if (staticMode) {
    if (url.indexOf("/api/consultar-kg") === 0) return apiProagroDirecta(JSON.parse((opts.body) || "{}"));
    throw new Error("Sin backend: " + url + " solo existe en la versión local/VPS.");
  }
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && j.error) throw new Error(j.error);
  return j;
}
function status(msg, err = false) {
  const el = $("#statusMsg");
  el.textContent = msg;
  el.className = err ? "err" : "";
}
function setRunning(running, msg = "") {
  $("#btnAnalyze").disabled = running;
  $("#btnNewAudit").disabled = running;
  $("#progressbar").classList.toggle("hidden", !running);
  if (running) status(msg || "Auditoría en ejecución…");
}
function stClass(code, err) {
  if (err) return "st-e";
  if (code == null) return "st-e";
  return "st-" + String(code)[0];
}
function sevClass(s) { return "s-" + String(s).toLowerCase(); }
function klassOf(s) { return "k-" + (String(s).startsWith("HECHO") ? "hecho"
  : String(s).startsWith("INDICIO") ? "indicio"
  : String(s).startsWith("HIPOTESIS") || String(s).startsWith("HIPÓTESIS") ? "hipotesis"
  : "prueba"); }
const fmtKlass = (k) => String(k).replace("_", " ").replace("HIPOTESIS", "HIPÓTESIS");

/* ============================ boot ============================ */
async function boot() {
  status("Cargando…");
  try {
    themeInit();
    let h = null;
    try { h = await api("/api/health"); } catch (e) { h = null; }
    cfg = (h && h.cfg) || {};
    if (cfg.port) {
      await loadProjects();
    } else {
      staticMode = true; cfg.static = true;
      document.body.dataset.static = "1";
      try { const ult = localStorage.getItem("pwf_dni"); if (ult) { const i = $("#dashDniInp"); if (i) i.value = ult; } } catch (e) { }
    }
    bindEvents();
    setInterval(syncStatus, 2500);
    // Área predeterminada al abrir: 👥 EMPLEADOS → 📱 QR DIGITAL
    await showArea("empleados", "qrdigital");
    status("Listo");
  } catch (e) { status("Error de conexión con el backend: " + e.message, true); }
}

async function loadProjects() {
  const { projects } = await api("/api/projects");
  state.projects = projects;
  const sel = $("#selProject");
  sel.innerHTML = projects.map(p =>
    `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  state.curProject = projects[0] || null;
  if (state.curProject) {
    const hdU = $("#hdUrl"); if (hdU) hdU.textContent = state.curProject.url;
    await loadAudits();
  }
}

async function loadAudits(preferId = null) {
  if (!state.curProject) return;
  const { audits } = await api("/api/audits?project_id=" + state.curProject.id);
  state.audits = audits;
  const sel = $("#selAudit");
  sel.innerHTML = audits.map(a =>
    `<option value="${a.id}">#${a.id} · ${esc(a.started_at)} · ${a.status}${a.mode ? " · " + esc(a.mode) : ""}</option>`).join("");
  if (preferId && audits.some(a => a.id === preferId)) state.curAudit = audits.find(a => a.id === preferId);
  else if (!state.curAudit || !audits.some(a => a.id === state.curAudit.id)) {
    state.curAudit = audits.find(a => a.status === "done") || audits[0] || null;
  }
  await renderAuditMeta();
}

async function renderAuditMeta() {
  const a = state.curAudit;
  $("#auditMeta").textContent = a ? `${esc(a.mode || "")} · ${a.status}` : "";
  if (a && a.status === "running") { setRunning(true); state.auditRunning = a.id; }
  else if (state.auditRunning) { state.auditRunning = null; setRunning(false); }
  refreshQuickStats().catch(() => {});
}

function switchPanel(name) {
  $$("#tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
  $$("main .panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
  $("#selProject").onchange = async (e) => {
    state.curProject = state.projects.find(p => p.id == e.target.value);
    state.curAudit = null;
    const hdU = $("#hdUrl"); if (hdU) hdU.textContent = state.curProject.url;
    await loadAudits();
  };
  $("#selAudit").onchange = async (e) => {
    state.curAudit = state.audits.find(a => a.id == e.target.value);
    await renderAuditMeta();
    if (state.curAudit) await goTab("resumen");
  };
  $$("#areas button").forEach(b => b.onclick = () => showArea(b.dataset.area));
  $("#btnTheme").onclick = () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  $("#btnAnalyze").onclick = openAnalyzeModal;
  $("#btnNewAudit").onclick = openNewAuditModal;
  $("#btnReport").onclick = generateReport;
  $("#btnGenReport").onclick = generateReport;
  $("#btnOpenSnapshot").onclick = () => { if (state.curAudit) loadTab("snapshots"); };
  $("#btnAuditLog").onclick = showLogModal;
  $("#btnConcurrency").onclick = openConcurrencyModal;
  $("#netFilter").oninput = () => renderNetwork();
  $("#netKind").onchange = () => renderNetwork();
  $("#netStatus").onchange = () => renderNetwork();
  $("#fSev").onchange = () => renderFindings();
  $("#fKlass").onchange = () => renderFindings();
  $("#fType").onchange = () => renderFindings();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); qrCerrarCamara(); }
  });
}

/* ============================ tabs ============================ */
/* ---- 📱 QR DIGITAL (generador 100% en el navegador, sin servidor) ---- */
let qdBoundFlag = false;
function qdGenerar() {
  const dni = ($("#qdDni").value || "").trim();
  const msg = $("#qdMsg");
  if (!/^\d{8}$/.test(dni)) { msg.textContent = "El DNI debe tener 8 dígitos."; msg.className = "qrmsg err"; return; }
  msg.textContent = "";
  msg.className = "qrmsg";
  $("#qdImg").innerHTML = "";
  $("#qdDniLabel").textContent = dni;
  try {
    if (typeof QRCode === "undefined") throw new Error("librería QR no cargada");
    new QRCode($("#qdImg"), { text: dni, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
    $("#qdResult").classList.remove("hidden");
    msg.textContent = "QR generado con el DNI " + dni + " (formato texto).";
  } catch (e) {
    msg.textContent = "No se pudo generar el QR: " + e.message;
    msg.className = "qrmsg err";
  }
}
function qdDescargar() {
  const dni = ($("#qdDniLabel").textContent || "").trim();
  if (!/^\d{8}$/.test(dni)) return;
  const caja = $("#qdImg");
  const canvas = caja && caja.querySelector("canvas");
  const img = caja && caja.querySelector("img");
  let href = "";
  try {
    if (canvas) href = canvas.toDataURL("image/png");
    else if (img && img.src) href = img.src;
  } catch (e) { /* si el canvas está contaminado no habrá descarga */ }
  if (!href) { const m = $("#qdMsg"); if (m) { m.textContent = "No se pudo exportar el QR."; m.className = "qrmsg err"; } return; }
  const a = $("#qdDownload");
  a.href = href;
  a.setAttribute("download", "qr_" + dni + ".png");
}
function qdBind() {
  if (qdBoundFlag) return;
  qdBoundFlag = true;
  $("#btnQrGen").onclick = qdGenerar;
  $("#qdDownload").onclick = qdDescargar;
  $("#qdDni").addEventListener("keydown", (e) => { if (e.key === "Enter") qdGenerar(); });
}

function estaticoForense(name) {
  const panel = $("#panel-" + name); if (!panel) return;
  const t = { resumen: "Resumen", endpoints: "🔌 Endpoints", network: "🌐 Network", javascript: "📦 JavaScript",
    signalr: "SignalR", kg: "KG Integrity", errores: "Errores", consistencia: "Consistencia",
    snapshots: "Snapshots", hallazgos: "Hallazgos", evidencias: "Evidencias", informes: "Informes" };
  panel.innerHTML = `<div class="qr-sec"><h2>🔬 ${t[name] || name}</h2><div class="cardbox">
    <p><b>⚠️ Disponible en la versión local / VPS.</b></p>
    <p>GitHub Pages sirve solo archivos estáticos (sin backend). Esta sección forense usa la base
    local de la herramienta (Python/Flask: auditorías, inventario de endpoints con estados
    🟢🟡🔵🔴 verificados, network, chunks, historial…) y además <b>PROAGRO no permite CORS</b>
    para descargar/analizar sus recursos desde un navegador externo.</p>
    <p class="small muted">Para verla con datos reales: corre la versión local (<span class="mono">run.py</span>)
    o el VPS en <span class="mono">http://IP:3792</span>. GitHub Pages queda 100% operativo para 👥 EMPLEADOS
    (QR DIGITAL, escáner, COSECHA) con las limitaciones CORS documentadas.</p></div></div>`;
}
async function cargarRanking() {
  const panel = $("#panel-ranking"); if (!panel) return;
  panel.innerHTML = `<div class="qr-sec"><h2>🏆 RANKING</h2><div class="cardbox" id="rkBox"><p>Consultando PROAGRO directamente…</p></div></div>`;
  const hoy = hoyLocalISO();
  const box = $("#rkBox");
  try {
    const base = workerUrl.trim() ? workerUrl.trim().replace(/\/$/, "") + "/api/ranking" : "https://digital.proagro.pe/QrKgAra/ObtenerRankingVista";
    const r = await fetch(base + "?top=10&fechaIni=" + hoy + "&fechaFin=" + hoy,
      { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json().catch(() => null);
    if (!j) throw new Error("respuesta no JSON");
    const lista = j.ranking || j.datos || [];
    if (!Array.isArray(lista) || !lista.length) { box.innerHTML = "<p>⚠️ Sin datos de ranking para hoy.</p>"; return; }
    const n = (x) => x != null && !isNaN(Number(x)) ? Number(x).toLocaleString("es", { maximumFractionDigits: 1 }) : "—";
    box.innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Nombre</th><th class="num">Exportable KG</th><th class="num">Descarte</th><th class="num">Total</th></tr></thead><tbody>` +
      lista.map((r2, i) => `<tr><td>${i + 1}</td><td>${esc(r2.nombre || r2.jefe || "—")}</td>` +
        `<td class="num">${n(r2.kgExportable ?? r2.kg_total ?? r2.kgTotal)}</td>` +
        `<td class="num">${n(r2.kgDescarte)}</td><td class="num"><b>${n(r2.kgTotal ?? r2.kg_total)}</b></td></tr>`).join("") +
      `</tbody></table><p class="small muted">Datos reales devueltos por el endpoint (solo lectura).</p>`;
  } catch (e) {
    box.innerHTML = `<p><b>❌ Sin acceso directo desde GitHub Pages</b></p><p>PROAGRO no envía cabeceras CORS. Configura el
      Worker serverless gratuito en 🌾 COSECHA (caja 🌩️) para consultar el ranking con datos reales desde aquí.</p>`;
  }
}
async function loadTab(name) {
  const a = areaDeTab(name);
  if (state.area !== a) {
    state.area = a;
    document.body.dataset.area = a;
    syncAreaButtons();
    renderNav();
  }
  switchPanel(name);
  if (name === "ranking") { cargarRanking(); return; }
  if (staticMode && (name === "resumen" || name === "endpoints" || name === "network" || name === "javascript" ||
      name === "signalr" || name === "kg" || name === "errores" || name === "consistencia" || name === "snapshots" ||
      name === "hallazgos" || name === "evidencias" || name === "informes")) { estaticoForense(name); return; }
  if (name === "qrkg") { qrkgBind(); await qrkgRefreshHistory(); return; }
  if (name === "qrdigital") { qdBind(); return; }
  if (name === "ranking") { return; }
  if (!state.curAudit) { showEmpty("Sin auditoría todavía — pulsa ▶ ANALIZAR."); return; }
  try {
    if (name === "resumen") await renderResumen();
    else if (name === "network") await loadNetwork();
    else if (name === "endpoints") await loadInventory();
    else if (name === "javascript") await loadJs();
    else if (name === "signalr") await loadSignalr();
    else if (name === "kg") await loadKg();
    else if (name === "errores") await loadErrores();
    else if (name === "consistencia") await loadConsistencia();
    else if (name === "snapshots") await loadSnapshots();
    else if (name === "hallazgos") await loadFindings();
    else if (name === "evidencias") await loadEvidencias();
    else if (name === "informes") await loadInformes();
  } catch (e) { showEmpty("Error: " + e.message); }
}

function showEmpty(msg) {
  switchPanel("resumen");
  const box = $("#panel-resumen");
  box.innerHTML = `<div class="cardbox"><p class="muted">${esc(msg)}</p></div>`;
}

async function renderResumen() {
  const s = await api(`/api/audits/${state.curAudit.id}/summary`);
  const a = s.audit, sum = s.summary || {}, c = s.counts || {};
  $("#sumCards").innerHTML = [
    ["URL", sum.url || "", "mono", 13], ["Estado", a.status, "", 10],
    ["Duración", (sum.elapsed_s ?? "—") + " s", "", 9],
    ["Peticiones", sum.requests ?? c.requests ?? 0, "", 11],
    ["JS analizados", sum.scripts ?? c.scripts ?? 0, "", 11],
    ["Endpoints", sum.endpoints ?? c.endpoints ?? 0, "", 11],
    ["Hallazgos", c.findings ?? 0, "", 11],
    ["Evidencia", c.evidence ?? 0, "", 11],
  ].map(([l, n, cls, size]) =>
    `<div class="card"><div class="n" style="font-size:${size}px" class="${cls}">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");
  const mr = sum.main_ranking || {};
  $("#mainRank").innerHTML = mr.records == null
    ? "<span class='muted'>— sin consulta principal —</span>"
    : `registros: <b>${mr.records}</b> · suma kgExportable: <b>${mr.sum_kgExportable}</b> · ` +
      `kgDescarte: <b>${mr.sum_kgDescarte}</b> · kgTotal: <b>${mr.sum_kgTotal}</b> · ` +
      `violaciones de orden: ${mr.ordering_violations}`;
  const sevB = (vals, color) => {
    const tot = Object.values(vals).reduce((x, y) => x + y, 0) || 1;
    return Object.entries(vals).map(([k, v]) =>
      `<div class="bar"><span class="lbl">${esc(k)}</span><span class="track">` +
      `<span class="fill" style="width:${(v / tot * 100).toFixed(1)}%;background:${color(k)}"></span></span>` +
      `<span class="v">${v}</span></div>`).join("") || "<span class='muted'>—</span>";
  };
  const sevColor = k => ({ INFO: "#3aa0ff", LOW: "#35c46a", MEDIUM: "#ff9f2e",
    HIGH: "#ff5d5d", CRITICAL: "#ff2d55" })[k] || "#666";
  $("#sevBars").innerHTML = sevB(s.severity || {}, sevColor);
  const kColor = k => k.startsWith("HECHO") ? "#35c46a" : k.startsWith("INDICIO") ? "#ffb020"
    : k.startsWith("HIPOTESIS") || k.startsWith("HIPÓTESIS") ? "#b07bff" : "#8b93a1";
  $("#klassBars").innerHTML = sevB(s.klass || {}, kColor);
  $("#screensChips").innerHTML = (sum.screens || []).map(x =>
    `<span class="chip">${esc(x.screen)} <b>·</b> «${esc(x.matched)}»</span>`).join("") ||
    "<span class='muted'>sin pantallas KG en HTML</span>";
  const cards = await api(`/api/audits/${state.curAudit.id}/status`);
  const logtail = (cards.log || []).slice(-6).join("\n");
  // contadores coherentes con el inventario real (mismo origen que la barra superior)
  const inv = await getInventory();
  if (inv) {
    const t = inv.totales || {};
    $$("#sumCards .card").forEach(card => {
      const lbl = card.querySelector(".l");
      if (!lbl) return;
      const n = card.querySelector(".n");
      if (lbl.textContent === "Endpoints") {
        const es = (t.estados || {});
        n.textContent = (t.endpoints ?? 0) + "  (🟢" + (es["VERIFICADO"] || 0) +
          " 🟡" + (es["ENCONTRADO EN CÓDIGO"] || 0) + " 🔵" + (es["REFERENCIADO"] || 0) +
          " 🔴" + (es["ERROR"] || 0) + ")";
        n.style.fontSize = "15px";
      } else if (lbl.textContent === "JS analizados") n.textContent = t.js ?? n.textContent;
      else if (lbl.textContent === "Evidencia") n.textContent = (t.resources ?? 0) + " recursos";
    });
  }
  $("#sumCards").insertAdjacentHTML("beforeend",
    `<div class="card" style="grid-column:1/-1"><div class="l">últimas líneas del log</div>` +
    `<pre class="log" style="max-height:110px">${esc(logtail || "—")}</pre></div>`);
}

/* ---------------- Network ---------------- */
let netRows = [];
async function loadNetwork() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/requests`);
  netRows = rows;
  renderNetwork();
}
function renderNetwork() {
  const f = ($("#netFilter").value || "").toLowerCase();
  const k = $("#netKind").value, st = $("#netStatus").value;
  const rows = netRows.filter(r =>
    (!f || (r.url || "").toLowerCase().includes(f)) &&
    (!k || r.kind === k) &&
    (!st || (st === "error" ? (r.error || r.status >= 400) :
      r.status && String(r.status).startsWith(st[0]))));
  $("#netCount").textContent = `${rows.length} / ${netRows.length} peticiones`;
  $("#netTable").innerHTML = `<thead><tr><th>#</th><th>URL</th><th>Método</th><th>HTTP</th>` +
    `<th>Tipo</th><th>Content-Type</th><th class="num">Bytes</th><th class="num">TTFB ms</th>` +
    `<th class="num">Total ms</th><th>SHA-256</th><th>Error</th></tr></thead><tbody>` +
    rows.map(r => `<tr class="clickable" onclick="netDetail(${r.id})">` +
      `<td>${r.id}</td><td class="mono small">${esc((r.url || "").slice(0, 130))}</td>` +
      `<td>${esc(r.method)}</td><td><span class="st ${stClass(r.status, r.error)}">${esc(r.status ?? (r.error ? "ERR" : "—"))}</span></td>` +
      `<td>${esc(r.kind)}</td><td class="small">${esc((r.content_type || "").slice(0, 40))}</td>` +
      `<td class="num">${fmtBytes(r.size)}</td><td class="num">${r.ttfb_ms ?? "—"}</td>` +
      `<td class="num">${r.total_ms ?? "—"}</td>` +
      `<td class="mono small">${esc((r.sha256 || "").slice(0, 12))}</td>` +
      `<td class="small">${esc((r.error || "").slice(0, 60))}</td></tr>`).join("") + "</tbody>";
}
async function netDetail(id) {
  const r = netRows.find(x => x.id === id);
  if (!r) return;
  openModal(`<h2>Petición #${r.id}</h2>` +
    `<p class="mono small">${esc(r.url)}</p>` +
    `<div class="mrow"><b>${esc(r.method)}</b> <span class="st ${stClass(r.status, r.error)}">${esc(r.status ?? "")}</span>` +
    ` · tipo: ${esc(r.kind)} · ${esc(r.content_type || "")} · ${fmtBytes(r.size)} · ` +
    `TTFB ${r.ttfb_ms ?? "—"} ms · total ${r.total_ms ?? "—"} ms</div>` +
    `<p class="small">SHA-256: <span class="mono">${esc(r.sha256 || "—")}</span></p>` +
    (r.error ? `<pre class="log">${esc(r.error)}</pre>` : "") +
    `<div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}

/* ---------------- Inventario forense: Endpoints ---------------- */
let invCache = { auditId: null, inv: null };
let invQ = "";
let invTipo = "Todos";
const CAT_QR = ["/QrKgAra/ConsultarKgVista", "/QrKgAra/ObtenerRankingVista",
  "/QrKgAra/ObtenerJefeGrupo", "/QrKgAra/ObtenerJefeCuadrilla"];

async function getInventory() {
  if (!state.curAudit) return null;
  if (invCache.auditId === state.curAudit.id && invCache.inv) return invCache.inv;
  try {
    const r = await fetch(`/api/audits/${state.curAudit.id}/inventory`);
    const inv = await r.json();
    if (inv.error) throw new Error(inv.error);
    invCache = { auditId: state.curAudit.id, inv };
    return inv;
  } catch (e) {
    invCache = { auditId: null, inv: null };
    return null;
  }
}

function invCategoria(e) {
  const p = (e.path || "").toLowerCase();
  const par = (e.params || []).join(",").toLowerCase();
  const fn = (e.funcion || "").toLowerCase();
  if (CAT_QR.some(x => p === x.toLowerCase()) || p.includes("kg") || fn.includes("kg") || par.includes("kg"))
    return "KG";
  if (par.includes("dni") || p.includes("consultarkg") || fn.includes("dni")) return "DNI";
  if (p.includes("login") || p.includes("/home/") || p.includes("cerrar")) return "Login";
  return "Otros";
}
function invFiltra(e) {
  const t = invTipo;
  const q = invQ;
  if (t === "Todos") { /* sigue */ }
  else if (t === "GET" || t === "POST") { if ((e.metodo || "") !== t) return false; }
  else if (t === "VERIFICADO" || t === "ENCONTRADO EN CÓDIGO" || t === "REFERENCIADO" || t === "ERROR") {
    if (e.estado !== t) return false;
  }
  else if (["QR", "KG", "DNI", "Login", "Otros"].includes(t)) {
    const cat = invCategoria(e);
    if (t === "QR") { if (e.path.indexOf("/QrKgAra/") !== 0) return false; }
    else if (cat !== t) return false;
  }
  if (q) {
    const blob = (e.path + " " + (e.metodo || "") + " " + (e.funcion || "") + " " +
      (e.params || []).join(" ") + " " + (e.archivo || "") + " " + (e.estado || "")).toLowerCase();
    if (blob.indexOf(q) < 0) return false;
  }
  return true;
}

async function loadInventory() {
  const inv = await getInventory();
  if (!inv) { showEmpty("Sin auditoría — pulsa ▶ ANALIZAR primero."); return; }
  await refreshQuickStats();
  const to = inv.totales || {};
  $("#invTotal").textContent = (to.endpoints || 0) + " endpoint(s) · " + (inv.fecha_analisis || "");
  const es = to.estados || {};
  $("#invStats").innerHTML = [
    ["🔌", "ENDPOINTS", to.endpoints],
    ["🟢", "VERIFICADOS", es["VERIFICADO"] || 0],
    ["🟡", "EN CÓDIGO", es["ENCONTRADO EN CÓDIGO"] || 0],
    ["🔵", "REFERENCIADOS", es["REFERENCIADO"] || 0],
    ["🔴", "ERROR", es["ERROR"] || 0],
  ].map(([ic, l, n]) => `<div class="card"><div class="n">${ic} ${n}</div><div class="l">${l}</div></div>`).join("");
  const tipos = ["Todos", "GET", "POST", "VERIFICADO", "ENCONTRADO EN CÓDIGO", "REFERENCIADO",
    "ERROR", "QR", "KG", "DNI", "Login", "Otros"];
  $("#invFiltros").innerHTML = tipos.map(t =>
    `<span class="chip ${t === invTipo ? "act" : ""}" data-tipo="${esc(t)}">${esc(t)}</span>`).join("");
  $$("#invFiltros .chip").forEach(c => c.onclick = () => { invTipo = c.dataset.tipo; renderEpTable(inv); });
  $("#invBuscar").oninput = (e) => { invQ = e.target.value.trim().toLowerCase(); renderEpTable(inv); };
  $("#invBtnJson").onclick = () => invExportar(inv, "json");
  $("#invBtnCsv").onclick = () => invExportar(inv, "csv");
  renderEpTable(inv);
  renderInvExtras(inv);
  // El historial de consultas KG vive en FORENSE: asegura binds y refresco
  qrkgBind();
  await qrkgRefreshHistory();
}

function renderEpTable(inv) {
  const eps = inv.endpoints || [];
  const rows = eps.filter(invFiltra);
  $("#invCount").textContent = `${rows.length} / ${eps.length} endpoints`;
  const cls = s => s === "VERIFICADO" ? "ep-ver" : s === "ENCONTRADO EN CÓDIGO" ? "ep-cod"
    : s === "REFERENCIADO" ? "ep-ref" : "ep-err";
  const idx = {};
  eps.forEach((e, i) => { idx[e.path] = i; });
  $("#epTable").innerHTML = `<thead><tr><th>Estado</th><th>Ruta</th><th>Método</th><th>Función</th>` +
    `<th>Parámetros</th><th>Archivo</th><th class="num">Línea</th><th>Respuesta</th><th></th></tr></thead><tbody>` +
    (rows.length ? rows.map(e => `<tr class="clickable" onclick="invDetail('${esc((e.path || "").replace(/'/g, "\\'"))}')">` +
      `<td><span class="${cls(e.estado)}">${e.icono || ""} ${esc(e.estado)}</span></td>` +
      `<td class="mono small">${esc(e.path)}</td><td>${esc(e.metodo || "—")}</td>` +
      `<td class="small">${esc(e.funcion || "—")}</td>` +
      `<td class="small">${esc((e.params || []).join(", ") || "—")}</td>` +
      `<td class="mono small">${esc(e.archivo || "")}${e.linea ? ":" + e.linea : ""}</td>` +
      `<td class="num">${e.linea ?? "—"}</td>` +
      `<td>${e.verificado ? (e.respuesta ? "🟢 " + e.respuesta.http : "🟢") : "<span class='muted'>no consultado</span>"}</td>` +
      `<td><button class="btn ghost small" onclick="event.stopPropagation();invCopiar('${esc((e.path || "").replace(/'/g, "\\'"))}')">📋</button></td></tr>`).join("")
      : `<tr><td colspan="9" class="muted">Sin resultados con ese filtro.</td></tr>`) + `</tbody></table>`;
}

function invDetail(path) {
  const inv = invCache.inv;
  const e = (inv.endpoints || []).find(x => x.path === path);
  if (!e) return;
  const estr = e.respuesta && e.respuesta.estructura;
  const l = (k, v) => `<div class="mrow small"><b>${esc(k)}:</b> <span class="mono">${esc(v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : v)}</span></div>`;
  openModal(`<h2>${e.icono || ""} ${esc(e.estado)} — ${esc(e.path)}</h2>
    ${l("Método HTTP", e.metodo || "no determinado")}
    ${l("Función JS que lo usa", e.funcion || "—")}
    ${l("Archivo/chunk", e.archivo + (e.linea ? " (línea " + e.linea + ")" : ""))}
    ${l("URL completa", e.archivo_url || "—")}
    ${l("Parámetros detectados", (e.params || []).join(", ") || "—")}
    ${l("Clasificación original", e.clasificacion || "")}
    ${l("Tipo", e.tipo || "")}
    ${l("Notas", e.notas || "")}
    ${l("Verificado", e.verificado ? "SÍ — " + (e.verificado_via || "") + (e.verificado_en ? " (" + e.verificado_en + ")" : "") : "No — solamente observado en código")}
    ${l("HTTP", e.http ?? (e.respuesta ? e.respuesta.http : "—"))}
    ${l("Fecha del análisis", e.fecha || "")}
    ${estr ? `<label>Estructura real de la respuesta JSON</label><pre class="log">${esc(JSON.stringify(estr, null, 2))}</pre>` : "<p class='muted small'>Respuesta no verificada; solamente encontrado en código.</p>"}
    <div class="actions"><button class="btn ghost" onclick="invCopiar('${esc((e.path || "").replace(/'/g, "\\'"))}')">📋 Copiar ruta</button>
    <button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
function invCopiar(texto) {
  const ok = () => status("Copiado: " + texto);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(ok).catch(() => { fallback(texto); ok(); });
  } else fallback(texto);
  function fallback(t) {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { }
    ta.remove();
  }
}
function invExportar(inv, formato) {
  const meta = { url: inv.url, fecha: inv.fecha_analisis, audit_id: inv.audit_id, totales: inv.totales };
  let contenido, tipo, nombre;
  if (formato === "json") {
    contenido = JSON.stringify({ meta, endpoints: inv.endpoints, funciones: inv.funciones,
      forms: inv.forms, qr: inv.qr, campos: inv.campos, recursos: inv.recursos }, null, 2);
    tipo = "application/json"; nombre = "endpoints.json";
  } else {
    const filas = [["estado", "ruta", "metodo", "funcion", "params", "archivo", "linea", "http", "verificado", "fecha"]];
    (inv.endpoints || []).forEach(e => filas.push([e.estado, e.path, e.metodo || "", e.funcion || "",
      (e.params || []).join(","), e.archivo || "", e.linea ?? "", e.http ?? "", e.verificado ? "si" : "no", e.fecha || ""]));
    contenido = filas.map(r => r.map(c => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(";")).join("\r\n");
    tipo = "text/csv;charset=utf-8"; nombre = "endpoints.csv";
  }
  const blob = new Blob(["\ufeff" + contenido], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  status("Exportado: " + nombre);
}

function renderInvExtras(inv) {
  $("#fnCount").textContent = inv.totales.funciones + " función(es)";
  $("#fnTable").innerHTML = (inv.funciones || []).length ? `<div class="tblwrap"><table class="tbl"><thead><tr>` +
    `<th>Pantalla</th><th>Función JS</th><th>Endpoint</th><th>Método</th><th>Archivo</th></tr></thead><tbody>` +
    (inv.funciones || []).map(f => `<tr><td>${esc(f.pantalla || "—")}</td><td class="mono small">${esc(f.funcion)}</td>` +
      `<td class="mono small">${esc(f.endpoint)}</td><td>${esc(f.metodo || "—")}</td>` +
      `<td class="mono small">${esc(f.archivo || "")}</td></tr>`).join("") + `</tbody></table></div>`
    : `<p class="muted">Sin funciones identificables en el código público.</p>`;
  $("#fmCount").textContent = inv.totales.formularios;
  $("#fmBox").innerHTML = (inv.forms || []).length ? inv.forms.map(f =>
    `<div class="doc-box">${esc(f.method)} ${esc(f.abs || f.action || "")}<br>` +
    (f.campos || []).map(c => ` · ${esc(c.nombre)} (${esc(c.tipo || "")})`).join("") + `</div>`).join("")
    : `<p class="muted">0 formularios HTML clásicos detectados en la página pública (usa botones + JS con DevExtreme/jQuery, sin &lt;form&gt;).</p>`;
  const qr = inv.qr || {};
  $("#qrCount").textContent = qr.librerias.length + qr.usadas.length + " librería(s)";
  let qrHtml = "";
  if ((qr.usadas || []).length) qrHtml += `<p><b>🟢 Utilizadas por el código de la página:</b></p>` +
    qr.usadas.map(x => `<div class="mrow small">📷 ${esc(x.archivo)} <span class="muted">(${esc(x.rol)})</span></div>`).join("");
  qrHtml += `<p style="margin-top:8px"><b>📦 Cargadas (${(qr.librerias || []).length}):</b></p>` +
    (qr.librerias || []).map(x => `<div class="mrow small">📦 ${esc(x.archivo)} <span class="muted">— ${esc(x.rol)} · ${fmtBytes(x.bytes)}</span></div>`).join("") +
    `<p class="muted small">⚠️ Que una librería esté cargada NO implica que la página pública la use: ` +
    `en el código inline observable no hay llamadas jsQR()/QRCode; el uso real puede estar en la zona autenticada de PROAGRO.</p>`;
  (qr.contexto || []).forEach(c => qrHtml += `<div class="det">· ${esc(c.origen)}: …${esc(c.uso)}…</div>`);
  $("#qrBox").innerHTML = qrHtml;
  $("#cmCount").textContent = inv.totales.campos + " campo(s)";
  $("#cmBox").innerHTML = (inv.campos || []).length ? `<div class="tblwrap"><table class="tbl"><thead><tr>` +
    `<th>Campo</th><th class="num">Veces</th><th>Dónde aparece (top)</th></tr></thead><tbody>` +
    inv.campos.slice(0, 30).map(c => `<tr><td class="mono">${esc(c.campo)}</td><td class="num">${c.total}</td>` +
      `<td class="small muted">${esc(c.archivos.slice(0, 4).map(a => a.archivo + " (" + a.n + ")").join(" · "))}</td></tr>`).join("") +
    `</tbody></table></div>` : `<p class="muted">—</p>`;
  const rec = inv.recursos || {};
  const ej = (inv.endpoints || []).map(e => `   ${e.icono} ${e.estado === "VERIFICADO" ? "🟢" : e.estado === "ENCONTRADO EN CÓDIGO" ? "🟡" : e.estado === "ERROR" ? "🔴" : "🔵"} ${esc(e.path)}  (${esc(e.metodo || "-")})`).join("\n");
  $("#mapBox").innerHTML = `<pre class="log">PÁGINA ${esc(inv.url || "")}
├── HTML (1) + ${rec.css || 0} CSS + ${rec.imagenes || 0} imágenes + ${rec.iframes || 0} iframes
├── JavaScript: ${rec.js || 0} (${rec.js_externos || 0} bundles + ${rec.js_inline || 0} inline)
├── ENDPOINTS (${(inv.endpoints || []).length})${ej ? "\n" + ej : ""}
├── QR: ${(qr.librerias || []).length} cargadas · ${(qr.usadas || []).length} usadas por la página
├── FUNCIONES → endpoints: ${inv.totales.funciones}
├── FORMULARIOS: ${inv.totales.formularios}
└── CAMPOS detectados: ${inv.totales.campos}</pre>` +
    ((inv.ruido || []).length ? `<p class="small muted">Nota: ${inv.ruido.length} ruta(s)-ruido de librerías excluidas del inventario (p. ej. /a/b dentro de DataTables).</p>` : "");
}

async function refreshQuickStats() {
  const bar = $("#quickStats");
  if (!bar) return;
  const inv = await getInventory();
  if (!inv) { bar.innerHTML = `<span class="muted small">Selecciona una auditoría para ver el inventario.</span>`; return; }
  const t = inv.totales || {};
  const es = t.estados || {};
  const chip = (txt, tab) => `<span class="st" onclick="goTab('${tab}')">${txt}</span>`;
  bar.innerHTML =
    chip(`🌐 Web <b>${t.recursos || 0}</b>`, "resumen") +
    chip(`📦 JS <b>${t.js || 0}</b>`, "javascript") +
    chip(`🔌 Endpoints <b>${t.endpoints || 0}</b> 🟢${es["VERIFICADO"] || 0} 🟡${es["ENCONTRADO EN CÓDIGO"] || 0} 🔵${es["REFERENCIADO"] || 0} 🔴${es["ERROR"] || 0}`, "endpoints") +
    chip(`🧩 Funciones <b>${t.funciones || 0}</b>`, "endpoints") +
    chip(`📄 Formularios <b>${t.formularios || 0}</b>`, "endpoints") +
    chip(`📷 QR <b>${t.qr_librerias || 0}</b>`, "endpoints") +
    chip(`📊 Datos <b>${t.campos || 0}</b>`, "endpoints") +
    chip(`⚠️ Hallazgos <b>${t.hallazgos || 0}</b>`, "hallazgos");
}

/* ---------------- JavaScript ---------------- */
let jsRows = [];
async function loadJs() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/scripts`);
  jsRows = rows;
  let analysis = [];
  try {
    analysis = await (await fetch(`/api/audits/${state.curAudit.id}/analysis/js_analysis.json`)).json();
  } catch (e) { analysis = []; }
  const kw = (url) => {
    const a = analysis.find(x => x.file === url);
    if (!a) return "";
    const cs = a.keyword_counts || {};
    return Object.entries(cs).filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}:${v}`).join(" · ");
  };
  const ajax = (url) => {
    const a = analysis.find(x => x.file === url);
    return a ? (a.ajax_calls || []).length : 0;
  };
  $("#jsTable").innerHTML = `<thead><tr><th>#</th><th>URL / nombre</th><th>Tipo</th>` +
    `<th class="num">Bytes</th><th>HTTP</th><th>SHA-256</th><th>Keywords KG (conteo)</th>` +
    `<th class="num">AJAX/fetch</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr class="clickable" onclick="jsDetail(${i})">` +
      `<td>${r.id}</td><td class="mono small">${esc(r.url)}</td><td>${esc(r.kind)}</td>` +
      `<td class="num">${fmtBytes(r.size)}</td>` +
      `<td><span class="st ${stClass(r.status, r.error)}">${esc(r.status ?? "")}</span></td>` +
      `<td class="mono small">${esc((r.sha256 || "").slice(0, 16))}</td>` +
      `<td class="small">${esc(kw(r.url).slice(0, 110) || "—")}</td>` +
      `<td class="num">${ajax(r.url)}</td></tr>`).join("") + "</tbody>";
}
async function jsDetail(i) {
  const r = jsRows[i];
  let analysis = [];
  try {
    analysis = await (await fetch(`/api/audits/${state.curAudit.id}/analysis/js_analysis.json`)).json();
  } catch (e) {}
  const a = analysis.find(x => x.file === r.url) || {};
  const calls = (a.ajax_calls || []).slice(0, 40)
    .map(c => `<div class="mrow mono small">${esc(c.method)} <b>${esc(c.url)}</b></div>`).join("") || "—";
  const hits = (a.keyword_hits || []).filter(h => (a.keyword_counts || {})[h.keyword] > 0).slice(0, 12)
    .map(h => `<li><b>${esc(h.keyword)}</b> «${esc(h.matched)}» <pre class="log">${esc(h.snippet)}</pre></li>`).join("");
  openModal(`<h2>${esc(r.name)}</h2><p class="mono small">${esc(r.url)}</p>` +
    `<p class="small">SHA-256: <span class="mono">${esc(r.sha256 || "—")}</span> · ${fmtBytes(r.size)} · ${esc(r.kind)}</p>` +
    `<h3>Llamadas AJAX / fetch (${(a.ajax_calls || []).length})</h3>${calls}` +
    `<h3>Contextos de keywords KG</h3><ul>${hits || "<li class='muted'>—</li>"}</ul>` +
    `<div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}

/* ---------------- SignalR ---------------- */
async function loadSignalr() {
  const s = await api(`/api/audits/${state.curAudit.id}/summary`);
  const sum = s.summary || {};
  const sig = sum.signalr || [];
  const hubs = sum.hub_urls || [];
  const ws = sum.websockets || [];
  let html = "";
  if (!sig.length && !hubs.length && !ws.length) {
    html = `<div class="cardbox"><h3>SignalR / WebSocket</h3>` +
      `<p class="muted">Sin referencias a SignalR ni WebSocket en el HTML/JS observable ni en el tráfico del navegador.</p>` +
      `<p class="small muted">La etiqueta «Actualización automática activada» puede implementarse con polling (setInterval/fetch) en lugar de una conexión persistente.</p></div>`;
  } else {
    html = `<div class="cardbox"><h3>Referencias SignalR / WebSocket detectadas</h3>` +
      sig.map(x => `<div class="mrow">${esc(x.file || "")} — <b>${esc(x.style || "")}</b>` +
        `<br><span class="small">hub URLs: ${esc((x.hub_urls || []).join(", ") || "—")}</span>` +
        `<br><span class="small">server: ${esc((x.server_calls || []).join(", ") || "—")}</span>` +
        `<br><span class="small">client: ${esc((x.client_methods || []).join(", ") || "—")}</span></div>`).join("") +
      `</div>`;
  }
  $("#sigBox").innerHTML = html;
}

/* ---------------- KG ---------------- */
async function loadKg() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/kgflows`);
  if (!rows.length) {
    $("#kgBox").innerHTML = `<div class="cardbox"><h3>KG Integrity</h3><p class="muted">Sin flujos KG correlacionados en el código observable.</p></div>`;
    return;
  }
  $("#kgBox").innerHTML = `<div class="grid2">` + rows.map(f => {
    let notes = "";
    try { const n = JSON.parse(f.notes || "{}"); notes = n.keywords ? "keywords: " + JSON.stringify(n.keywords) : ""; } catch (e) {}
    return `<div class="cardbox"><h3>${esc(f.screen)}</h3>` +
      `<div class="mrow small">Bundle: <span class="mono">${esc(f.file || "")}</span></div>` +
      `<div class="mrow small">Acción correlacionada: <b>${esc(f.request_desc || "")}</b></div>` +
      `<div class="mrow small">Endpoints cercanos:<br><span class="mono">${esc(f.endpoint || "—")}</span></div>` +
      `<div class="small muted">${esc(notes)}</div></div>`;
  }).join("") + "</div>";
}

/* ---------------- Errores ---------------- */
let errRows = [];
async function loadErrores() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/findings`);
  errRows = rows.filter(r => (r.finding_type || "").includes("ERROR") ||
    (r.finding_type || "").includes("HTTP_") || r.status && r.status !== "INFO");
  const types = [...new Set(errRows.map(r => r.finding_type))];
  $("#errChips").innerHTML = types.map(t => `<span class="chip">${esc(t)}</span>`).join("") || "";
  $("#errTable").innerHTML = findingsTable(errRows);
}
function findingsTable(rows) {
  if (!rows.length) return `<div class="cardbox"><p class="muted">Sin hallazgos de error.</p></div>`;
  return `<table class="tbl"><thead><tr><th>ID</th><th>Clase</th><th>Severidad</th><th>Tipo</th>` +
    `<th>Título</th><th>Endpoint</th><th>Confianza</th></tr></thead><tbody>` +
    rows.map(r => `<tr class="clickable" onclick="fDetail(${r.id})">` +
      `<td>${esc(r.fid)}</td><td><span class="klass ${klassOf(r.klass)}">${esc(fmtKlass(r.klass))}</span></td>` +
      `<td><span class="sev ${sevClass(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.finding_type)}</td>` +
      `<td><b>${esc(r.title)}</b></td><td class="mono small">${esc((r.endpoint || "").slice(0, 60))}</td>` +
      `<td>${esc(r.confidence)}</td></tr>`).join("") + "</tbody></table>";
}

/* ---------------- Consistencia ---------------- */
async function loadConsistencia() {
  const s = await api(`/api/audits/${state.curAudit.id}/summary`);
  const cons = (s.summary || {}).consistency || {};
  const runs = cons.runs || [];
  let html = `<div class="cardbox"><h3>Prueba de consistencia — ${runs.length} consultas GET idénticas</h3>` +
    `<p class="mono small">${esc(cons.url || "")}</p>`;
  if (!runs.length) {
    html += `<p class="muted">No ejecutada en esta auditoría.</p>`;
  } else {
    const identical = new Set(runs.filter(r => r.status === 200 && !r.error).map(r => r.sha256)).size <= 1;
    html += `<p class="${identical ? "" : "warn"}">` +
      (identical ? "✅ Todas las respuestas fueron idénticas (mismo SHA-256)." :
        "⚠ Las respuestas difirieron entre consultas — ver tabla y hallazgo RESPONSE_INCONSISTENCY.") +
      `</p><table class="tbl"><thead><tr><th>#</th><th>Hora</th><th>HTTP</th><th class="num">Bytes</th>` +
      `<th class="num">TTFB</th><th class="num">Total</th><th class="num">Registros</th>` +
      `<th class="num">Suma kgTotal</th><th>SHA-256</th></tr></thead><tbody>` +
      runs.map(r => `<tr><td>${r.n}</td><td>${esc(r.ts)}</td>` +
        `<td><span class="st ${stClass(r.status, r.error)}">${esc(r.status ?? "")}</span></td>` +
        `<td class="num">${fmtBytes(r.size)}</td><td class="num">${r.ttfb_ms ?? "—"}</td>` +
        `<td class="num">${r.total_ms ?? "—"}</td><td class="num">${r.records ?? "—"}</td>` +
        `<td class="num">${r.sum_kgTotal ?? "—"}</td><td class="mono small">${esc((r.sha256 || "").slice(0, 20))}</td></tr>`).join("") +
      `</tbody></table><p class="small muted">Nota: el sitio declara «Actualización automática»; cambios entre consultas pueden ser actividad legítima. Ver hallazgo F-03 para el detalle exacto de qué cambió.</p>`;
  }
  $("#consBox").innerHTML = html + "</div>";
}

/* ---------------- Snapshots ---------------- */
async function loadSnapshots() {
  const j = await api(`/api/audits/${state.curAudit.id}/snapshot`);
  const snap = j.snapshot, man = j.manifest || [];
  if (!snap) { $("#snapBox").innerHTML = `<div class="cardbox"><p class="muted">Sin snapshot.</p></div>`; return; }
  $("#snapBox").innerHTML = `<div class="cardbox"><h3>Snapshot ${esc(snap.dir)}</h3>` +
    `<p class="small muted">${man.length} archivos de evidencia · creado ${esc(snap.created_at)}</p>` +
    `<table class="tbl"><thead><tr><th>Archivo</th><th class="num">Bytes</th><th>SHA-256</th><th></th></tr></thead><tbody>` +
    man.map(m => `<tr><td class="mono small">${esc(m.rel)}</td><td class="num">${fmtBytes(m.size)}</td>` +
      `<td class="mono small">${esc(m.sha256)}</td>` +
      `<td><a class="dl" href="/api/files?path=snapshots/${encodeURIComponent(snap.dir)}/${encodeURIComponent(m.rel)}">descargar</a></td></tr>`).join("") +
    `</tbody></table><div class="row"><a class="btn ghost" href="/api/files?path=snapshots/${encodeURIComponent(snap.dir)}/manifest.json">⬇ manifiesto JSON</a>` +
    `<a class="btn ghost" href="/api/files?path=snapshots/${encodeURIComponent(snap.dir)}/logs/audit.log">⬇ log de auditoría</a></div></div>`;
}

/* ---------------- Hallazgos ---------------- */
let fRows = [];
let fTypes = [];
async function loadFindings() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/findings`);
  fRows = rows;
  fTypes = [...new Set(rows.map(r => r.finding_type))].sort();
  const sel = $("#fType");
  const prev = sel.value;
  sel.innerHTML = `<option value="">tipo: todos</option>` +
    fTypes.map(t => `<option ${t === prev ? "selected" : ""}>${esc(t)}</option>`).join("");
  renderFindings();
}
function renderFindings() {
  const sev = $("#fSev").value, kl = $("#fKlass").value, ty = $("#fType").value;
  const rows = fRows.filter(r =>
    (!sev || r.severity === sev) && (!kl || r.klass === kl) && (!ty || r.finding_type === ty));
  $("#fCount").textContent = `${rows.length} / ${fRows.length} hallazgos`;
  $("#fTable").innerHTML = findingsTable(rows);
}
async function fDetail(id) {
  const r = fRows.find(x => x.id === id);
  if (!r) return;
  openModal(`<h2>${esc(r.fid)} · ${esc(r.title)}</h2>` +
    `<div class="mrow"><span class="klass ${klassOf(r.klass)}">${esc(fmtKlass(r.klass))}</span> ` +
    `<span class="sev ${sevClass(r.severity)}">${esc(r.severity)}</span> ` +
    `<span class="chip">${esc(r.finding_type)}</span> <span class="chip">confianza: ${esc(r.confidence)}</span></div>` +
    `<p class="small">${esc(r.description)}</p>` +
    (r.evidence ? `<p class="small mono">evidencia: ${esc(r.evidence)}</p>` : "") +
    (r.file || r.endpoint ? `<p class="small mono">archivo: ${esc(r.file || "—")} · endpoint: ${esc(r.endpoint || "—")}</p>` : "") +
    (r.recommendation ? `<label>Recomendación</label><p class="small">${esc(r.recommendation)}</p>` : "") +
    `<div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}

/* ---------------- Evidencias ---------------- */
async function loadEvidencias() {
  const { rows } = await api(`/api/audits/${state.curAudit.id}/tab/evidence`);
  const snap = await api(`/api/audits/${state.curAudit.id}/snapshot`);
  const dir = snap.snapshot ? snap.snapshot.dir : "";
  $("#evTable").innerHTML = `<thead><tr><th>#</th><th>Archivo</th><th>Categoría</th>` +
    `<th class="num">Bytes</th><th>SHA-256</th><th>URL origen</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r.id}</td><td class="mono small">${esc(r.path)}</td>` +
      `<td>${esc(r.category)}</td><td class="num">${fmtBytes(r.size)}</td>` +
      `<td class="mono small">${esc((r.sha256 || "").slice(0, 24))}…</td>` +
      `<td class="mono small">${esc((r.url || "").slice(0, 90))}</td>` +
      `<td>${dir ? `<a class="dl" href="/api/files?path=snapshots/${encodeURIComponent(dir)}/${encodeURIComponent(r.path)}">⬇</a>` : ""}</td></tr>`).join("") +
    `</tbody></table>`;
}

/* ---------------- Informes ---------------- */
async function loadInformes() {
  const { reports } = await api(`/api/audits/${state.curAudit.id}/report_latest`);
  $("#repTableBox").innerHTML = `<div class="cardbox"><h3>Informes generados</h3>` +
    (reports.length ? `<table class="tbl"><thead><tr><th>Tipo</th><th>Archivo</th><th>Fecha</th><th></th></tr></thead><tbody>` +
      reports.map(r => `<tr><td><span class="chip">${esc(r.kind)}</span></td>` +
        `<td class="mono small">${esc(r.path)}</td><td class="small">${esc(r.created_at)}</td>` +
        `<td><a class="dl" href="/api/files?path=${encodeURIComponent(r.path)}">descargar</a></td></tr>`).join("") +
      `</tbody></table>` : `<p class="muted">Todavía no hay informes.</p>`) + `</div>`;
}

async function generateReport() {
  if (!state.curAudit) return status("Selecciona una auditoría primero", true);
  const btn = $("#btnGenReport");
  $("#genMsg").innerHTML = "";
  if (btn) btn.disabled = true;
  status("Generando informe HTML + JSON + PDF…");
  try {
    const res = await api(`/api/audits/${state.curAudit.id}/report`, {
      method: "POST", body: JSON.stringify({ pdf: true }),
    });
    status("Informe generado ✓");
    $("#genMsg").innerHTML = `<p class="small">HTML: <span class="mono">${esc(res.html)}</span><br>` +
      `JSON: <span class="mono">${esc(res.json)}</span><br>` +
      (res.pdf ? `PDF: <span class="mono">${esc(res.pdf)}</span>` :
        `<span class="warn">${esc(res.pdf_note || "PDF omitido")}</span>`) + `</p>`;
    if (res.pdf) {
      const a = document.createElement("a");
      a.href = "/api/files?path=" + encodeURIComponent(res.pdf);
      a.download = res.pdf.split("/").pop();
      document.body.appendChild(a); a.click(); a.remove();
    }
    await loadInformes();
  } catch (e) { status("Informe: " + e.message, true); }
  if (btn) btn.disabled = false;
}

/* ==================== modales de acción ==================== */
function openModal(html) {
  $("#modalBox").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }

function openNewAuditModal() {
  openModal(`<h2>Nueva auditoría / proyecto</h2>
    <label>Nombre del proyecto</label><input id="mName" class="inp" style="width:100%" value="PROAGRO">
    <label>URL pública a analizar</label><input id="mUrl" class="inp" style="width:100%"
      value="https://digital.proagro.pe/QrKgAra/QrKgAra">
    <div class="actions">
      <button class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveNewAudit()">Crear proyecto</button>
    </div>`);
}
async function saveNewAudit() {
  const name = $("#mName").value.trim() || "PROAGRO";
  const url = $("#mUrl").value.trim();
  try {
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name, url }) });
    closeModal();
    await loadProjects();
    status("Proyecto listo — pulsa ▶ ANALIZAR para la primera auditoría");
  } catch (e) { status("Error: " + e.message, true); }
}

function openAnalyzeModal() {
  if (!state.curProject) return status("Crea un proyecto primero", true);
  if (state.auditRunning) return status("Ya hay una auditoría en ejecución", true);
  const today = hoyLocalISO();
  openModal(`<h2>▶ Analizar — auditoría read-only</h2>
    <p class="small muted">Proyecto: <b>${esc(state.curProject.name)}</b> — ${esc(state.curProject.url)}</p>
    <div class="mrow"><input type="checkbox" id="mBrowser"><label for="mBrowser" style="margin:0">Capturar con navegador real (Chromium/Playwright): red, console.error, pageerrors</label></div>
    <div class="grid2">
      <div><label>Fecha inicial (rango ranking)</label><input id="mIni" class="inp" style="width:100%" value="2026-09-01">
      <label>Fecha final</label><input id="mFin" class="inp" style="width:100%" value="2026-09-03"></div>
      <div><label>Top de registros</label><input id="mTop" class="inp" style="width:100%" value="5000">
      <label>Consultas de consistencia (1-10)</label><input id="mCons" class="inp" style="width:100%" value="5"></div>
    </div>
    <p class="small muted">⚠ Volumen controlado (≈15–40 GET). Nunca envía formularios ni modifica datos.</p>
    <div class="actions">
      <button class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="startAudit()">▶ Iniciar análisis</button>
    </div>`);
}
async function startAudit() {
  const body = {
    project_id: state.curProject.id,
    browser: $("#mBrowser").checked,
    fechaIni: $("#mIni").value, fechaFin: $("#mFin").value,
    top: parseInt($("#mTop").value || "5000", 10),
    consistency_n: Math.min(10, Math.max(1, parseInt($("#mCons").value || "5", 10))),
  };
  closeModal();
  try {
    const { id } = await api("/api/audits", { method: "POST", body: JSON.stringify(body) });
    state.auditRunning = id;
    setRunning(true, "Auditoría #" + id + " en ejecución (read-only)…");
    await syncStatus();
  } catch (e) { status("No se pudo iniciar: " + e.message, true); }
}

async function syncStatus() {
  if (staticMode) return;
  if (!state.auditRunning) return;
  try {
    const st = await api(`/api/audits/${state.auditRunning}/status`);
    const p = st.progress || "";
    $("#statusRight").textContent = p ? "paso: " + p : "";
    if (st.status === "running") {
      status("Auditoría en ejecución — " + p + (st.detail ? " · " + st.detail : ""));
      setRunning(true);
    } else {
      $("#statusRight").textContent = "";
      setRunning(false);
      state.auditRunning = null;
      const done = st.status === "done";
      status(done ? "Auditoría completada ✓ (revisa las pestañas)" : "Auditoría con error: " + (st.error || ""), !done);
      state.curAudit = null;
      await loadAudits();
      if (state.curAudit) await loadTab("resumen");
    }
  } catch (e) { /* backend reiniciándose */ }
}

async function showLogModal() {
  if (!state.curAudit) return;
  const st = await api(`/api/audits/${state.curAudit.id}/status`);
  openModal(`<h2>Log de auditoría #${state.curAudit.id}</h2>` +
    `<pre class="log">${esc((st.log || []).join("\n")) || "—"}</pre>` +
    `<div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}

function openConcurrencyModal() {
  if (!state.audits.some(a => a.status === "done"))
    return status("Ejecuta primero una auditoría normal", true);
  openModal(`<h2>Prueba de concurrencia — SOLO LECTURA</h2>
    <p class="muted">Lanza <b>N consultas GET simultáneas</b> a ObtenerRankingVista para observar
    comportamiento bajo carga ligera. Opcional y nunca automática.</p>
    <label>Solicitudes simultáneas (máx. 20)</label>
    <select id="mLevel" class="inp" style="width:100%">
      <option>1</option><option selected>3</option><option>5</option>
      <option>10</option><option>20</option>
    </select>
    <p class="small" style="color:var(--warn)">Se anexarán los resultados a la última auditoría finalizada.</p>
    <div class="actions">
      <button class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn primary warn" onclick="runConcurrency()">Ejecutar prueba</button>
    </div>`);
}
async function runConcurrency() {
  const level = parseInt($("#mLevel").value, 10);
  closeModal();
  setRunning(true, "Prueba de concurrencia (" + level + " GET)…");
  try {
    const res = await api("/api/concurrency", {
      method: "POST", body: JSON.stringify({ project_id: state.curProject.id, level }),
    });
    setRunning(false);
    const ok = res.results.filter(r => r.status === 200 && !r.error).length;
    status(`Concurrencia: ${ok}/${res.level} OK` + (res.errors.length ? ` · ${res.errors.length} con error` : ""));
    const ttl = res.results.map(r => r.total_ms || 0);
    openModal(`<h2>Resultado concurrencia (${res.level} GET)</h2>
      <p class="small">URL: <span class="mono">${esc(res.url)}</span></p>
      <table class="tbl"><thead><tr><th>#</th><th>Hora</th><th>HTTP</th><th class="num">Bytes</th>
      <th class="num">TTFB ms</th><th class="num">Total ms</th><th>Error</th></tr></thead><tbody>` +
      res.results.map(r => `<tr><td>${r.n}</td><td>${esc(r.ts)}</td>` +
        `<td><span class="st ${stClass(r.status, r.error)}">${esc(r.status ?? "")}</span></td>` +
        `<td class="num">${fmtBytes(r.size)}</td><td class="num">${r.ttfb_ms}</td>` +
        `<td class="num">${r.total_ms}</td><td class="small">${esc((r.error || "").slice(0, 50))}</td></tr>`).join("") +
      `</tbody></table>` +
      `<p class="small muted">mín ${Math.min(...ttl).toFixed(0)} ms · máx ${Math.max(...ttl).toFixed(0)} ms · media ${(ttl.reduce((a, b) => a + b, 0) / ttl.length).toFixed(0)} ms</p>` +
      `<div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
  } catch (e) {
    setRunning(false);
    status("Concurrencia: " + e.message, true);
  }
}

/* ========================= QR → KG ========================= */
let qrkgBoundFlag = false;
const qrState = { stream: null, timer: null, raf: null, busy: false };
let qrAudioCtx = null;
let qrUltimoBeep = 0;

function puertoHttpsSugerido() {
  // Usa la config real del servidor (/api/health) si está disponible.
  if (cfg && cfg.https_on && cfg.https_port) return String(cfg.https_port);
  const p = parseInt(location.port || "80", 10);
  return String((p && p < 65535) ? p + 1 : 443);
}
function httpsDisponible() { return !!(cfg && cfg.https_on && cfg.https_port); }
function metSw(qr) {
  const m1 = $("#metDni"), m2 = $("#metQr"), b1 = $("#metDniBox"), b2 = $("#metQrBox");
  if (m1) m1.classList.toggle("active", !qr);
  if (m2) m2.classList.toggle("active", qr);
  if (b1) b1.classList.toggle("hidden", qr);
  if (b2) b2.classList.toggle("hidden", !qr);
}
async function probarWorker() {
  const w = (workerUrl || "").trim();
  const st = $("#workerState");
  if (!w) { if (st) { st.textContent = "☁️ sin URL"; st.className = "chip warn"; } return; }
  if (st) { st.textContent = "probando…"; st.className = "chip"; }
  const hoy = hoyLocalISO();
  let h = false, r = false, c = "—";
  try {
    const hr = await fetch(w + "/health"); h = hr.ok;
    const rr = await fetch(w + "/api/ranking?top=1&fechaIni=" + hoy + "&fechaFin=" + hoy); r = rr.ok;
    const cr = await fetch(w + "/api/cosecha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dni: "00000000", fechaIni: hoy, fechaFin: hoy }) });
    c = cr.status === 404 ? "❌ falta /api/cosecha" : (cr.status === 400 || cr.ok ? "✅ ok" : "❌ HTTP " + cr.status);
  } catch (e) { h = r = false; c = "📡 sin conexión"; }
  const okTodo = h && r && c.indexOf("✅") === 0;
  if (st) {
    st.textContent = okTodo ? "✅ Worker listo" : "health " + (h ? "✅" : "❌") + " · ranking " + (r ? "✅" : "❌") + " · cosecha " + c;
    st.className = "chip " + (okTodo ? "ok" : "warn");
  }
}

async function dashFecha() {
  const val = $("#dashFecha") ? $("#dashFecha").value : "";
  const f = val || hoyLocalISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoyLocalISO()) { dashMsg("Elige una fecha válida (hoy o anterior).", true); return; }
  const d = ($("#dashDniInp").value || dashDni || "").trim();
  if (!/^\d{8}$/.test(d)) { dashMsg("Escribe o escanea primero el DNI (8 dígitos).", true); return; }
  dashDni = d;
  qrSetDatos(d, f);
  dashMsg("Consultando FECHA " + dashFmt(f) + "…");
  const dia = await dashPeriodo(dashDni, [f]);
  if (dia.err) { dashMsg(dia.err, true); return; }
  const prev = await dashPeriodo(dashDni, [dashSum(f, -1)]);
  const base = prev && !prev.err && prev.rows.length && prev.rows[0].estado === "ok" ? { kg: prev.rows[0].kg, label: "día anterior" } : null;
  dashRender("📅 FECHA " + dashFmt(f), dia.rows, base && base.kg, base && base.label, "dia");
  dashMsg("Listo — FECHA " + dashFmt(f) + " con datos reales.");
}

function qrkgBind() {
  if (qrkgBoundFlag) return;
  qrkgBoundFlag = true;
  const L = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  L("#btnQrCamera", qrStartCamera);
  L("#btnScanClose", qrCerrarCamara);
  L("#btnScanUpload", () => qrOpenFile(false));
  L("#btnScanTake", () => qrOpenFile(true));
  L("#btnQrUpload", () => qrOpenFile(false));
  L("#btnQrTake", () => qrOpenFile(true));
  L("#btnQrDebug", qrDebug);
  L("#metDni", () => metSw(false));
  L("#metQr", () => metSw(true));
  const wc = $("#workerCfg");
  if (wc) wc.classList.toggle("hidden", !staticMode);
  const wi = $("#workerUrlInp");
  if (wi) wi.value = workerUrl;
  L("#btnWorkerSave", () => {
    const v = ($("#workerUrlInp").value || "").trim();
    workerUrl = v;
    try { if (v) localStorage.setItem("pwf_worker", v); else localStorage.removeItem("pwf_worker"); } catch (e) { }
    const m = $("#dashMsg");
    if (m) { m.textContent = v ? "Worker guardado (" + v + "). Pulsa 📅 HOY o 🌾 ESTA SEMANA." : "Worker quitado: las consultas a PROAGRO usarán el intento directo (CORS)."; m.className = "qrmsg"; }
  });
  L("#btnDashHoy", dashHoy);
  L("#btnDashSemana", dashSemana);
  L("#btnDashFecha", () => dashFecha());
  const dfIn = $("#dashFecha");
  if (dfIn) dfIn.value = dfIn.value || hoyLocalISO();
  L("#btnWorkerTest", () => probarWorker());
  L("#btnWorkerClear", () => {
    workerUrl = "";
    try { localStorage.removeItem("pwf_worker"); } catch (e) { }
    const wi2 = $("#workerUrlInp"); if (wi2) wi2.value = "";
    const st2 = $("#workerState"); if (st2) { st2.textContent = ""; st2.className = "chip"; }
    dashMsg("Configuración del Worker limpiada.");
  });
  const st = $("#workerState");
  if (st) st.textContent = workerUrl ? "🌩️ " + workerUrl : "";
  L("#btnWhoAplicar", async () => {
    const d = ($("#dashDniInp").value || "").trim();
    if (!/^\d{8}$/.test(d)) { dashMsg("Escribe un DNI de 8 dígitos.", true); return; }
    dashDni = d;
    dashSyncDni();
    await dashHoy();
  });
  L("#qrFileInput", qrFileChosen);
  L("#btnHisClear", async () => {
    if (!confirm("¿Eliminar todo el historial local de consultas?")) return;
    try { await fetch("/api/kg-queries", { method: "DELETE" }); await qrkgRefreshHistory(); } catch (e) { status("No se pudo limpiar: " + e.message, true); }
  });
  dashSyncDni();
}
function qrMsg(msg, err = false) {
  const el = $("#qrMsg");
  if (el) { el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)"; }
  const ss = $("#scanStatus");
  if (ss && !$("#scanModal").classList.contains("hidden")) {
    ss.textContent = msg;
    ss.className = "scanstatus" + (err ? " err" : "");
  }
}
function qrScan(msg, err = false) {
  const ss = $("#scanStatus");
  if (ss) { ss.textContent = msg; ss.className = "scanstatus" + (err ? " err" : ""); }
}
function qrHideCard() {
  const c = $("#qrContentCard");
  if (c) c.classList.add("hidden");
  const b = $("#qrResultBox");
  if (b) b.innerHTML = "";
}
function qrSetDatos(dni, fecha) {
  if (/^\d{8}$/.test(dni)) {
    dashDni = dni;
    try { localStorage.setItem("pwf_dni", dni); } catch (e) { }
    const inp = $("#dashDniInp");
    if (inp) inp.value = dni;
  }
  dashSyncDni();
}

async function qrStartCamera() {
  if (qrState.busy) return;
  qrHideCard();
  $("#scanModal").classList.remove("hidden");
  qrScan("Abriendo cámara…");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const razon = !window.isSecureContext
      ? "Contexto NO seguro (HTTP sobre IP LAN). La cámara exige HTTPS."
      : "Este navegador no expone getUserMedia.";
    let sugiere;
    if (!window.isSecureContext && location.protocol === "http:" && httpsDisponible())
      sugiere = " Entra por https://" + location.hostname + ":" + puertoHttpsSugerido() + " o usa";
    else if (!window.isSecureContext && location.protocol === "http:")
      sugiere = " Este servidor no tiene HTTPS activado (pídelo: HTTPS_PORT=3793) o usa";
    else
      sugiere = " Usa";
    qrScan("CÁMARA NO DISPONIBLE: " + razon + sugiere + " 📸 TOMAR FOTO / 📁 SUBIR IMAGEN.", true);
    qrState.busy = false;
    return;
  }
  qrState.busy = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    qrState.stream = stream;
    const video = $("#qrVideo");
    video.srcObject = stream;
    await video.play();
    qrScan("Enfoca el QR dentro del recuadro… (usa la cámara trasera)");
    qrLoopDetect();
  } catch (e) {
    qrState.busy = false;
    const nombre = (e && e.name) || "error";
    qrScan("No se pudo abrir la cámara (" + nombre + "): " +
      (e && e.message ? e.message : e) +
      " — Alternativas: 📸 TOMAR FOTO / 📁 SUBIR IMAGEN. Si es NotAllowedError, concede el permiso de cámara.", true);
  }
}
function qrCerrarCamara() {
  if (qrState.stream) {
    qrState.stream.getTracks().forEach(t => t.stop());
    qrState.stream = null;
  }
  if (qrState.timer) { clearInterval(qrState.timer); qrState.timer = null; }
  if (qrState.raf) { cancelAnimationFrame(qrState.raf); qrState.raf = null; }
  const m = $("#scanModal");
  if (m) m.classList.add("hidden");
  qrState.busy = false;
}
function qrStopCamera() { qrCerrarCamara(); }
function qrLoopDetect() {
  const video = $("#qrVideo"), canvas = $("#qrCanvas");
  const W = 640;
  canvas.width = W;
  canvas.height = Math.round(W * video.videoHeight / Math.max(1, video.videoWidth));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  qrState.timer = setInterval(() => {
    if (!qrState.stream) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height);
      if (code && code.data) qrProcesarTexto(code.data);
    } catch (e) { /* fotograma no disponible todavía */ }
  }, 300);
}

async function qrDebug() {
  let camPerm = "desconocido";
  try {
    const st = await navigator.permissions.query({ name: "camera" });
    camPerm = st.state;
  } catch (e) { /* API no disponible */ }
  let camaras = [];
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices();
      camaras = devs.filter(d => d.kind === "videoinput")
        .map(d => d.label || "(sin etiqueta — concede permiso de cámara para verla)");
    }
  } catch (e) { camaras = ["error enumerando: " + e.message]; }
  let salud = "—";
  try { salud = JSON.stringify(await api("/api/health")); } catch (e) { salud = "error: " + e.message; }
  let ultima = window._qrUltimaRespuesta;
  const u = ultima && ultima.meta;
  const line = (k, v) => `<div class="mrow small"><b>${esc(k)}:</b> <span class="mono">${esc(v)}</span></div>`;
  openModal(`<h2>🔧 DEBUG</h2>
    ${line("URL actual", location.href)}
    ${line("Contexto seguro (HTTPS/localhost)", String(window.isSecureContext))}
    ${line("mediaDevices", String(!!navigator.mediaDevices))}
    ${line("getUserMedia", String(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)))}
    ${line("Permiso cámara", camPerm)}
    ${line("Cámaras encontradas", camaras.length ? camaras.join(" · ") : "ninguna")}
    ${line("Navegador", navigator.userAgent.slice(0, 110))}
    ${line("Servidor local (/api/health)", salud)}
    <h3>Última consulta</h3>
    ${ultima ? line("Endpoint", (u.endpoint || "") + " · " + (u.method || "")) +
      line("HTTP / tiempo", (u.http_status ?? "—") + " / " + (u.elapsed_ms != null ? u.elapsed_ms + " ms" : "—")) +
      line("Estado", ultima.estado || "") +
      line("Parámetros", JSON.stringify(u.params || {})) : "<p class='muted small'>Aún no has consultado.</p>"}
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
function qrOpenFile(tomar) {
  const inp = $("#qrFileInput");
  if (tomar) inp.setAttribute("capture", "environment");
  else inp.removeAttribute("capture");
  inp.value = "";
  inp.click();
}
function qrFileChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  qrMsg("Leyendo imagen…");
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const max = 1600;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const imgd = ctx.getImageData(0, 0, w, h);
      const code = window.jsQR(imgd.data, w, h);
      if (code && code.data) { qrProcesarTexto(code.data); }
      else qrMsg("No se encontró ningún QR en la imagen. Prueba otra foto más nítida.", true);
    };
    img.onerror = () => qrMsg("No se pudo leer la imagen.", true);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function qrProcesarTexto(texto) {
  qrStopCamera();
  qrBeep("ok");
  qrHablar("QR detectado");
  const parsed = (window.parseQrContent || (t => ({ dni: null, fecha: null, fechaIso: null, campos: [], texto: t })))(texto);
  const dni = parsed.dni || "";
  if (!/^\d{8}$/.test(dni)) {
    qrMsg("QR leído pero no se encontró un DNI de 8 dígitos. Revisa el código o usa 👤 DNI.", true);
    return;
  }
  dashDni = dni;
  const inp = $("#dashDniInp");
  if (inp) inp.value = dni;
  qrMsg("QR leído — DNI " + dni + " listo. Mostrando tu cosecha…");
  dashSyncDni();
  setTimeout(() => { if (/^\d{8}$/.test(dashDni)) dashHoy().catch(() => {}); }, 250);
}

/* --- sonido y voz (confirmación al escanear/resultados) --- */
function qrBeep(kind) {
  // evita sonidos repetidos (máx. 1 cada 700 ms)
  const ahora = Date.now();
  if (ahora - qrUltimoBeep < 700) return;
  qrUltimoBeep = ahora;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!qrAudioCtx) qrAudioCtx = new AC();
    if (qrAudioCtx.state === "suspended") qrAudioCtx.resume();
    const t0 = qrAudioCtx.currentTime;
    const tablas = {
      ok: [[1318, 0, .09], [1760, .1, .13]],
      datos: [[880, 0, .09], [1174.7, .11, .14]],
      nodatos: [[440, 0, .16], [330, .18, .2]],
      error: [[220, 0, .15], [180, .18, .2]],
    };
    const notas = tablas[kind] || tablas.ok;
    notas.forEach(n => {
      const o = qrAudioCtx.createOscillator();
      const g = qrAudioCtx.createGain();
      o.type = "sine";
      o.frequency.value = n[0];
      const t1 = t0 + n[1];
      g.gain.setValueAtTime(0.0001, t1);
      g.gain.exponentialRampToValueAtTime(0.22, t1 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t1 + n[2]);
      o.connect(g);
      g.connect(qrAudioCtx.destination);
      o.start(t1);
      o.stop(t1 + n[2] + 0.02);
    });
  } catch (e) { /* audio no disponible */ }
}
function qrHablar(texto) {
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-PE";
      u.rate = 1.05;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  } catch (e) { /* voz no disponible */ }
}

/* --- fechas (aritmética sin zonas horarias) --- */
function isoRestar(iso, dias) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dias);
  return dt.toISOString().slice(0, 10);
}
function fmtFechaISO(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return d + "/" + m + "/" + y;
}
function normFechaISO(v) {
  v = String(v || "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return null;
}
/* --- consultas por rangos de fecha (un solo POST por rango, como hace PROAGRO) --- */
async function qrRangoClick(boxSel, dniSel, fechaSel, titulo, desde, hasta) {
  const dni = ($(dniSel).value || "").trim();
  if (!/^\d{8}$/.test(dni)) { qrMsg("Escanea/ingresa primero un DNI de 8 dígitos.", true); return; }
  const base = $(fechaSel).value || hoyLocalISO();
  // días pedidos: base-1 … base-N (anteriores a la fecha base)
  const fechas = [];
  for (let k = desde; k <= hasta; k++) fechas.push(isoRestar(base, k));
  fechas.sort(); // ascendente para el rango (fechaIni <= fechaFin)
  const ini = fechas[0], fin = fechas[fechas.length - 1];
  await qrConsultaRango(boxSel, titulo, dni, base, fechas, ini, fin);
}

async function qrConsultaRango(boxSel, titulo, dni, base, fechasAsc, ini, fin) {
  const box = $(boxSel);
  if (!box) return;
  const cont = document.createElement("div");
  cont.className = "rcard";
  cont.dataset.titulo = titulo;
  cont.innerHTML = `<div class="rtitle">📅 ${esc(titulo)} · DNI <b class="mono">${esc(dni)}</b> · base ${esc(fmtFechaISO(base))}</div>
    <div class="rday"><div class="fecha">🔎 CONSULTANDO…</div></div>`;
  // reemplaza la tarjeta anterior del mismo botón (resultado inmediato bajo el botón)
  const previo = box.querySelector(`.rcard[data-titulo="${CSS.escape ? CSS.escape(titulo) : titulo}"]`);
  if (previo) previo.remove();
  box.prepend(cont);
  try {
    const resp = await fetch("/api/consultar-kg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, fechaIni: ini, fechaFin: fin }),
    });
    const j = await resp.json().catch(() => ({}));
    qrRenderRango(cont, j, dni, fechasAsc);
    window._qrUltimaRespuesta = j;
    await qrkgRefreshHistory();
  } catch (e) {
    cont.innerHTML = `<div class="rtitle">📅 ${esc(titulo)} · DNI ${esc(dni)}</div>
      <div class="rday err"><div class="kg">🌐 ERROR DE CONEXIÓN</div>
      <div>No se pudo conectar con el servidor local: ${esc(e.message)}</div></div>`;
    qrBeep("error");
  }
}

function qrEstadoGlobal(j) {
  const m = j.meta || {};
  if (m.error) return { tipo: "error", txt: "🌐 ERROR DE CONEXIÓN", det: m.error };
  if (m.http_status && m.http_status !== 200)
    return { tipo: "error", txt: "❌ ERROR DE CONSULTA", det: "PROAGRO respondió HTTP " + m.http_status };
  if ((j.resultado || {}).json_ok === false)
    return { tipo: "error", txt: "❌ RESPUESTA INESPERADA", det: "La respuesta no tiene el formato esperado." };
  if ((j.resultado || {}).encontrado === false) return { tipo: "nodatos", txt: "⚠️ NO HAY DATOS", det: "" };
  if (j.estado === "SIN_DATOS") return { tipo: "nodatos", txt: "⚠️ NO HAY DATOS", det: "" };
  return { tipo: "ok", txt: "", det: "" };
}

function qrRenderRango(cont, j, dni, fechasAsc) {
  const r = (j.resultado || {});
  const global = qrEstadoGlobal(j);
  const nums = r.nums || {};
  const req = j.consulta || {};
  let html = `<div class="rtitle">📅 ${esc(cont.dataset.titulo)} · DNI <b class="mono">${esc(dni)}</b>` +
    ` · consultado ${esc(fmtFechaISO(req.fechaIni))} → ${esc(fmtFechaISO(req.fechaFin))}` +
    ` · ${esc(j.estado)} · HTTP ${esc((j.meta || {}).http_status ?? "—")} · ${Math.round((j.meta || {}).elapsed_ms || 0)} ms</div>`;

  const fechasDesc = fechasAsc.slice().reverse();
  const diasResp = Array.isArray(r.dias) ? r.dias : [];
  // índice por fecha si la respuesta etiqueta cada día
  const porFecha = {};
  let sinEtiqueta = [];
  diasResp.forEach(d => {
    const f = normFechaISO(d && d.fecha);
    if (f) porFecha[f] = d;
    else sinEtiqueta.push(d);
  });
  const hayEtiquetas = diasResp.length > 0 && sinEtiqueta.length < diasResp.length;
  let conDatos = 0;
  if (global.tipo === "error") {
    html += `<div class="rday err"><div class="kg">${esc(global.txt)}</div><div>${esc(global.det)}</div>
      <div class="small muted">No se puede distinguir 'sin datos' cuando la consulta falla. Revisa 🔬 la respuesta.</div></div>`;
  } else {
    fechasDesc.forEach((f) => {
      let dia = porFecha[f];
      // si la respuesta no trae fecha por día, asigna por posición (ascendente)
      if (!dia && !hayEtiquetas && sinEtiqueta.length) dia = sinEtiqueta.shift();
      const items = (dia && Array.isArray(dia.items)) ? dia.items : [];
      const nreg = (dia && dia.registros) || items.length || 0;
      if (items.length) {
        let s = { kgExportable: 0, kgDescarte: 0, kgTotal: 0 };
        items.forEach(it => {
          ["kgExportable", "kgDescarte", "kgTotal"].forEach(k => {
            const v = parseFloat(it[k]);
            if (isFinite(v)) s[k] += v;
          });
        });
        s = { kgExportable: +s.kgExportable.toFixed(2), kgDescarte: +s.kgDescarte.toFixed(2), kgTotal: +s.kgTotal.toFixed(2) };
        conDatos++;
        let principal = s.kgTotal > 0 ? { v: s.kgTotal, l: "TOTAL" } : s.kgExportable > 0 ? { v: s.kgExportable, l: "EXPORTABLE" } : s.kgDescarte > 0 ? { v: s.kgDescarte, l: "DESCARTE" } : { v: 0, l: "KG" };
        const etiquetas = { hora: "Hora", variedad: "Variedad", variedadDesc: "Variedad", lote: "Lote", loteDesc: "Lote", cuadrilla: "Cuadrilla", grupo: "Grupo", jefe: "Jefe", registro: "Registro" };
        const extras = [];
        Object.keys(etiquetas).forEach(k => {
          if (extras.length < 3) {
            const v = items.map(it => it[k]).find(x => x != null && x !== "");
            if (v != null) extras.push(esc(etiquetas[k]) + ": <b>" + esc(v) + "</b>");
          }
        });
        html += `<div class="rday ok"><div class="fecha">✅ ${esc(fmtFechaISO(f))} · ${nreg} registro(s)</div>` +
          `<div class="kg">⚖️ ${principal.v} KG <span class="small muted">(${principal.l})</span></div>` +
          (s.kgExportable || s.kgDescarte ? `<div class="small muted">exportable ${s.kgExportable} · descarte ${s.kgDescarte}</div>` : "") +
          (extras.length ? `<div class="small">${extras.join(" · ")}</div>` : "") +
          `</div>`;
      } else {
        html += `<div class="rday nodatos"><div class="fecha">${esc(fmtFechaISO(f))}</div>` +
          `<div class="kg">⚠️ NO HAY DATOS</div>` +
          `<div class="small muted">No se encontraron registros para esta persona en esta fecha.</div></div>`;
      }
    });
    if (!hayEtiquetas && sinEtiqueta.length) {
      // días con datos cuya fecha no venía etiquetada
      sinEtiqueta.forEach(d => {
        const items = (d && Array.isArray(d.items)) ? d.items : [];
        html += `<div class="rday ok"><div class="fecha">✅ Día con datos (fecha no etiquetada en la respuesta)</div>` +
          `<div class="kg">${items.length} registro(s)</div></div>`;
      });
    }
  }
  const total = nums.kgTotal > 0 ? nums.kgTotal : (nums.kgExportable > 0 ? nums.kgExportable : nums.kgDescarte);
  if (conDatos > 0) {
    const et = nums.kgTotal > 0 ? "kgTotal" : nums.kgExportable > 0 ? "kgExportable" : "kgDescarte";
    html += `<div class="rtotal">TOTAL DEL PERÍODO (solo días con datos): <span class="kg">⚖️ ${esc(nums[et])} KG</span>` +
      (nums.kgExportable || nums.kgDescarte ? ` <span class="small muted">(exportable ${nums.kgExportable} · descarte ${nums.kgDescarte})</span>` : "") + `</div>`;
  }
  cont.innerHTML = html;
  if (global.tipo === "error") qrBeep("error");
  else if (conDatos > 0) qrBeep("datos");
  else qrBeep("nodatos");
}

/* ============================================================
   📊 MI COSECHA — dashboard con datos REALES del endpoint
   Reglas (documentadas, sin valores aleatorios):
   · Carita por barra: compara el día contra el último día ANTERIOR
     CON DATOS.  dif >= +10% -> 😊 (verde) · dif <= -10% -> 😞 (rojo)
     · resto -> 😐 (amarillo).  Sin día previo con datos -> 😐.
   · Variación del período: compara el promedio por día-con-datos
     del período actual contra el MISMO número de días calendario
     inmediatamente anteriores (mismos umbrales +10/-10).
   · TOTAL  = suma de KG REALES recibidos (nunca suma días sin datos).
   · PROMEDIO = TOTAL / nº de días CON datos (los días sin datos no
     cuentan como 0: eso falsearía el promedio).
   ============================================================ */
const DASH_DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DASH_UMBRAL = { sube: 0.10, baja: -0.10 };
let dashDni = "";   // DNI activo (llega del QR o de la consulta manual)

function dashFmt(iso) { const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y; }
function dashSum(iso, k) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + k);
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}
function dashDiasSemana() {
  // La semana de PROAGRO: LUNES a SÁBADO. DOMINGO nunca se muestra.
  const hoy = new Date();
  const hoyIso = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
  const monIdx = (hoy.getDay() + 6) % 7;          // Lun=0 … Dom=6
  const lunes = dashSum(hoyIso, -monIdx);
  let fin = hoyIso;
  if (monIdx === 6) fin = dashSum(hoyIso, -1);     // domingo -> hasta sábado
  const dias = [];
  for (let d = lunes; d <= fin; d = dashSum(d, 1)) dias.push(d);
  return dias;
}
function dashNum(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
function dashKgDia(items) {
  // KG reales del día: kgTotal si la fila lo trae; si no, kgExportable+kgDescarte.
  let t = 0;
  for (const it of (items || [])) {
    const tot = dashNum(it.kgTotal);
    if (tot != null) { t += tot; continue; }
    const ex = dashNum(it.kgExportable) || 0, de = dashNum(it.kgDescarte) || 0;
    t += ex + de;
  }
  return t;
}
function dashCara(pct) {
  if (pct == null) return { f: "😐", c: "est" };
  if (pct >= DASH_UMBRAL.sube) return { f: "😊", c: "ok" };
  if (pct <= DASH_UMBRAL.baja) return { f: "😞", c: "err" };
  return { f: "😐", c: "est" };
}
function dashEstado(pct) {
  if (pct == null) return { face: "😐", cls: "est", txt: "Inicio" };
  if (pct >= 0.30) return { face: "😊", cls: "ok", txt: "Excelente" };
  if (pct >= 0.10) return { face: "😊", cls: "ok", txt: "Bueno" };
  if (pct <= -0.10) return { face: "😞", cls: "err", txt: "Bajo" };
  return { face: "😐", cls: "est", txt: "Estable" };
}
function dashPctTxt(pct) {
  if (pct == null) return "—";
  return (pct >= 0 ? "▲ +" : "▼ ") + (pct * 100).toFixed(1) + "%";
}
async function dashConsultar(dni, ini, fin) {
  let j;
  if (staticMode) {
    j = await apiProagroDirecta({ dni, fechaIni: ini, fechaFin: fin });
  } else {
    const resp = await fetch("/api/consultar-kg", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, fechaIni: ini, fechaFin: fin }),
    });
    j = await resp.json().catch(() => ({}));
  }
  if (j && j.resultado && j.resultado.nombre) alistaNombre(dni, j.resultado.nombre);
  return j;
}
async function dashPeriodo(dni, dias) {
  // dias: lista ISO asc. Una consulta por rango (así lo hace PROAGRO:
  // ConsultarKgVista con fechaIni..fechaFin devuelve dias[].detalle[]).
  const j = await dashConsultar(dni, dias[0], dias[dias.length - 1]);
  const m = j.meta || {};
  if (j && j.resultado && j.resultado.nombre) alistaNombre(dni, j.resultado.nombre);
  if (j.estado === "CORS" || j.estado === "WORKER") return { err: j.error || "CORS", tipoErr: "consulta" };
  if (!j || j.estado === "VALIDACION") return { err: j && j.error || "DNI inválido", tipoErr: "validacion" };
  if (String(j.estado).startsWith("HTTP") || (m.http_status && m.http_status >= 400))
    return { err: "ERROR DE CONSULTA (HTTP " + (m.http_status ?? "?") + ")", tipoErr: "consulta" };
  if (j.estado === "ERR_CONEXION" || j.error) return { err: "SIN CONEXIÓN", tipoErr: "conexion" };
  if (j.resultado && j.resultado.json_ok === false)
    return { err: "RESPUESTA INESPERADA del endpoint", tipoErr: "consulta" };
  const porFecha = {};
  for (const dia of (j.resultado && j.resultado.dias) || []) {
    const f = dashNumDate(dia.fecha);
    if (f) porFecha[f] = dia;
  }
  const filas = dias.map(iso => {
    const dia = porFecha[iso];
    const kg = dia && dia.registros > 0 ? dashKgDia(dia.items) : null;
    const ok = kg != null && kg > 0;
    return { iso, kg, estado: ok ? "ok" : "nodatos", items: ok ? (dia.items || []) : [] };
  });
  return { filas, estado: j.estado };
}
function dashNumDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mm = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return mm ? mm[3] + "-" + mm[2] + "-" + mm[1] : null;
}
function dashPromedio(filas) {
  const conDatos = filas.filter(f => f.estado === "ok" && f.kg > 0);
  const total = conDatos.reduce((a, f) => a + f.kg, 0);
  return { total, prom: conDatos.length ? total / conDatos.length : null, n: conDatos.length };
}
function dashNomDia(iso) {
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][new Date(iso + "T12:00:00").getDay()];
}
let dashSelIso = null;   // día seleccionado en el detalle (null = último con datos)

function dashFilasHoraHtml(items) {
  // registros de UN día, cronológicos; cada uno vs el registro anterior de ESE día
  const filas = (items || []).map((it, idx) => {
    const kg = dashKgDia([it]);
    return { hora: it.hora != null ? String(it.hora) : "Reg. " + (idx + 1), kg,
             variedad: it.variedad != null ? String(it.variedad) : "" };
  }).filter(f => f.kg > 0);
  let prev = null;
  filas.forEach(f => {
    const pct = prev != null && prev > 0 ? (f.kg - prev) / prev : null;
    const est = dashEstado(pct);
    f.pct = pct; f.face = est.face; f.cls = est.cls; f.txt = est.txt;
    if (f.kg > 0) prev = f.kg;
  });
  if (!filas.length) return `<p class="small muted">Sin registros con peso para este día.</p>`;
  const max = Math.max(1, ...filas.map(f => f.kg));
  const orden = filas.slice().reverse();
  return `<div class="hd"><div class="hd-h">Hora</div><div class="hd-k">KG</div><div class="hd-b">Peso del registro</div><div class="hd-v">Subida</div><div class="hd-e">Estado</div></div>` +
    orden.map(f => `<div class="hrow ${f.cls}">
      <div class="hd-h"><b>${esc(f.hora)}</b>${f.variedad ? `<span class="small muted"> · ${esc(f.variedad)}</span>` : ""}</div>
      <div class="hd-k"><b>${Number(f.kg).toLocaleString("es", { maximumFractionDigits: 1 })}</b> KG</div>
      <div class="hd-b"><div class="btrack-h"><div class="bbar-h ${f.cls}" style="width:${Math.max(4, Math.round(f.kg / max * 100))}%"></div></div></div>
      <div class="hd-v ${f.cls === "ok" ? "up" : f.cls === "err" ? "down" : "flat"}">${esc(dashPctTxt(f.pct))}</div>
      <div class="hd-e"><span class="fchip ${f.cls}" title="${esc(f.txt)}">${esc(f.face)}</span></div>
    </div>`).join("");
}

function dashDetallePaginado(diasTodo) {
  if (!diasTodo || !diasTodo.length) return "";
  const dias = diasTodo.slice();
  let sel = dashSelIso;
  const ultimoCon = dias.filter(d => d.estado === "ok");
  const porDefecto = ultimoCon.length ? ultimoCon[ultimoCon.length - 1].iso : dias[dias.length - 1].iso;
  if (!sel || !dias.some(d => d.iso === sel)) sel = porDefecto;
  const elegido = dias.find(d => d.iso === sel) || dias[dias.length - 1];
  const botones = dias.map(d => {
    const act = d.iso === sel;
    const estado = d.estado === "ok" ? "" : `<span class="det-sin">⚠️</span>`;
    return `<button class="det-dia ${act ? "active" : ""}" title="${esc(dashNomDia(d.iso))} ${esc(dashFmt(d.iso))}" onclick="dashSelDia('${d.iso}')">
      <b>${esc(dashNomDia(d.iso))}</b><span>${esc(dashFmt(d.iso).slice(0, 5))} ${estado}</span></button>`;
  }).join("");
  const contenido = elegido.estado === "ok"
    ? dashFilasHoraHtml(elegido.items)
    : `<div class="rday nodatos" style="padding:12px"><b>⚠️ NO HAY DATOS</b><div class="small muted">PROAGRO no devolvió registros para ${esc(dashNomDia(elegido.iso))} ${esc(dashFmt(elegido.iso))}.</div></div>`;
  return `<div class="cardbox det-card">
    <h3>⚖️ Detalle de pesos — por registro/hora</h3>
    <div class="det-dias">${botones}</div>
    <p class="small muted" style="margin:4px 2px 8px">Mostrando solo los pesos de <b>${esc(dashNomDia(elegido.iso))} ${esc(dashFmt(elegido.iso))}</b>${elegido.estado === "ok" ? " (cada registro vs el anterior de ese día)" : ""}.</p>
    ${contenido}
  </div>`;
}

function dashSelDia(iso) {
  dashSelIso = iso;
  const u = window._dashUltimo;
  if (u) dashRender(u.titulo, u.filas, u.base, u.baseLabel, u.modo, u.diasTodo);
}
function dashRender(titulo, filas, base, baseLabel, modo, diasTodo) {
  const box = $("#dashRes");
  const cur = dashPromedio(filas);
  const conDatos = filas.filter(f => f.estado === "ok");
  const nDatos = conDatos.length;
  let ultimoKg = null;
  filas.forEach(f => {
    if (f.estado === "ok") {
      const base2 = ultimoKg;
      const pct = base2 != null && base2 > 0 ? (f.kg - base2) / base2 : null;
      f.pct = pct;
      const cara = dashCara(pct);
      f.face = cara.f; f.cls = cara.c;
      ultimoKg = f.kg;
    } else { f.face = "—"; f.cls = "no"; }
  });
  const ultimoDato = conDatos.length ? conDatos[conDatos.length - 1].kg : null;
  let varPct = null;
  if (ultimoDato != null && base != null && base > 0) varPct = (ultimoDato - base) / base;
  const caraF = dashCara(varPct);
  const max = Math.max(1, ...conDatos.map(f => f.kg));
  const fmtKg = v => Number(v).toLocaleString("es", { maximumFractionDigits: 1 });
  const cols = filas.map(f => {
    const h = f.estado === "ok" ? Math.max(6, Math.round(f.kg / max * 100)) : 4;
    return `<div class="bcol ${f.cls}">
      <div class="bval">${f.estado === "ok" ? fmtKg(f.kg) : "—"}</div>
      <div class="btrack"><div class="bbar" style="height:${h}%"></div></div>
      ${f.estado === "ok" ? "" : `<div class="bno">⚠️ NO HAY DATOS</div>`}
      <div class="bdow">${esc(dashNomDia(f.iso))}</div>
      <div class="bfecha">${esc(dashFmt(f.iso).slice(0, 5))}</div>
      <div class="bface">${esc(f.face)}</div>
    </div>`;
  }).join("");
  const card = (emoji, l, v, sub, cls) =>
    `<div class="card dash-${cls}"><div class="l">${emoji} ${esc(l)}</div><div class="n">${v}</div><div class="s">${esc(sub)}</div></div>`;
  const tituloLargo = String(titulo).toUpperCase().includes("SEMANA") ? "DE LA SEMANA" : "";
  const side =
    card("🌾", "TOTAL " + tituloLargo, cur.n ? fmtKg(cur.total) + " <small>KG</small>" : "—",
      cur.n ? cur.n + " día(s) con datos" : "sin registros en el período", "total") +
    card("📊", "PROMEDIO DIARIO", cur.prom != null ? fmtKg(cur.prom) + " <small>KG</small>" : "—",
      "solo días con datos (sin ceros)", "prom") +
    card("📈", "VARIACIÓN", varPct != null ? (varPct >= 0 ? "⬆️ +" : "⬇️ ") + (varPct * 100).toFixed(1) + "%" : "—",
      "vs " + (baseLabel || "día anterior"), "var " + caraF.c);
  let msg;
  if (nDatos === 0) msg = { f: "😐", t: "Sin registros en el período", d: "PROAGRO no devolvió datos para estos días: no se muestran ceros ni se altera el promedio." };
  else if (varPct == null) msg = { f: "😐", t: "Sin base para comparar", d: "En la semana siempre se compara desde el lunes; el primer día con datos no tiene comparación." };
  else if (caraF.c === "ok") msg = { f: "😊", t: "¡Excelente!", d: "Tu cosecha subió respecto a " + (baseLabel || "la base") + "." };
  else if (caraF.c === "err") msg = { f: "😞", t: "Tu cosecha bajó", d: "El rendimiento bajó respecto a " + (baseLabel || "la base") + "." };
  else msg = { f: "😐", t: "Rendimiento estable", d: "La variación es pequeña respecto a " + (baseLabel || "la base") + "." };
  const msgHtml = `<div class="cardbox dash-msg ${msg.f === "😊" ? "ok" : msg.f === "😞" ? "err" : "est"}">
    <div class="dash-msg-f">${msg.f}</div>
    <div><b>${esc(msg.t)}</b><div class="small muted">${esc(msg.d)}</div></div></div>`;
  const desde = dashFmt(filas[0].iso), hasta = dashFmt(filas[filas.length - 1].iso);
  let detalle = "";
  const diasDetalle = diasTodo || filas;
  if (nDatos > 0) detalle = dashDetallePaginado(diasDetalle);
  window._dashUltimo = { titulo, filas, base, baseLabel, modo, diasTodo };
  box.innerHTML = `<div class="dash-titulo"><h3>${esc(titulo)}</h3>
    <span class="small muted">${desde} → ${hasta} · ${(function(){ const n = nombreDeDni(dashDni); return n ? "👤 " + esc(n) + "  ·  " : ""; })()}DNI ${esc(dashDni)} · consulta solo lectura</span></div>
    <div class="dash-grid">
      <div class="dash-chart-card"><div class="bchart">${cols}</div></div>
      <div class="dash-side">${side}</div>
    </div>
    ${msgHtml}
    ${detalle}`;
}
function dashMsg(txt, err) {
  const el = $("#dashMsg");
  el.textContent = txt; el.className = "qrmsg" + (err ? " err" : "");
}
async function dashHoy() {
  if (!/^\d{8}$/.test(dashDni)) { dashMsg("Primero escanea un QR o escribe un DNI de 8 dígitos.", true); return; }
  dashSelIso = null;
  dashMsg("Consultando último dato disponible (endpoint real)…");
  const hoyIso = hoyLocalISO();
  const semana = dashDiasSemana();            // LUNES..HOY (tope sábado, nunca domingo)
  try {
    const r = await dashPeriodo(dashDni, semana);
    if (r.err) { dashMsg((r.tipoErr === "conexion" ? "🌐 SIN CONEXIÓN: " : r.tipoErr === "consulta" ? "🔴 " : "") + r.err, true); return; }
    const diaHoy = r.filas.find(f => f.iso === hoyIso);
    const ayerIso = dashSum(hoyIso, -1);
    const diaAyer = r.filas.find(f => f.iso === ayerIso);
    const conHoy = diaHoy && diaHoy.estado === "ok";
    const conAyer = diaAyer && diaAyer.estado === "ok";
    let mostrarIso = null, titulo = "", aviso = "", baseKg = null, baseLabel = "día anterior";
    if (conHoy) { mostrarIso = hoyIso; titulo = "📅 HOY — con datos del día"; aviso = "Hoy (" + dashFmt(hoyIso) + ") ya tiene registros en PROAGRO."; }
    else if (conAyer) { mostrarIso = ayerIso; titulo = "📅 HOY → datos de AYER (" + dashFmt(ayerIso) + ")"; aviso = "Hoy (" + dashFmt(hoyIso) + ") aún no tiene registros; se muestran los de ayer."; }
    else {
      dashRender("📅 HOY — sin datos de hoy ni de ayer",
        [diaHoy || { iso: hoyIso, kg: null, estado: "nodatos", items: [] }], null, "ayer", "dia", r.filas);
      dashMsg("⚠️ NO HAY DATOS: PROAGRO no devolvió registros para hoy (" + dashFmt(hoyIso) + ") ni para ayer (" + dashFmt(ayerIso) + "). Revisa los otros días abajo.", true);
      return;
    }
    const prevIso = dashSum(mostrarIso, -1);
    const rPrev = await dashPeriodo(dashDni, [prevIso]);
    if (!rPrev.err) { const pp = dashPromedio(rPrev.filas); if (pp.n > 0) baseKg = pp.total; }
    const filas = r.filas.filter(f => f.iso === mostrarIso);
    dashRender(titulo, filas, baseKg, baseLabel, "dia", r.filas);   // detalle: TODOS los días de la semana
    dashMsg(aviso + " Consulta completada — en el detalle puedes ver cada día.", false);
  } catch (e) { dashMsg("🌐 SIN CONEXIÓN con el servidor local: " + e.message, true); }
}
async function dashSemana() {
  dashSelIso = null;   // nueva consulta -> detalle vuelve al último día
  if (!/^\d{8}$/.test(dashDni)) { dashMsg("Primero escanea un QR o escribe un DNI de 8 dígitos.", true); return; }
  const dias = dashDiasSemana();
  const ini = dias[0], fin = dias[dias.length - 1];
  dashMsg("Consultando ESTA SEMANA (" + dashFmt(ini) + " → " + dashFmt(fin) + ", lunes a sábado)…");
  try {
    const r = await dashPeriodo(dashDni, dias);
    if (r.err) { dashMsg((r.tipoErr === "conexion" ? "🌐 SIN CONEXIÓN: " : r.tipoErr === "consulta" ? "🔴 " : "") + r.err, true); return; }
    const con = r.filas.filter(f => f.estado === "ok");
    let baseKg = null, baseLabel = "Lunes (inicio de semana)";
    if (con.length >= 2) baseKg = con[0].kg;
    dashRender("🌾 ESTA SEMANA", r.filas, baseKg, baseLabel, "semana");
    const sinHoy = r.filas.length && r.filas[r.filas.length - 1].estado !== "ok";
    dashMsg((con.length ? con.length + " día(s) con datos — " : "⚠️ Sin registros en la semana (no se muestran ceros). ") +
      (sinHoy ? "Hoy aún no tiene registros (normal: se cargan al día siguiente). " : "") +
      "Comparaciones siempre dentro de la semana, desde el lunes.", !!sinHoy);
  } catch (e) { dashMsg("🌐 SIN CONEXIÓN con el servidor local: " + e.message, true); }
}
function dashSyncDni() {
  const hero = ($("#dashDniInp").value || "").trim();
  if (/^\d{8}$/.test(hero)) dashDni = hero;
  const inp = $("#dashDniInp");
  if (inp && /^\d{8}$/.test(dashDni)) inp.value = dashDni;
  renderTagNombre();
}
function cosechaSub(tab) {
  const esQr = tab === "qr";
  const a1 = $("#subQr"), a2 = $("#subDni"), b1 = $("#cosechaQR"), b2 = $("#cosechaDNI");
  if (a1) a1.classList.toggle("active", esQr);
  if (a2) a2.classList.toggle("active", !esQr);
  if (b1) b1.classList.toggle("hidden", !esQr);
  if (b2) b2.classList.toggle("hidden", esQr);
}
async function qrBuscar(dniSel = "#qrDni", fechaSel = "#qrFecha", boxSel = "#qrResultBox", msgSel = "#qrMsg") {
  const qm = (txt, err) => {
    const el = $(msgSel);
    if (el) { el.textContent = txt; el.className = "qrmsg" + (err ? " err" : ""); }
  };
  const dni = ($(dniSel).value || "").trim();
  const fecha = $(fechaSel).value;
  if (!/^\d{8}$/.test(dni)) return qm("El DNI debe tener 8 dígitos.", true);
  if (!fecha) return qm("Indica la fecha.", true);
  qm("Consultando PROAGRO (vía servidor local, solo lectura)…");
  $(boxSel).innerHTML = `<div class="cardbox"><p class="muted">Consultando…</p></div>`;
  try {
    const resp = await fetch("/api/consultar-kg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, fecha }),
    });
    const j = await resp.json().catch(() => ({}));
    if (j.estado === "VALIDACION") { qm(j.error || "Validación fallida", true); return; }
    qrRenderResultado(j, boxSel);
    if (j.estado === "OK") qrBeep("datos");
    else if (j.estado === "SIN_DATOS") qrBeep("nodatos");
    else qrBeep("error");
    await qrkgRefreshHistory();
    qm("Consulta completada (" + j.estado + ")");
  } catch (e) {
    qm("Error de red con el servidor local: " + e.message, true);
    $(boxSel).innerHTML = "";
  }
}

function qrEstadoChip(estado) {
  const cls = estado === "OK" ? "e-ok" : estado === "SIN_DATOS" ? "e-sin"
    : String(estado).startsWith("HTTP") ? "e-http"
    : estado === "VALIDACION" ? "e-val" : "e-error";
  return `<span class="estado-chip ${cls}">${esc(estado)}</span>`;
}

function qrRenderResultado(j, boxSel = "#qrResultBox") {
  const r = j.resultado || {};
  const m = j.meta || {};
  const nums = r.nums || {};
  let html = `<div class="result"><h3>RESULTADO PROAGRO ${qrEstadoChip(j.estado)}</h3>`;
  html += `<p class="small muted">DNI <b class="mono">${esc(j.consulta && j.consulta.dni)}</b> · Fecha ${esc(j.consulta && j.consulta.fecha)} · ${(m.elapsed_ms != null ? m.elapsed_ms + " ms" : "")} · HTTP ${esc(m.http_status ?? "—")}</p>`;
  if (r.nombre) html += `<p class="nombre-grande">${esc(r.nombre)}</p>`;
  const hay = r.encontrado && (r.registros > 0);
  if (j.estado === "SIN_DATOS" || (r.encontrado === false)) {
    html += `<p class="muted">El endpoint respondió correctamente pero no hay registros para ese DNI/fecha (${esc((r.claves_respuesta || []).join(", "))}).</p>`;
  } else if (hay || r.registros > 0) {
    html += `<div class="kgcards">`;
    [["kgExportable", "KG EXPORTABLE"], ["kgDescarte", "KG DESCARTE"], ["kgTotal", "KG TOTAL"]]
      .forEach(([k, l]) => {
        if (k in nums) html += `<div class="card"><div class="n">${esc(nums[k])}</div><div class="l">${l}</div></div>`;
      });
    html += `</div>`;
    const colPref = ["hora", "variedad", "lote", "kgExportable", "kgDescarte", "kgTotal"];
    (r.dias || []).forEach((dia, di) => {
      html += `<h3 style="margin-top:10px">Día ${esc(dia.fecha || di + 1)} · ${dia.registros} registro(s)</h3>`;
      const items = dia.items || [];
      if (!items.length) { html += `<p class="muted small">sin detalle</p>`; return; }
      const cols = colPref.filter(c => c in items[0]).concat(
        Object.keys(items[0]).filter(c => colPref.indexOf(c) < 0));
      html += `<div class="tblwrap"><table class="tbl"><thead><tr>` +
        cols.map(c => `<th>${esc(c)}</th>`).join("") + `</tr></thead><tbody>` +
        items.map(it => `<tr>` + cols.map(c => {
          const v = it[c];
          const n = parseFloat(v);
          const esNum = /^[0-9]+(\.[0-9]+)?$/.test(v) && isFinite(n);
          return `<td class="${esNum ? 'num' : ''}">${esc(v)}${esNum ? '' : ''}</td>`;
        }).join("") + `</tr>`).join("") + `</tbody></table></div>`;
    });
  } else {
    html += `<p class="small mono">claves de la respuesta: ${esc((r.claves_respuesta || []).join(", ") || "—")}</p>`;
  }
  html += `<div class="row" style="margin-top:12px">
    <button class="btn ghost" onclick="qrVerRespuesta()">🔬 VER RESPUESTA DEL ENDPOINT</button></div>`;
  $(boxSel).innerHTML = html + "</div>";
  window._qrUltimaRespuesta = j;
}

function qrVerRespuesta() {
  const j = window._qrUltimaRespuesta;
  if (!j) return;
  const m = j.meta || {};
  let raw = j.raw_text || "";
  try { raw = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { /* texto plano */ }
  const params = m.params || {};
  openModal(`<h2>🔬 Respuesta original del endpoint</h2>
    <p class="small"><b>Endpoint:</b> <span class="mono">${esc(m.endpoint)}</span><br>
    <b>Método:</b> ${esc(m.method)} · <b>HTTP:</b> ${esc(m.http_status ?? "—")} ·
    <b>Tiempo:</b> ${esc(m.elapsed_ms != null ? m.elapsed_ms + " ms" : "—")}<br>
    <b>Content-Type:</b> ${esc(m.content_type || "—")}<br>
    <b>Content-Type enviado:</b> ${esc(m.content_type_json || "—")}<br>
    <b>SHA-256:</b> <span class="mono small">${esc(m.sha256 || "—")}</span></p>
    <label>Parámetros utilizados</label>
    <pre class="log">${esc(JSON.stringify(params, null, 2))}</pre>
    <label>Respuesta original (guardada como evidencia)</label>
    <pre class="log" style="max-height:340px">${esc(raw)}</pre>
    ${m.raw_path ? `<a class="dl" href="/api/files?path=${encodeURIComponent(m.raw_path)}">⬇ descargar JSON crudo</a>` : ""}
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}

async function qrkgRefreshHistory() {
  if (staticMode) return;
  const box = $("#qrkg");
  try {
    const { queries } = await api("/api/kg-queries");
    const tbl = $("#hisTable");
    if (!tbl) return;
    $("#hisCount").textContent = queries.length + " consulta(s)";
    tbl.innerHTML = `<thead><tr><th>Hora</th><th>DNI</th><th>Fecha</th><th>Nombre</th>` +
      `<th class="num">KG total</th><th>Estado</th><th class="num">HTTP</th><th class="num">ms</th></tr></thead><tbody>` +
      (queries.length ? queries.map(q => {
        const kg = q.kg_total != null ? q.kg_total : (q.kg_exportable != null ? q.kg_exportable : "");
        return `<tr><td class="small">${esc((q.created_at || "").slice(11, 19))}</td>` +
          `<td class="mono">${esc(q.dni)}</td><td class="small">${esc(q.fecha)}</td>` +
          `<td class="small">${esc(q.nombre || "")}</td>` +
          `<td class="num">${kg === "" ? "—" : esc(kg)}</td>` +
          `<td>${qrEstadoChip(q.estado)}</td><td>${esc(q.http_status ?? "—")}</td>` +
          `<td class="num">${q.elapsed_ms != null ? esc(Math.round(q.elapsed_ms)) : "—"}</td></tr>`;
      }).join("") : `<tr><td colspan="8" class="muted">Sin consultas todavía.</td></tr>`) +
      `</tbody></table>`;
  } catch (e) { /* el servidor aún no tiene el endpoint (recargar) */ }
}

boot();
