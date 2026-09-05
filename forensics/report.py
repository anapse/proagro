# Generación de informes forenses: JSON + HTML (+ PDF vía Chromium).
import json
from pathlib import Path

from . import db, now_iso, ts_tag, REPORTS_DIR
from .engine import browser as brow

SECTION_TITLES = [
    "Resumen ejecutivo", "URL analizada", "Fecha y hora", "Alcance",
    "Limitaciones", "Recursos encontrados", "JavaScript", "Bundles",
    "Endpoints", "Network map", "SignalR", "Errores",
    "Errores JavaScript", "Posibles fallos silenciosos", "Análisis KG",
    "Consistencia de respuestas", "Rendimiento observado", "Evidencias",
    "Hallazgos", "Recomendaciones", "Conclusiones",
]


def collect(audit_id):
    a = db.q1("SELECT * FROM audits WHERE id=?", (audit_id,))
    if not a:
        raise ValueError("auditoría no existe")
    proj = db.q1("SELECT * FROM projects WHERE id=?", (a["project_id"],))
    summary = json.loads(a["summary_json"] or "{}")
    return {
        "audit": a, "project": proj, "summary": summary,
        "requests": db.q("SELECT * FROM requests WHERE audit_id=? ORDER BY id", (audit_id,)),
        "responses": db.q("SELECT * FROM responses WHERE audit_id=? ORDER BY id", (audit_id,)),
        "scripts": db.q("SELECT * FROM scripts WHERE audit_id=? ORDER BY id", (audit_id,)),
        "endpoints": db.q("SELECT * FROM endpoints WHERE audit_id=? ORDER BY classification, path",
                          (audit_id,)),
        "findings": db.q("SELECT * FROM findings WHERE audit_id=? ORDER BY id", (audit_id,)),
        "kg_flows": db.q("SELECT * FROM kg_flows WHERE audit_id=? ORDER BY id", (audit_id,)),
        "changes": db.q("SELECT * FROM changes WHERE audit_id=? ORDER BY id", (audit_id,)),
        "evidence": db.q("SELECT * FROM evidence WHERE audit_id=? ORDER BY id", (audit_id,)),
        "snapshots": db.q("SELECT * FROM snapshots WHERE audit_id=? ORDER BY id DESC LIMIT 1",
                          (audit_id,)),
    }


def generate(audit_id, want_pdf=True):
    """Genera informe JSON + HTML (+PDF si chromium disponible)."""
    data = collect(audit_id)
    tag = ts_tag()
    stem = f"PROAGRO_WEB_FORENSICS_{tag}"
    data["stem"] = stem
    json_path = REPORTS_DIR / f"{stem}.json"
    html_path = REPORTS_DIR / f"{stem}.html"
    pdf_path = REPORTS_DIR / f"{stem}.pdf"

    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str),
                         encoding="utf-8")
    html_path.write_text(render_html(data), encoding="utf-8")
    db.insert("reports", {"audit_id": audit_id, "kind": "json",
                          "path": json_path.relative_to(REPORTS_DIR.parent).as_posix(),
                          "created_at": now_iso()})
    db.insert("reports", {"audit_id": audit_id, "kind": "html",
                          "path": html_path.relative_to(REPORTS_DIR.parent).as_posix(),
                          "created_at": now_iso()})
    pdf_ok = False
    if want_pdf:
        try:
            brow.html_to_pdf(html_path, pdf_path)
            db.insert("reports", {"audit_id": audit_id, "kind": "pdf",
                                  "path": pdf_path.relative_to(REPORTS_DIR.parent).as_posix(),
                                  "created_at": now_iso()})
            pdf_ok = True
        except Exception as e:
            pdf_ok = f"PDF no generado: {e}"
    return {
        "stem": stem,
        "json": json_path.relative_to(REPORTS_DIR.parent).as_posix(),
        "html": html_path.relative_to(REPORTS_DIR.parent).as_posix(),
        "pdf": pdf_path.relative_to(REPORTS_DIR.parent).as_posix() if pdf_ok is True else None,
        "pdf_note": pdf_ok if pdf_ok is not True else None,
    }


