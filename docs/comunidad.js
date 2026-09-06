/* ============================================================
 * PROAGRO WEB — COMUNIDAD (vanilla JS)
 * Depende de app.js (usa $, $$, esc, openModal, closeModal,
 * toastShow, workerUrl). Cargar DESPUÉS de app.js.
 * Datos en Cloudflare D1 vía el Worker (proagro-api).
 * ============================================================ */
"use strict";

(function () {
  const CM = {}; // API pública: window.comunidad

  // ---------- identidad anónima/estable del dispositivo ----------
  let voterId = "";
  try { voterId = localStorage.getItem("community_voter_id") || ""; } catch (e) { }
  if (!voterId) {
    voterId = (crypto.randomUUID ? crypto.randomUUID() : "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    try { localStorage.setItem("community_voter_id", voterId); } catch (e) { }
  }

  // ---------- token admin: SOLO en memoria (nunca en localStorage ni en el repo) ----------
  let adminToken = "";

  function base() {
    return (workerUrl || "https://proagro-api.elherreroanapse.workers.dev").replace(/\/$/, "");
  }
  async function cmFetch(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (adminToken) headers["Authorization"] = "Bearer " + adminToken;
    const r = await fetch(base() + path, { ...opts, headers });
    let j = null;
    try { j = await r.json(); } catch (e) { }
    if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    return j;
  }

  function fmtFecha(iso) {
    if (!iso) return "";
    const d = new Date(String(iso).replace(" ", "T") + (String(iso).includes("T") ? "" : "Z"));
    if (isNaN(d)) return String(iso);
    const hoy = new Date();
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const dd = (x) => String(x.getDate()).padStart(2, "0");
    const mm = (x) => String(x.getMonth() + 1).padStart(2, "0");
    if (d.toDateString() === hoy.toDateString()) return "hoy " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (d.toDateString() === ayer.toDateString()) return "ayer";
    return dd(d) + "/" + mm(d) + "/" + d.getFullYear();
  }

  // ---------- estado de error común ----------
  function errBox(msg) {
    return `<div class="cardbox"><p class="muted">⚠️ ${esc(msg)}</p>
      <p class="small muted">Si el Worker no tiene D1 (env.DB) configurado o no está desplegado con la
      nueva versión, la Comunidad no puede guardar datos. Revisa GUIA_COMUNIDAD.md.</p></div>`;
  }
  async function cmSafe(fn) {
    try { return await fn(); } catch (e) { return errBox(e.message); }
  }

  // ---------- medallas por puesto ----------
  function medalla(puesto) {
    if (puesto === 1) return "🥇";
    if (puesto === 2) return "🥈";
    if (puesto === 3) return "🥉";
    return String(puesto);
  }

  // ============================================================
  //  NOTICIAS / AVISOS
  // ============================================================
  function noticiaChip(p) {
    const t = (p.type === "noticia") ? "📰 NOTICIA" : "📢 AVISO OFICIAL";
    const c = p.category ? " · " + esc(p.category.toUpperCase()) : "";
    return `<span class="chip" style="color:var(--accent);font-weight:800">${t}${c}</span>`;
  }
  function tarjetaPost(p) {
    const img = p.image_url
      ? `<img class="cm-post-img" src="${esc(p.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : "";
    return `<div class="cardbox cm-post">
      <div class="cm-post-top">${noticiaChip(p)}<span class="small muted">🕐 ${fmtFecha(p.created_at)}</span></div>
      <h3 style="text-transform:none;font-size:17px;margin:8px 0 4px">${esc(p.title)}</h3>
      ${img}
      <p class="cm-post-txt">${esc(p.content)}</p>
      <div class="cm-post-foot">
        <span class="small muted">👤 ${esc(p.author || "Administración")}</span>
        <button class="btn ghost small" onclick="comunidad.comentariosPost(${p.id})">💬 Comentar</button>
      </div></div>`;
  }
  CM.noticias = async function () {
    const panel = $("#panel-noticias"); if (!panel) return;
    panel.innerHTML = `<div class="qr-sec"><h2>📰 NOTICIAS Y AVISOS</h2>
      <p class="small muted">Comunicados oficiales, cambios de horario y avisos de la empresa.</p>
      <div class="chips" style="margin:10px 0">
        <button class="btn small" id="cmFiltroTodo">Todas</button>
        <button class="btn small" id="cmFiltroAviso">📢 Avisos</button>
        <button class="btn small" id="cmFiltroNoticia">📰 Noticias</button>
      </div>
      <div id="cmPostsBox"></div></div>`;
    const box = $("#cmPostsBox");
    box.innerHTML = `<p class="muted">Consultando…</p>`;
    const j = await cmSafe(async () => await cmFetch("/api/community/posts"));
    if (typeof j === "string") { box.innerHTML = j; return; }
    const posts = (j.posts || []);
    if (!posts.length) {
      box.innerHTML = `<div class="cardbox"><p class="muted">📭 Todavía no hay noticias ni avisos publicados.</p></div>`;
      return;
    }
    let filtro = "todas";
    const pintar = () => {
      const lista = filtro === "todas" ? posts : posts.filter(p => p.type === filtro);
      box.innerHTML = lista.length ? lista.map(tarjetaPost).join("")
        : `<div class="cardbox"><p class="muted">Sin publicaciones en esta categoría.</p></div>`;
    };
    pintar();
    const bT = $("#cmFiltroTodo"), bA = $("#cmFiltroAviso"), bN = $("#cmFiltroNoticia");
    const act = (b) => { [bT, bA, bN].forEach(x => { if (x) x.style.outline = "none"; }); b.style.outline = "2px solid var(--accent)"; };
    act(bT);
    if (bT) bT.onclick = () => { filtro = "todas"; act(bT); pintar(); };
    if (bA) bA.onclick = () => { filtro = "aviso"; act(bA); pintar(); };
    if (bN) bN.onclick = () => { filtro = "noticia"; act(bN); pintar(); };
  };

  // ============================================================
  //  ENCUESTAS
  // ============================================================
  CM.encuestas = async function () {
    const panel = $("#panel-encuestas"); if (!panel) return;
    panel.innerHTML = `<div class="qr-sec"><h2>📊 ENCUESTAS</h2>
      <p class="small muted">Tu voto es anónimo (identificador del dispositivo) y se guarda una sola vez por encuesta.</p>
      <div id="cmSurveysBox"><p class="muted">Consultando…</p></div></div>`;
    const box = $("#cmSurveysBox");
    const j = await cmSafe(async () => await cmFetch("/api/community/surveys?voter_id=" + encodeURIComponent(voterId)));
    if (typeof j === "string") { box.innerHTML = j; return; }
    const encuestas = (j.encuestas || []).filter(e => e.status === "activa");
    if (!encuestas.length) {
      box.innerHTML = `<div class="cardbox"><p class="muted">📭 No hay encuestas activas ahora mismo.</p></div>`;
      return;
    }
    box.innerHTML = encuestas.map((e, idx) => {
      const ya = e.ya_vote_option_id;
      const optsHtml = (e.opciones || []).map(o => {
        if (ya != null) {
          const total = e.total_votos || 0;
          const pct = total > 0 ? Math.round((o.votos / total) * 100) : 0;
          const marcada = o.id === ya ? " style='color:var(--accent);font-weight:800'" : "";
          return `<div class="cm-surv-res" ${marcada}>
            <div class="cm-surv-lbl">${o.votos > 0 ? "✅" : "○"} <span ${marcada}>${esc(o.option_text)}</span>
              <b class="num">${o.votos} · ${pct}%</b></div>
            <div class="cm-surv-bar"><div style="width:${pct}%"></div></div></div>`;
        }
        return `<label class="cm-surv-opt"><input type="radio" name="surv${e.id}" value="${o.id}"> ${esc(o.option_text)}</label>`;
      }).join("");
      const accion = (ya != null)
        ? `<p class="small muted" style="margin:8px 0 0">🗳️ Ya votaste en esta encuesta — gracias.</p>`
        : `<button class="btn primary" id="cmVotar${e.id}">🗳️ VOTAR</button>`;
      return `<div class="cardbox cm-surv" data-id="${e.id}">
        <h3 style="text-transform:none;font-size:17px">📊 ${esc(e.question)}</h3>
        <div class="small muted" style="margin-bottom:6px">${(e.opciones || []).length} opciones · ${e.total_votos || 0} voto(s)</div>
        <div class="cm-surv-opts" id="cmOpts${e.id}">${optsHtml}</div>
        <div id="cmSurvMsg${e.id}" class="small"></div>
        <div style="margin-top:10px">${accion}</div>
      </div>`;
    }).join("");
    // bindear votos
    encuestas.forEach(e => {
      const b = $("#cmVotar" + e.id);
      if (b) b.onclick = async () => {
        const sel = document.querySelector(`input[name="surv${e.id}"]:checked`);
        if (!sel) { const m = $("#cmSurvMsg" + e.id); if (m) { m.textContent = "Selecciona una opción primero."; m.style.color = "var(--warn)"; } return; }
        b.disabled = true;
        const msg = $("#cmSurvMsg" + e.id);
        try {
          const res = await cmFetch("/api/community/surveys/" + e.id + "/vote", {
            method: "POST", body: JSON.stringify({ voter_id: voterId, option_id: Number(sel.value) }),
          });
          if (msg) { msg.textContent = "✅ Voto registrado."; msg.style.color = "var(--accent)"; }
          CM.encuestas();
        } catch (err) {
          if (msg) { msg.textContent = "❌ " + err.message; msg.style.color = "var(--danger)"; }
          b.disabled = false;
          if (/Ya votaste/.test(err.message)) CM.encuestas();
        }
      };
    });
  };

  // ============================================================
  //  SUPERVISORES (ranking + tarjetas sociales)
  // ============================================================
  // Caché en memoria de los supervisores visibles (para el modal
  // de comentarios: nombre/cargo/estadísticas exactas del elegido).
  let supCache = {};

  CM.supervisores = async function () {
    const panel = $("#panel-supervisores"); if (!panel) return;
    panel.innerHTML = `<div class="qr-sec"><h2>🏆 SUPERVISORES MÁS VOTADOS</h2>
      <p class="small muted">Valora a tu supervisor: 👍 like, 👎 dislike, o 💬 comenta.
      Un voto activo por persona · el ranking se calcula con los datos reales.</p>
      <div id="cmSupsBox"><p class="muted">Consultando…</p></div>
    </div>`;
    const box = $("#cmSupsBox");
    const j = await cmSafe(async () =>
      await cmFetch("/api/community/supervisors?voter_id=" + encodeURIComponent(voterId)));
    if (typeof j === "string") { box.innerHTML = j; return; }
    const sups = (j.supervisores || []);
    const miVoto = j.mi_voto || {};
    if (!sups.length) {
      box.innerHTML = `<div class="cardbox"><p class="muted">Todavía no hay supervisores registrados.</p></div>`;
      return;
    }
    supCache = {};
    sups.forEach((s) => { supCache[s.id] = s; });
    box.innerHTML = `<div class="cm-grid">` + sups.map(s => {
      const pct = (s.total_votos > 0) ? s.porcentaje_positivo : null;
      const voto = miVoto[s.id];
      const likeCls = voto === "like" ? " cm-vote-on" : "";
      const disCls = voto === "dislike" ? " cm-vote-on" : "";
      const total = (s.likes || 0) + (s.dislikes || 0);
      const coms = s.comentarios || 0;
      const nombre = esc(s.nombre || "—");
      const cargo = esc(s.cargo || "Supervisor/a");
      const med = s.puesto === 1 ? "🥇" : s.puesto === 2 ? "🥈" : s.puesto === 3 ? "🥉" : "";
      const badgePos = med
        ? `<span class="cm-puesto-med">${med}</span>`
        : `<span class="cm-puesto-num">#${s.puesto}</span>`;
      return `<div class="cm-card" data-sup="${s.id}">
        <div class="cm-card-top">
          <div class="cm-pos">${badgePos}<span class="cm-pos-txt">Puesto ${s.puesto}</span></div>
          <span class="cm-pct-chip">${pct != null ? `👍 ${pct}% positivo` : "Sin votos"}</span>
        </div>
        <div class="cm-foto">
          <img class="cm-avatar" src="assets/avatar-supervisor.png" alt="Avatar de ${nombre}" loading="lazy" width="120" height="120">
          <span class="cm-foto-ring"></span>
        </div>
        <div class="cm-nombre">${nombre}</div>
        <div class="cm-cargo">${cargo}</div>
        <div class="cm-stats">
          <span class="cm-stat cm-stat-up" title="Likes"><i>👍</i><b id="cmLikes${s.id}">${s.likes || 0}</b></span>
          <span class="cm-stat cm-stat-down" title="Dislikes"><i>👎</i><b id="cmDislikes${s.id}">${s.dislikes || 0}</b></span>
          <span class="cm-stat cm-stat-com" title="Comentarios"><i>💬</i><b id="cmComs${s.id}">${coms}</b></span>
        </div>
        ${pct != null ? `<div class="cm-pct small muted">Valoración positiva: <b>${pct}%</b> · ${total} voto${total === 1 ? "" : "s"}</div>` : ""}
        <div class="cm-actions">
          <button class="btn cm-vote cm-vote-like ${likeCls}" id="cmLike${s.id}" data-sup="${s.id}" data-tipo="like">👍 LIKE</button>
          <button class="btn cm-vote cm-vote-dis ${disCls}" id="cmDislike${s.id}" data-sup="${s.id}" data-tipo="dislike">👎 DISLIKE</button>
        </div>
        <button class="btn cm-comentar" onclick="comunidad.comentariosSupervisor(${s.id})">💬 COMENTAR</button>
        <div class="small cm-msg" id="cmVoteMsg${s.id}"></div>
      </div>`;
    }).join("") + `</div>`;
    // bindear votos (delegación)
    box.querySelectorAll("button.cm-vote").forEach(b => {
      b.onclick = async () => {
        const sup = b.dataset.sup, tipo = b.dataset.tipo;
        b.disabled = true;
        const msg = $("[id=cmVoteMsg" + sup + "]");
        if (msg) { msg.textContent = "⏳ Enviando…"; msg.style.color = "var(--muted)"; }
        try {
          const res = await cmFetch("/api/community/supervisors/" + sup + "/vote", {
            method: "POST", body: JSON.stringify({ voter_id: voterId, vote_type: tipo }),
          });
          const lb = $("#cmLikes" + sup), db = $("#cmDislikes" + sup);
          if (lb) lb.textContent = res.likes;
          if (db) db.textContent = res.dislikes;
          if (msg) {
            msg.textContent = res.accion === "creado" ? "✅ Voto registrado."
              : res.accion === "quitado" ? "↩️ Quitaste tu voto."
              : "🔄 Voto actualizado.";
            msg.style.color = "var(--accent)";
          }
          // refresca estados de botones y caché sin recargar todo
          box.querySelectorAll("button.cm-vote").forEach(x => {
            x.classList.remove("cm-vote-on");
            if (res.mi_voto && x.dataset.sup === sup && x.dataset.tipo === res.mi_voto) x.classList.add("cm-vote-on");
          });
          if (supCache[sup]) { supCache[sup].likes = res.likes; supCache[sup].dislikes = res.dislikes; }
        } catch (err) {
          if (msg) { msg.textContent = "❌ " + err.message; msg.style.color = "var(--danger)"; }
        }
        b.disabled = false;
      };
    });
  };

  // Actualiza el contador de comentarios de una tarjeta y el modal
  // con el valor real que devuelve D1 (sin recargar la página).
  async function refrescarComentariosSup(supId) {
    try {
      const j = await cmFetch("/api/community/supervisors?voter_id=" + encodeURIComponent(voterId));
      const s = (j.supervisores || []).find((x) => x.id === supId);
      if (!s) return;
      if (supCache[supId]) supCache[supId] = s;
      const n = s.comentarios || 0;
      const elCard = $("#cmComs" + supId);
      if (elCard) elCard.textContent = n;
      const elModal = $("#cmModalComs");
      if (elModal) elModal.textContent = n;
      const lb = $("#cmLikes" + supId), db = $("#cmDislikes" + supId);
      if (lb) lb.textContent = s.likes || 0;
      if (db) db.textContent = s.dislikes || 0;
      const lm = $("#cmModalLikes");
      if (lm) lm.textContent = s.likes || 0;
      const dm = $("#cmModalDislikes");
      if (dm) dm.textContent = s.dislikes || 0;
    } catch (e) { /* silencioso: el modal ya muestra su estado */ }
  }

  // ============================================================
  //  COMENTARIOS (modal / bottom-sheet)
  // ============================================================
  function modalComentarios(titulo, cargar, publicar) {
    openModal(`<h2>💬 ${titulo}</h2>
      <div id="cmComList" class="cm-com-list"><p class="muted">Cargando comentarios…</p></div>
      <label>Escribe tu comentario…</label>
      <textarea id="cmComTxt" class="inp cm-com-txt" maxlength="500" rows="2"
        placeholder="Escribe tu comentario..."></textarea>
      <div id="cmComMsg" class="small"></div>
      <div class="actions">
        <button class="btn ghost" onclick="closeModal()">Cerrar</button>
        <button class="btn primary" id="cmComPub">📤 PUBLICAR</button>
      </div>`);
    const list = $("#cmComList");
    const msg = $("#cmComMsg");
    cargar().then(html => { if (list) list.innerHTML = html; })
      .catch(e => { if (list) list.innerHTML = `<p class="muted">❌ ${esc(e.message)}</p>`; });
    const pub = $("#cmComPub");
    if (pub) pub.onclick = async () => {
      const txt = $("#cmComTxt");
      const t = (txt ? txt.value : "").trim();
      if (!t) { if (msg) { msg.textContent = "Escribe un comentario primero."; msg.style.color = "var(--warn)"; } return; }
      if (t.length > 500) { if (msg) { msg.textContent = "Máximo 500 caracteres."; msg.style.color = "var(--warn)"; } return; }
      pub.disabled = true;
      try {
        await publicar(t);
        if (msg) { msg.textContent = "✅ Comentario publicado."; msg.style.color = "var(--accent)"; }
        if (txt) txt.value = "";
        const html = await cargar();
        if (list) list.innerHTML = html;
      } catch (e) {
        if (msg) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
      }
      pub.disabled = false;
    };
  }
  function renderComentarios(lista) {
    if (!lista || !lista.length) return `<div class="cardbox cm-com-empty"><p class="muted">💬 Sin comentarios todavía. Sé el primero.</p></div>`;
    return lista.map(c =>
      `<div class="cm-com"><div class="cm-com-head"><b>👤 Trabajador</b>
        <span class="small muted">${fmtFecha(c.created_at)}</span></div>
        <p class="cm-com-txt">${esc(c.content)}</p></div>`).join("");
  }

  // Modal ESPECÍFICO del supervisor elegido: resumen (imagen, nombre,
  // cargo, 👍/👎/💬) + comentarios + campo para escribir. El id recibido
  // es el del supervisor cuyo botón COMENTAR se pulsó (nunca otro).
  CM.comentariosSupervisor = function (supId) {
    const sup = supCache[supId] || {};
    const nombre = esc(sup.nombre || "Supervisor");
    const cargo = esc(sup.cargo || "Supervisor/a");
    openModal(`<div class="cm-modal-hd">
        <h2>💬 Comentarios</h2>
        <button class="cm-modal-x" onclick="closeModal()" aria-label="Cerrar">✕</button>
      </div>
      <div class="cm-modal-sup">
        <img class="cm-modal-avatar" src="assets/avatar-supervisor.png" alt="Avatar de ${nombre}" width="72" height="72">
        <div class="cm-modal-supinfo">
          <div class="cm-modal-nombre">${nombre}</div>
          <div class="cm-modal-cargo">${cargo}</div>
          <div class="cm-modal-stats">
            <span class="cm-stat cm-stat-up"><i>👍</i><b id="cmModalLikes">${sup.likes || 0}</b></span>
            <span class="cm-stat cm-stat-down"><i>👎</i><b id="cmModalDislikes">${sup.dislikes || 0}</b></span>
            <span class="cm-stat cm-stat-com"><i>💬</i><b id="cmModalComs">${sup.comentarios || 0}</b></span>
          </div>
        </div>
      </div>
      <div class="cm-modal-sep">💬 Comentarios</div>
      <div id="cmComList" class="cm-com-list"><p class="muted">Cargando comentarios…</p></div>
      <textarea id="cmComTxt" class="inp cm-com-txt" maxlength="500" rows="2"
        placeholder="Escribe un comentario..."></textarea>
      <div id="cmComMsg" class="small"></div>
      <div class="cm-modal-actions">
        <button class="btn cm-comentar" id="cmComPub">📤 PUBLICAR COMENTARIO</button>
      </div>`);
    const list = $("#cmComList");
    const msg = $("#cmComMsg");
    const cargar = async () => {
      const j = await cmFetch("/api/community/supervisors/" + supId + "/comments");
      return renderComentarios(j.comentarios);
    };
    cargar().then(html => { if (list) list.innerHTML = html; })
      .catch(e => { if (list) list.innerHTML = `<p class="muted">❌ ${esc(e.message)}</p>`; });
    const pub = $("#cmComPub");
    if (pub) pub.onclick = async () => {
      const txt = $("#cmComTxt");
      const t = (txt ? txt.value : "").trim();
      if (!t) { if (msg) { msg.textContent = "Escribe un comentario primero."; msg.style.color = "var(--warn)"; } return; }
      if (t.length > 500) { if (msg) { msg.textContent = "Máximo 500 caracteres."; msg.style.color = "var(--warn)"; } return; }
      pub.disabled = true;
      try {
        await cmFetch("/api/community/supervisors/" + supId + "/comments", {
          method: "POST", body: JSON.stringify({ voter_id: voterId, content: t }),
        });
        if (msg) { msg.textContent = "✅ Comentario publicado."; msg.style.color = "var(--accent)"; }
        if (txt) txt.value = "";
        const html = await cargar();
        if (list) list.innerHTML = html;
        // contador real desde D1 (tarjeta + modal), sin recargar la página
        await refrescarComentariosSup(supId);
      } catch (e) {
        if (msg) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
      }
      pub.disabled = false;
    };
  };
  CM.comentariosPost = function (postId) {
    modalComentarios("Comentarios",
      async () => {
        const j = await cmFetch("/api/community/posts/" + postId);
        return renderComentarios(j.comentarios);
      },
      async (t) => {
        await cmFetch("/api/community/posts/" + postId + "/comments", {
          method: "POST", body: JSON.stringify({ voter_id: voterId, content: t }),
        });
      });
  };

  // ============================================================
  //  ADMINISTRACIÓN (protegida por token en el Worker)
  // ============================================================
  function adminFormToken() {
    openModal(`<h2>🔐 Administración de la Comunidad</h2>
      <p class="small muted">Introduce el token de administrador (secreto del Worker). Se usa solo en esta
      sesión y nunca se guarda en el dispositivo.</p>
      <input id="cmAdminTok" type="password" class="inp" style="width:100%" placeholder="Token de administración" autocomplete="off">
      <div id="cmAdminMsg" class="small"></div>
      <div class="actions">
        <button class="btn ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn primary" id="cmAdminGo">🔓 ENTRAR</button>
      </div>`);
    const go = $("#cmAdminGo");
    const msg = $("#cmAdminMsg");
    if (go) go.onclick = async () => {
      const inp = $("#cmAdminTok");
      const tok = (inp ? inp.value : "").trim();
      if (!tok) { if (msg) { msg.textContent = "Escribe el token."; msg.style.color = "var(--warn)"; } return; }
      adminToken = tok;
      go.disabled = true;
      try {
        await cmFetch("/api/community/admin/supervisors");
        adminPanel();
      } catch (e) {
        adminToken = "";
        if (msg) { msg.textContent = "❌ Token incorrecto: " + e.message; msg.style.color = "var(--danger)"; }
        go.disabled = false;
      }
    };
  }
  function adminPanel() {
    openModal(`<h2>🔐 Administración de la Comunidad</h2>
      <div class="chips" style="margin:8px 0">
        <button class="btn small" id="admSup">👷 Supervisores</button>
        <button class="btn small" id="admPosts">📰 Noticias</button>
        <button class="btn small" id="admSurv">📊 Encuestas</button>
        <button class="btn small" id="admCom">💬 Comentarios</button>
      </div>
      <div id="admBody"><p class="muted">Cargando…</p></div>
      <div class="actions">
        <button class="btn ghost" onclick="comunidad.salirAdmin()">🔒 Salir</button>
        <button class="btn ghost" onclick="closeModal()">Cerrar</button>
      </div>`);
    const body = $("#admBody");
    const cargar = async (seccion) => {
      if (seccion === "sup") {
        const j = await cmFetch("/api/community/admin/supervisors");
        const rows = (j.supervisores || []).map(s => `
          <tr><td><b>${esc(s.nombre)}</b><br><span class="small muted">${esc(s.cargo)}</span></td>
          <td>${s.activo ? '<span class="chip" style="color:#4ade80">activo</span>' : '<span class="chip" style="color:var(--muted)">inactivo</span>'}</td>
          <td class="num">👍 ${s.likes} · 👎 ${s.dislikes}</td>
          <td style="white-space:nowrap">
            <button class="btn small" onclick="comunidad.admToggleSup(${s.id})">${s.activo ? "Desactivar" : "Activar"}</button>
            <button class="btn small warn" onclick="comunidad.admBorrarSup(${s.id})">🗑</button>
          </td></tr>`).join("");
        body.innerHTML = `
          <div class="cardbox"><h3>＋ Agregar supervisor</h3>
            <label>Nombre</label><input id="admSupNombre" class="inp" style="width:100%" maxlength="80" placeholder="Nombre del supervisor">
            <label>Cargo (opcional)</label><input id="admSupCargo" class="inp" style="width:100%" maxlength="80" placeholder="Supervisor/a">
            <button class="btn primary" id="admSupAdd" style="margin-top:8px">＋ Agregar</button>
            <div id="admSupMsg" class="small"></div>
          </div>
          <div class="cardbox"><h3>👷 Supervisores</h3>
            <div class="tblwrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Estado</th><th class="num">Votos</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          </div>`;
        const add = $("#admSupAdd");
        if (add) add.onclick = async () => {
          const n = $("#admSupNombre"), c = $("#admSupCargo"), m = $("#admSupMsg");
          if (!n || !n.value.trim()) { if (m) { m.textContent = "El nombre es obligatorio."; m.style.color = "var(--warn)"; } return; }
          try {
            await cmFetch("/api/community/admin/supervisors", {
              method: "POST", body: JSON.stringify({ nombre: n.value.trim(), cargo: c.value.trim() }),
            });
            if (n) n.value = ""; if (c) c.value = "";
            cargar("sup");
          } catch (e) { if (m) { m.textContent = "❌ " + e.message; m.style.color = "var(--danger)"; } }
        };
      } else if (seccion === "posts") {
        const j = await cmFetch("/api/community/admin/posts");
        const rows = (j.posts || []).map(p => `
          <tr><td><span class="chip">${p.type === "noticia" ? "📰" : "📢"} ${esc(p.type)}</span></td>
          <td><b>${esc(p.title)}</b></td>
          <td>${p.status === "activo" ? '<span class="chip" style="color:#4ade80">activo</span>' : '<span class="chip" style="color:var(--muted)">inactivo</span>'}</td>
          <td class="small muted">${fmtFecha(p.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn small" onclick="comunidad.admTogglePost(${p.id})">${p.status === "activo" ? "Ocultar" : "Publicar"}</button>
            <button class="btn small warn" onclick="comunidad.admBorrarPost(${p.id})">🗑</button>
          </td></tr>`).join("");
        body.innerHTML = `
          <div class="cardbox"><h3>＋ Publicar noticia / aviso</h3>
            <div class="grid2">
              <div><label>Tipo</label>
                <select id="admPostTipo" class="inp" style="width:100%">
                  <option value="aviso">📢 Aviso oficial</option><option value="noticia">📰 Noticia</option></select></div>
              <div><label>Categoría (ej. Horario)</label><input id="admPostCat" class="inp" style="width:100%" maxlength="40" placeholder="Comunicado / Horario…"></div>
            </div>
            <label>Título</label><input id="admPostTitulo" class="inp" style="width:100%" maxlength="150" placeholder="Título">
            <label>Contenido</label><textarea id="admPostTexto" class="inp" style="width:100%" rows="3" maxlength="2000" placeholder="Redacta el aviso…"></textarea>
            <label>Imagen (opcional — JPEG/PNG/WEBP, máx 5 MB)</label>
            <input type="file" id="admPostFile" accept="image/jpeg,image/png,image/webp" class="inp">
            <div id="admPostImg" class="small muted"></div>
            <button class="btn primary" id="admPostPub" style="margin-top:8px">📤 PUBLICAR</button>
            <div id="admPostMsg" class="small"></div>
          </div>
          <div class="cardbox"><h3>Publicaciones</h3>
            <div class="tblwrap"><table class="tbl"><thead><tr><th>Tipo</th><th>Título</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div></div>`;
        const pub = $("#admPostPub");
        if (pub) pub.onclick = async () => {
          const msg = $("#admPostMsg");
          const title = ($("#admPostTitulo") || {}).value || "";
          const content = ($("#admPostTexto") || {}).value || "";
          const tipo = ($("#admPostTipo") || {}).value || "aviso";
          const cat = ($("#admPostCat") || {}).value || "";
          if (!title.trim() || !content.trim()) {
            if (msg) { msg.textContent = "Título y contenido son obligatorios."; msg.style.color = "var(--warn)"; } return;
          }
          pub.disabled = true;
          const img = $("#admPostImg");
          try {
            let image_key = null, image_url = null;
            const file = $("#admPostFile");
            if (file && file.files && file.files[0]) {
              const f = file.files[0];
              if (f.size > 5 * 1024 * 1024) throw new Error("La imagen supera 5 MB");
              if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error("Formato no permitido (JPEG/PNG/WEBP)");
              const fr = await cmFetch("/api/community/media", {
                method: "POST",
                headers: { "Content-Type": f.type },
                body: f,
              });
              image_key = fr.image_key; image_url = fr.image_url;
              if (img) img.textContent = "✅ Imagen subida (" + (image_url || "pendiente de URL pública R2") + ")";
            }
            await cmFetch("/api/community/admin/posts", {
              method: "POST", body: JSON.stringify({
                type: tipo, category: cat, title: title.trim(), content: content.trim(),
                image_key, image_url, author: "Administración",
              }),
            });
            if (msg) { msg.textContent = "✅ Publicado."; msg.style.color = "var(--accent)"; }
            cargar("posts");
          } catch (e) {
            if (msg) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; }
            pub.disabled = false;
          }
        };
      } else if (seccion === "surv") {
        const j = await cmFetch("/api/community/admin/surveys");
        const rows = (j.encuestas || []).map(e => `
          <tr><td><b>${esc(e.question)}</b></td>
          <td>${e.status === "activa" ? '<span class="chip" style="color:#4ade80">activa</span>' : '<span class="chip" style="color:var(--muted)">cerrada</span>'}</td>
          <td class="num">${e.total_votos || 0}</td>
          <td style="white-space:nowrap">
            <button class="btn small" onclick="comunidad.admToggleSurvey(${e.id})">${e.status === "activa" ? "Cerrar" : "Abrir"}</button>
            <button class="btn small" onclick="comunidad.admVerSurvey(${e.id})">📊 Resultados</button>
          </td></tr>`).join("");
        body.innerHTML = `
          <div class="cardbox"><h3>＋ Crear encuesta</h3>
            <label>Pregunta</label><input id="admSurvQ" class="inp" style="width:100%" maxlength="300" placeholder="¿Qué horario prefieres?">
            <label>Opciones (mínimo 2, una por línea)</label>
            <textarea id="admSurvOpts" class="inp" style="width:100%" rows="4" placeholder="6:00 AM - 2:00 PM&#10;7:00 AM - 3:00 PM&#10;8:00 AM - 4:00 PM"></textarea>
            <button class="btn primary" id="admSurvAdd" style="margin-top:8px">＋ Crear encuesta</button>
            <div id="admSurvMsg" class="small"></div>
          </div>
          <div class="cardbox"><h3>Encuestas</h3>
            <div class="tblwrap"><table class="tbl"><thead><tr><th>Pregunta</th><th>Estado</th><th class="num">Votos</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div></div>`;
        const add = $("#admSurvAdd");
        if (add) add.onclick = async () => {
          const msg = $("#admSurvMsg");
          const q = ($("#admSurvQ") || {}).value || "";
          const opts = ($("#admSurvOpts") || {}).value.split("\n").map(s => s.trim()).filter(Boolean);
          if (!q.trim() || opts.length < 2) {
            if (msg) { msg.textContent = "Pregunta + al menos 2 opciones."; msg.style.color = "var(--warn)"; } return;
          }
          try {
            await cmFetch("/api/community/admin/surveys", {
              method: "POST", body: JSON.stringify({ question: q.trim(), options: opts }),
            });
            cargar("surv");
          } catch (e) { if (msg) { msg.textContent = "❌ " + e.message; msg.style.color = "var(--danger)"; } }
        };
      } else if (seccion === "com") {
        const j = await cmFetch("/api/community/admin/comments");
        const rows = (j.comentarios || []).slice(0, 100).map(c => `
          <tr><td class="small muted">${fmtFecha(c.created_at)}</td>
          <td>${c.supervisor_id ? "👷 sup #" + c.supervisor_id : c.post_id ? "📰 post #" + c.post_id : "—"}</td>
          <td>${esc(c.content)}</td>
          <td>${c.status === "visible" ? '<span class="chip" style="color:#4ade80">visible</span>' : '<span class="chip" style="color:var(--muted)">oculto</span>'}</td>
          <td style="white-space:nowrap">
            ${c.status === "visible"
              ? '<button class="btn small warn" onclick="comunidad.admOcultarCom(' + c.id + ')">Ocultar</button>'
              : '<button class="btn small" onclick="comunidad.admMostrarCom(' + c.id + ')">Restaurar</button>'}
          </td></tr>`).join("");
        body.innerHTML = `<div class="cardbox"><h3>💬 Comentarios recientes</h3>
          <div class="tblwrap"><table class="tbl"><thead><tr><th>Fecha</th><th>En</th><th>Comentario</th><th>Estado</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">Sin comentarios</td></tr>'}</tbody></table></div></div>`;
      }
    };
    $("#admSup").onclick = () => cargar("sup");
    $("#admPosts").onclick = () => cargar("posts");
    $("#admSurv").onclick = () => cargar("surv");
    $("#admCom").onclick = () => cargar("com");
    cargar("sup").catch(e => { body.innerHTML = `<p class="muted">❌ ${esc(e.message)}</p>`; });
  }
  CM.salirAdmin = function () { adminToken = ""; closeModal(); toastShow("🔒 Sesión de administración cerrada"); };

  CM.admToggleSup = async (id) => {
    try {
      const j = await cmFetch("/api/community/admin/supervisors");
      const s = (j.supervisores || []).find(x => x.id === id);
      await cmFetch("/api/community/admin/supervisors/" + id, {
        method: "PATCH", body: JSON.stringify({ activo: s ? !s.activo : true }),
      });
      adminPanel();
    } catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admBorrarSup = async (id) => {
    if (!confirm("¿Desactivar este supervisor? (borrado lógico, se puede reactivar)")) return;
    try { await cmFetch("/api/community/admin/supervisors/" + id, { method: "DELETE" }); adminPanel(); }
    catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admTogglePost = async (id) => {
    try {
      const j = await cmFetch("/api/community/admin/posts");
      const p = (j.posts || []).find(x => x.id === id);
      await cmFetch("/api/community/admin/posts/" + id, {
        method: "PATCH", body: JSON.stringify({ status: p && p.status === "activo" ? "inactivo" : "activo" }),
      });
      adminPanel();
    } catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admBorrarPost = async (id) => {
    if (!confirm("¿Ocultar esta publicación?")) return;
    try { await cmFetch("/api/community/admin/posts/" + id, { method: "DELETE" }); adminPanel(); }
    catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admToggleSurvey = async (id) => {
    try {
      const j = await cmFetch("/api/community/admin/surveys");
      const s = (j.encuestas || []).find(x => x.id === id);
      await cmFetch("/api/community/admin/surveys/" + id, {
        method: "PATCH", body: JSON.stringify({ status: s && s.status === "activa" ? "cerrada" : "activa" }),
      });
      adminPanel();
    } catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admVerSurvey = async (id) => {
    try {
      const j = await cmFetch("/api/community/admin/surveys");
      const s = (j.encuestas || []).find(x => x.id === id);
      if (!s) return toastShow("No encontrada", true);
      const total = s.total_votos || 0;
      const opts = (s.opciones || []).map(o => {
        const pct = total > 0 ? Math.round((o.votos / total) * 100) : 0;
        return `<div class="cm-surv-res"><div class="cm-surv-lbl">${esc(o.option_text)} <b class="num">${o.votos} · ${pct}%</b></div>
          <div class="cm-surv-bar"><div style="width:${pct}%"></div></div></div>`;
      }).join("");
      openModal(`<h2>📊 ${esc(s.question)}</h2><p class="small muted">${total} voto(s)</p>${opts}
        <div class="actions"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
    } catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admOcultarCom = async (id) => {
    try { await cmFetch("/api/community/admin/comments/" + id, { method: "DELETE" }); adminPanel(); }
    catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admMostrarCom = async (id) => {
    try {
      await cmFetch("/api/community/admin/comments/" + id, {
        method: "PATCH", body: JSON.stringify({ status: "visible" }),
      });
      adminPanel();
    } catch (e) { toastShow("❌ " + e.message, true); }
  };
  CM.admin = function () {
    if (adminToken) { adminPanel(); return; }
    adminFormToken();
  };

  // ---------- cargador por pestaña (invocado desde app.js) ----------
  CM.load = async function (name) {
    try {
      if (name === "noticias") return await CM.noticias();
      if (name === "encuestas") return await CM.encuestas();
      if (name === "supervisores") return await CM.supervisores();
    } catch (e) {
      const panel = $("#panel-" + name);
      if (panel) panel.innerHTML = errBox(e.message);
    }
  };

  window.comunidad = CM;
})();
