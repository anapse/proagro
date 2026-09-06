# -*- coding: utf-8 -*-
from pathlib import Path
p = Path("web/app.js")
s = p.read_text(encoding="utf-8")
a = s.index("async function cargarRanking() {")
b = s.index("async function loadTab(name) {")
nuevo = r'''let rkDatos = { rows: [], lotes: [], variedades: [], fecha: "", ts: 0 };   // caché en memoria: respuesta REAL del endpoint
let rkTopSel = "3";   // "3" | "5" | "10" | "todas"

async function cargarRanking() {
  const panel = $("#panel-ranking"); if (!panel) return;
  const hoy = hoyLocalISO();
  if (rkDatos.ts && rkDatos.fecha === hoy && Date.now() - rkDatos.ts < 120000) { rkRenderShell(hoy); return; }
  panel.innerHTML = `<div class="qr-sec"><h2>🏆 RANKING</h2><div class="cardbox" id="rkBox"><p>Consultando el ranking real de ${dashFmt(hoy)}…</p></div></div>`;
  try {
    const base = workerUrl.trim().replace(/\/$/, "") + "/api/ranking";
    const r = await fetch(base + "?top=5000&fechaIni=" + hoy + "&fechaFin=" + hoy, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json().catch(() => null);
    if (!j || !Array.isArray(j.ranking)) throw new Error("respuesta inesperada del endpoint");
    rkDatos = { rows: j.ranking, lotes: j.lotes || [], variedades: j.variedades || [], fecha: hoy, ts: Date.now() };
    rkRenderShell(hoy);
  } catch (e) {
    const box = $("#rkBox");
    if (box) box.innerHTML = `<p><b>❌ ERROR DE CONSULTA</b></p><p class="small muted">${esc(e && e.message || e)} — Worker: ${esc(workerUrl || "—")}</p>`;
  }
}

function rkRenderShell(hoy) {
  const panel = $("#panel-ranking"); if (!panel) return;
  panel.innerHTML = `<div class="qr-sec"><h2>🏆 RANKING <span class="small muted">· ${dashFmt(hoy)} · ${rkDatos.rows.length} cosechador(es)</span></h2>
    <div class="subtabs">
      <button id="rkTabTop" class="active">🏆 Ranking</button>
      <button id="rkTabBus">🔎 Buscar por nombre</button>
    </div>
    <div id="rkTopView"></div>
    <div id="rkBusView" class="hidden"></div>
    <p class="small muted">Datos reales devueltos por ObtenerRankingVista (solo lectura, vía Worker).</p></div>`;
  const t1 = $("#rkTabTop"), t2 = $("#rkTabBus");
  t1.onclick = () => { t1.classList.add("active"); t2.classList.remove("active"); $("#rkTopView").classList.remove("hidden"); $("#rkBusView").classList.add("hidden"); };
  t2.onclick = () => { t2.classList.add("active"); t1.classList.remove("active"); $("#rkBusView").classList.remove("hidden"); $("#rkTopView").classList.add("hidden"); rkRenderBus(); };
  rkRenderTop();
}

function rkN(v) { const x = Number(v); return isFinite(x) ? x.toLocaleString("es", { maximumFractionDigits: 1 }) : "—"; }
function rkNrm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function rkFilaHTML(r2, i) {
  return `<tr class="rk-fila" data-i="${i}"><td class="rk-pos">${r2.posicion != null ? r2.posicion : i + 1}</td><td>${esc(r2.nombre || "—")}</td>` +
    `<td class="num">${rkN(r2.kgExportable)}</td><td class="num">${rkN(r2.kgDescarte)}</td><td class="num"><b>${rkN(r2.kgTotal)}</b></td></tr>`;
}
function rkBindFilas(contSel, fnDet) {
  document.querySelectorAll(contSel + " .rk-fila").forEach(tr => tr.onclick = () => fnDet(parseInt(tr.dataset.i, 10)));
}

function rkRenderTop() {
  const filas = rkDatos.rows;
  const nSel = rkTopSel === "todas" ? filas.length : Math.min(parseInt(rkTopSel, 10) || 3, filas.length);
  const chips = [["3", "🥇 TOP 3"], ["5", "TOP 5"], ["10", "TOP 10"], ["todas", "TODOS"]];
  const vista = $("#rkTopView");
  vista.innerHTML = `<p class="small muted">Por defecto: el mejor 3. Elige cuántos ver:</p>
    <div class="rank-chips">${chips.map(([v, t]) => `<button class="btn small ${rkTopSel === v ? "primary" : "ghost"}" data-top="${v}">${t}</button>`).join("")}</div>
    <div id="rkTopTable"></div><div id="rkDetalleTop"></div>`;
  document.querySelectorAll(".rank-chips [data-top]").forEach(b => b.onclick = () => { rkTopSel = b.dataset.top; rkRenderTop(); });
  const top = filas.slice(0, nSel);
  $("#rkTopTable").innerHTML = top.length
    ? `<table class="tbl rank-tbl"><thead><tr><th>#</th><th>Nombre</th><th class="num">Exportable KG</th><th class="num">Descarte</th><th class="num">Total KG</th></tr></thead><tbody>` +
      top.map(rkFilaHTML).join("") + `</tbody></table>
      <p class="small muted">Toca una fila para ver todo el detalle de esa persona.</p>`
    : `<p>⚠️ NO HAY DATOS de ranking para ${dashFmt(rkDatos.fecha)}.</p>`;
  rkBindFilas("#rkTopTable", i => rkDetalle(i, "#rkDetalleTop"));
}

function rkRenderBus() {
  const bv = $("#rkBusView");
  bv.innerHTML = `<div class="cardbox rk-busca"><label>🔎 Busca por nombre — filtra mientras escribes</label>
    <input id="rkNombre" class="inp" style="width:100%" placeholder="Escribe el nombre de la persona…">
    <p class="small muted" id="rkMatch"></p><div id="rkLista"></div></div>
    <div id="rkDetalle"></div>`;
  const inp = $("#rkNombre");
  inp.addEventListener("input", () => { rkFiltro = inp.value; rkListaFiltro(); });
  inp.focus();
  rkListaFiltro();
}
let rkFiltro = "";
function rkListaFiltro() {
  const f = rkNrm(rkFiltro);
  const filas = rkDatos.rows;
  const hits = f ? filas.map((r2, i) => [r2, i]).filter(([r2]) => rkNrm(r2.nombre).includes(f)) : [];
  const m = $("#rkMatch"); if (m) m.textContent = f ? `${hits.length} coincidencia(s) de ${filas.length}` : `${filas.length} cosechadores — escribe para filtrar`;
  const lista = $("#rkLista"); if (!lista) return;
  if (!f) { lista.innerHTML = ""; return; }
  lista.innerHTML = hits.length
    ? `<table class="tbl rank-tbl"><tbody>` + hits.slice(0, 60).map(([r2, i]) => rkFilaHTML(r2, i)).join("") + `</tbody></table>` +
      (hits.length > 60 ? `<p class="small muted">… y ${hits.length - 60} más. Afina el nombre.</p>` : "")
    : `<p>Sin resultados para «${esc(rkFiltro)}».</p>`;
  rkBindFilas("#rkLista", i => rkDetalle(i, "#rkDetalle"));
}
function rkDetalle(i, contSel) {
  const r2 = rkDatos.rows[i]; if (!r2) return;
  const cont = document.querySelector(contSel); if (!cont) return;
  const tot = Number(r2.kgTotal); const suma = rkDatos.rows.reduce((a, x) => a + (Number(x.kgTotal) || 0), 0);
  const pct = isFinite(tot) && suma > 0 ? ((tot / suma) * 100).toLocaleString("es", { maximumFractionDigits: 1 }) + " %" : "—";
  cont.innerHTML = `<div class="cardbox rk-det">
    <h3>👤 ${esc(r2.nombre || "—")}</h3>
    <p class="small muted">Puesto <b>#${r2.posicion != null ? r2.posicion : i + 1}</b> del ranking del ${dashFmt(rkDatos.fecha)} — ${rkDatos.rows.length} cosechadores</p>
    <div class="dash-grid"><div class="dash-chart-card rk-det-kgs">
      <div class="dash-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        <div class="card dash-total"><div class="l">🟢 Exportable</div><div class="n">${rkN(r2.kgExportable)} <small>KG</small></div></div>
        <div class="card dash-total"><div class="l">🔴 Descarte</div><div class="n">${rkN(r2.kgDescarte)} <small>KG</small></div></div>
        <div class="card dash-total"><div class="l">🌾 Total del día</div><div class="n"><b>${rkN(r2.kgTotal)} <small>KG</small></b></div></div>
      </div></div>
      <div class="dash-side"><div class="card dash-var"><div class="l">📊 % del ranking</div><div class="n">${pct}</div><div class="s">kgTotal de ${esc(r2.nombre || "esta persona")} vs suma del día</div></div></div>
    </div>
    <p class="small muted">Campos reales del endpoint: posicion · nombre · kgExportable · kgDescarte · kgTotal (solo lectura).</p>
  </div>`;
  cont.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
'''
s = s[:a] + nuevo + s[b:]
p.write_text(s, encoding="utf-8")
print("ranking 2 pestañas OK")
PYEOF_MARK