# ---------------------------------------------------------------- HTML ----
def render_html(d):
    a = d["audit"]; proj = d["project"]; s = d["summary"]
    main = s.get("main_ranking") or {}
    ep_obs = sum(1 for e in d["endpoints"] if e["classification"] == "OBSERVADO")
    ep_ref = sum(1 for e in d["endpoints"] if e["classification"] == "REFERENCIADO")
    ep_pos = sum(1 for e in d["endpoints"] if e["classification"] == "POSIBLE")
    sev_counts = {}
    for f in d["findings"]:
        sev_counts[f["severity"]] = sev_counts.get(f["severity"], 0) + 1
    sev_bar = "".join(f'<span class="sev s-{k.lower()}">{k}: {v}</span> '
                      for k, v in sorted(sev_counts.items()))

    def tbl(headers, rows, cls="grid"):
        h = "".join(f"<th>{x}</th>" for x in headers)
        body = ""
        for r in rows:
            body += "<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>"
        return (f'<table class="{cls}"><thead><tr>{h}</tr></thead>'
                f"<tbody>{body or '<tr><td colspan=99>—</td></tr>'}</tbody></table>")

    frows = "".join(
        f"""<tr>
        <td>{f['fid']}</td><td><span class="klass k-{f['klass'].split()[0].lower()}">{f['klass']}</span></td>
        <td><span class="sev s-{f['severity'].lower()}">{f['severity']}</span></td>
        <td>{f['finding_type']}</td><td><b>{f['title']}</b></td>
        <td class="sm">{f['description']}</td>
        <td class="sm mono">{f['endpoint'] or ''}<br>{f['file'] or ''}</td>
        <td>{f['confidence']}</td><td class="sm">{f['recommendation'] or ''}</td></tr>"""
        for f in d["findings"])
    erows = "".join(
        f"<tr><td class='mono sm'>{e['url']}</td><td>{e['method']}</td><td>{e['status']}</td>"
        f"<td>{e['kind']}</td><td>{e.get('content_type','')}</td><td>{e['size']}</td>"
        f"<td>{e['ttfb_ms']}</td><td>{e['total_ms']}</td><td class='mono sm'>{e['sha256'] or ''}</td>"
        f"<td>{e['error'] or ''}</td></tr>" for e in d["requests"][:250])
    nrows = "".join(
        f"<tr><td class='mono'>{e['path']}</td><td>{e['method'] or '—'}</td>"
        f"<td>{e['classification']}</td><td>{e['endpoint_type']}</td>"
        f"<td>{e['status']}</td><td class='sm'>{(e.get('params_json') or '').replace(chr(34), '')}</td>"
        f"<td class='sm mono'>{e['source_file'] or ''}</td>"
        f"<td class='sm'>{e['notes'] or ''}</td></tr>" for e in d["endpoints"])
    srows = "".join(
        f"<tr><td class='mono sm'>{sc['url']}</td><td>{sc['name']}</td><td>{sc['kind']}</td>"
        f"<td>{sc['size']}</td><td class='mono sm'>{sc['sha256'][:20] or ''}…</td>"
        f"<td>{sc['status']}</td><td class='sm'>{sc['error'] or ''}</td></tr>" for sc in d["scripts"])
    kgrows = "".join(
        f"<tr><td>{k['screen']}</td><td class='sm mono'>{k['file'] or ''}</td>"
        f"<td>{k['request_desc']}</td><td class='mono sm'>{k['endpoint'] or ''}</td>"
        f"<td class='sm'>{k['keyword'] or ''}</td></tr>" for k in d["kg_flows"])
    evrows = "".join(
        f"<tr><td class='mono sm'>{e['path']}</td><td>{e['category']}</td><td>{e['filename']}</td>"
        f"<td>{e['size']}</td><td class='mono sm'>{e['sha256'][:24]}…</td>"
        f"<td class='sm'>{e['url'][:120]}</td></tr>" for e in d["evidence"][:150])
    crows = "".join(f"<tr><td>{c['kind']}</td><td class='sm'>{c['description']}</td></tr>"
                    for c in d["changes"])

    cons = s.get("consistency") or {}
    con_rows = "".join(
        f"<tr><td>{r['n']}</td><td>{r['ts']}</td><td>{r['status']}</td><td>{r['size']}</td>"
        f"<td>{r['ttfb_ms']}</td><td>{r['total_ms']}</td><td>{r.get('records','')}</td>"
        f"<td>{r.get('sum_kgTotal','')}</td><td class='mono sm'>{r['sha256'][:24]}…</td></tr>"
        for r in cons.get("runs", []))

    sig = s.get("signalr") or []
    sigrows = "".join(
        f"<tr><td class='mono sm'>{x.get('file','')}</td><td>{x.get('style','')}</td>"
        f"<td class='sm'>{', '.join(x.get('hub_urls') or [])}</td>"
        f"<td class='sm'>{', '.join(x.get('server_calls') or [])[:200]}</td>"
        f"<td class='sm'>{', '.join(x.get('client_methods') or [])[:200]}</td></tr>"
        for x in sig)

    lims = [
        "Sin acceso al servidor, base de datos, credenciales ni código fuente.",
        "Análisis exclusivamente de lo observable vía HTTP público y navegador.",
        "Solo consultas GET de lectura; sin escritura ni envío de formularios.",
        "Las cifras de Kg corresponden a datos publicados por la propia aplicación.",
        "La actividad legítima de otros usuarios puede alterar respuestas entre consultas.",
    ]
    html = f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>{d['stem']}</title><style>
body{{font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;margin:24px;color:#222}}
h1{{font-size:20px;border-bottom:3px solid #0b5e3b;padding-bottom:6px}}
h2{{font-size:15px;color:#0b5e3b;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:3px}}
h3{{font-size:13px;margin:8px 0 2px}}
table{{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:11.5px}}
th,td{{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}}
th{{background:#eef4ef}} .mono{{font-family:Consolas,monospace;font-size:10.5px}}
.sm{{font-size:11px;max-width:340px;word-break:break-word}}
.klass{{font-weight:700}} .k-hecho{{color:#0b5e3b}}.k-indicio{{color:#a06a00}}
.k-hipotesis{{color:#6a3d9a}}.k-prueba{{color:#666}}
.sev{{font-weight:700}} .s-info{{color:#1a73a8}}.s-low{{color:#2e7d32}}
.s-medium{{color:#e65100}}.s-high{{color:#c62828}}.s-critical{{color:#8e0000}}
.cards{{display:flex;gap:10px;flex-wrap:wrap}} .card{{border:1px solid #bbb;border-radius:6px;
padding:6px 12px;background:#f7faf8}}
pre{{background:#f5f5f5;padding:8px;font-size:10.5px;overflow:auto;max-height:220px}}
ul{{margin:4px 0 8px 18px}}
</style></head><body>
<h1>PROAGRO WEB FORENSICS — Informe técnico</h1>
<div class="sm">{d['stem']} · clasificación: HECHO OBSERVADO / INDICIO / HIPÓTESIS / PRUEBA PENDIENTE</div>
<h2>1. Resumen ejecutivo</h2>
<p>Auditoría read-only de la aplicación pública. Se descargaron <b>{len(d['scripts'])}</b> archivos JS,
se mapearon <b>{len(d['endpoints'])}</b> endpoints ({ep_obs} observados, {ep_ref} referenciados, {ep_pos} posibles),
<b>{len(d['requests'])}</b> peticiones registradas y <b>{len(d['findings'])}</b> hallazgos.
Ranking principal: <b>{main.get('records','—')}</b> registros, suma kgTotal <b>{main.get('sum_kgTotal','—')}</b>.
</p><p>{sev_bar or ''}</p>
<h2>2. URL analizada</h2><p class="mono">{proj['url']}</p>
<h2>3. Fecha y hora</h2><p>Inicio: {a['started_at']} · Fin: {a['finished_at']} · Duración: {s.get('elapsed_s')} s · Modo: {a['mode']}</p>
<h2>4. Alcance</h2><p>Observación pasiva del sitio y sus recursos públicos; consultas GET normales de solo lectura.</p>
<h2>5. Limitaciones</h2><ul>{''.join(f'<li>{x}</li>' for x in lims)}</ul>
<h2>6. Recursos encontrados</h2>
{tbl(['Tipo','Cantidad'], [['HTML',1],['JavaScript',len(d['scripts'])],['Endpoints',len(d['endpoints'])],
['Peticiones',len(d['requests'])],['Respuestas JSON guardadas',len(d['responses'])]])}
<h2>7. JavaScript</h2>
{srows or '<p>Sin scripts.</p>'}
<h2>8. Bundles</h2><p>Archivos de tipo external/hub analizados por el escáner (llamadas AJAX, fetch, keywords KG, SignalR).</p>
<h2>9. Endpoints</h2>
{tbl(['Ruta','Método','Clasificación','Tipo','Estado','Parámetros','Fuente','Notas'],
[[f'<span class="mono sm">{e["path"]}</span>', e['method'] or '—', e['classification'],
  e['endpoint_type'], e['status'], (e.get('params_json') or '').replace(chr(34), ''),
  f'<span class="mono sm">{e["source_file"] or ""}</span>',
  e['notes'] or ''] for e in d['endpoints']])}
<h2>10. Network map</h2>
<pre>PÁGINA ({proj['url']})
   └── HTML ({len(d['requests'])} peticiones totales registradas)
         └── JavaScript ({len(d['scripts'])} archivos)
               └── AJAX / FETCH (verbos detectados en código)
                     └── ENDPOINTS /QrKgAra/…
                           └── RESPUESTA JSON (ranking, lotes, variedades)
{'SignalR/WebSocket: ' + (json.dumps([x.get('file') for x in sig])) if sig else 'SignalR/WebSocket: sin referencias activas detectadas'}</pre>
<h2>11. SignalR</h2>
{'Sin referencias a SignalR/WebSocket en el código observable.' if not sig else tbl(['Archivo','Estilo','Hub URLs','Server calls','Client methods'],
 [[f'<span class="mono sm">{x.get("file","")}</span>', x.get('style',''), ', '.join(x.get('hub_urls') or []),
   ', '.join(x.get('server_calls') or [])[:200], ', '.join(x.get('client_methods') or [])[:200]] for x in sig])}
<p class="sm">Hubs detectados: {', '.join(s.get('hub_urls') or []) or '—'}</p>
<h2>12. Errores</h2><p>Errores HTTP y HTTP-200-con-error JSON, si los hubo:</p>
{frows and '' or '<p class="sm">Sin hallazgos de error — ver tabla de hallazgos.</p>'}
<h2>13. Errores JavaScript</h2><p class="sm">console.error/pageerror/peticiones fallidas capturadas en modo navegador (ver hallazgos JS_ERROR y logs/).</p>
<h2>14. Posibles fallos silenciosos</h2><p class="sm">Hallazgos POSSIBLE_SILENT_FAILURE ({sum(1 for f in d['findings'] if f['finding_type']=='POSSIBLE_SILENT_FAILURE')}): patrones de código que podrían tragar errores; son INDICIO, no prueba de pérdida.</p>
<h2>15. Análisis KG</h2>
{kgrows and tbl(['Pantalla','Bundle','Acción correlacionada','Endpoints cercanos','Keywords'], [[
  k['screen'], f'<span class="mono sm">{k["file"] or ""}</span>', k['request_desc'],
  f'<span class="mono sm">{k["endpoint"] or ""}</span>', k['keyword'] or ''] for k in d['kg_flows']]) or '<p>Sin correlaciones KG encontradas.</p>'}
<h2>16. Consistencia de respuestas</h2>
{con_rows and tbl(['#','Hora','HTTP','Bytes','TTFB ms','Total ms','Registros','Suma kgTotal','SHA-256'],
 [[r['n'], r['ts'], r['status'], r['size'], r['ttfb_ms'], r['total_ms'], r.get('records',''),
   r.get('sum_kgTotal',''), f'<span class="mono sm">{r["sha256"][:24]}…</span>'] for r in cons.get('runs',[])]) or '<p>No ejecutada.</p>'}
<h2>17. Rendimiento observado</h2>
<p class="sm">TTFB/total de cada petición en la tabla Network. Consulta principal: TTFB {main.get('ttfb_ms')} ms sobre el ranking — ver JSON.</p>
<h2>18. Evidencias</h2>
<p class="sm">Snapshot: <span class="mono">{d['snapshots'][0]['dir'] if d['snapshots'] else '—'}</span> con manifiesto de SHA-256 por archivo.</p>
{evrows and tbl(['Archivo (rel.)','Categoría','Nombre','Bytes','SHA-256','URL'], [
  [f'<span class="mono sm">{e["path"]}</span>', e['category'], e['filename'], e['size'],
   f'<span class="mono sm">{e["sha256"][:24]}…</span>', f'<span class="sm">{e["url"][:110]}</span>']
  for e in d['evidence'][:60]]) or ''}
<h2>19. Hallazgos</h2>
{tbl(['ID','Clase','Severidad','Tipo','Título','Descripción','Archivo/Endpoint','Confianza','Recomendación'],
 [[f['fid'], f'<span class="klass k-{f["klass"].split()[0].lower()}">{f["klass"]}</span>',
   f'<span class="sev s-{f["severity"].lower()}">{f["severity"]}</span>', f['finding_type'],
   f'<b>{f["title"]}</b>', f'<span class="sm">{f["description"]}</span>',
   f'<span class="sm mono">{f["endpoint"] or ""}<br>{f["file"] or ""}</span>',
   f['confidence'], f'<span class="sm">{f["recommendation"] or ""}</span>'] for f in d['findings']])}
<h2>20. Recomendaciones</h2>
<ul>
<li>Repetir la auditoría en horas de inactividad declarada para aislar cambios legítimos.</li>
<li>Si se sospecha discrepancia de Kg, correlacionar un envío real propio (sesión autenticada del cosechador) contra la consulta pública minutos después — requiere DNI propio y autorización.</li>
<li>Verificar hallazgos POSSIBLE_SILENT_FAILURE en el código real con el equipo de desarrollo de PROAGRO.</li>
</ul>
<h2>21. Conclusiones</h2>
<p>Esta auditoría documenta lo observado y separa hechos de hipótesis. {changes_summary(d['changes'])}</p>
<div class="sm" style="margin-top:14px;color:#777">Generado por PROAGRO-WEB-FORENSICS el {now_iso()} · read-only · sin credenciales</div>
</body></html>"""
    return html


def changes_summary(changes):
    if not changes:
        return "Primera auditoría del proyecto."
    return "; ".join(c["description"] for c in changes[:6])
