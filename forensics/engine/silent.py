# Detección de PATRONES de posible fallo silencioso en JavaScript.
# Importante: la presencia de un patrón NO demuestra pérdida de datos;
# los hallazgos se emiten como INDICIO con confianza baja/media.
import re

# --- heurísticas ---------------------------------------------------------
EMPTY_CATCH = re.compile(r"catch\s*(\([^)]*\))?\s*\{\s*\}")
EMPTY_FAIL = re.compile(r"\.fail\s*\(\s*(function\s*)?\(?[^)]*\)?\s*\{\s*\}")
EMPTY_CATCH_ARROW = re.compile(r"\.catch\s*\(\s*\(?[^)]*\)?\s*=>\s*\{\s*\}")
THEN_WITHOUT_CATCH = re.compile(r"\.then\s*\(")
AJAX_WITHOUT_ERROR = re.compile(r"\$\.ajax\s*\(")
FETCH_CALL = re.compile(r"fetch\s*\(")
SUCCESS_BEFORE_SERVER = re.compile(r"(alert|showMessage|notify|toast|swal|sweetalert|mensaje)\s*\([^)]*\)", re.IGNORECASE)


def _line(text, pos):
    return text.count("\n", 0, pos) + 1


def _snippet(text, pos, w=180):
    s = max(0, pos - 60)
    e = min(len(text), pos + w)
    return ("..." if s > 0 else "") + text[s:e] + ("..." if e < len(text) else "")


def scan_silent_patterns(text: str, source: str = "", limit=80):
    """Devuelve hallazgos candidatos POSSIBLE_SILENT_FAILURE (sin escribir BD)."""
    findings = []
    if not text:
        return findings

    for m in EMPTY_CATCH.finditer(text):
        findings.append({
            "finding_type": "POSSIBLE_SILENT_FAILURE",
            "pattern": "catch-vacio",
            "title": "Bloque catch vacío: el error se ignora en silencio",
            "severity": "MEDIUM" if _looks_tx(text, m.start()) else "LOW",
            "klass": "INDICIO",
            "confidence": "media",
            "file": source, "line": _line(text, m.start()),
            "snippet": _snippet(text, m.start()),
            "description": ("Se encontró un bloque catch sin cuerpo. Si la petición "
                            "falla, la aplicación continúa sin informar al usuario."),
            "recommendation": ("Registrar el error y mostrarlo; verificar manualmente "
                               "un caso de fallo real antes de concluir."),
        })

    for m in EMPTY_FAIL.finditer(text):
        findings.append({
            "finding_type": "POSSIBLE_SILENT_FAILURE",
            "pattern": "fail-vacio",
            "title": "Handler .fail() vacío: error AJAX sin tratamiento",
            "severity": "MEDIUM", "klass": "INDICIO", "confidence": "media",
            "file": source, "line": _line(text, m.start()),
            "snippet": _snippet(text, m.start()),
            "description": "El handler de error de jQuery no hace nada observable.",
            "recommendation": "Revisar qué hace la UI cuando la petición falla.",
        })

    for m in EMPTY_CATCH_ARROW.finditer(text):
        findings.append({
            "finding_type": "POSSIBLE_SILENT_FAILURE",
            "pattern": "catch-arrow-vacio",
            "title": ".catch() vacío en promesa fetch/ajax",
            "severity": "MEDIUM", "klass": "INDICIO", "confidence": "media",
            "file": source, "line": _line(text, m.start()),
            "snippet": _snippet(text, m.start()),
            "description": "Promesa con catch sin cuerpo: el rechazo se traga.",
            "recommendation": "Verificar el flujo de error en ejecución real.",
        })

    # fetch( ... ) cuyo entorno inmediato no contiene .ok ni catch
    for m in FETCH_CALL.finditer(text):
        seg = text[m.start():m.start() + 700]
        if ".ok" not in seg and "catch" not in seg:
            findings.append({
                "finding_type": "POSSIBLE_SILENT_FAILURE",
                "pattern": "fetch-sin-ok",
                "title": "fetch() sin comprobación de response.ok visible",
                "severity": "MEDIUM", "klass": "INDICIO", "confidence": "baja",
                "file": source, "line": _line(text, m.start()),
                "snippet": _snippet(text, m.start()),
                "description": ("En los ~700 caracteres siguientes a fetch() no se ve "
                                "comprobación de response.ok ni catch. Un HTTP 200 con "
                                "JSON de error podría tratarse como éxito."),
                "recommendation": ("Comprobar si la cadena de promesas valida "
                                   "response.ok/status más adelante."),
            })

    # $.ajax({...}) sin clave error: en los siguientes 900 caracteres
    for m in AJAX_WITHOUT_ERROR.finditer(text):
        seg = text[m.start():m.start() + 900]
        if "error" not in seg:
            findings.append({
                "finding_type": "POSSIBLE_SILENT_FAILURE",
                "pattern": "ajax-sin-error",
                "title": "$.ajax sin handler 'error' en el objeto de opciones",
                "severity": "MEDIUM", "klass": "INDICIO", "confidence": "baja",
                "file": source, "line": _line(text, m.start()),
                "snippet": _snippet(text, m.start()),
                "description": ("No se ve clave 'error' en el objeto $.ajax "
                                "(puede haber .fail() encadenado o handler global)."),
                "recommendation": "Buscar .fail()/ajaxError global en el mismo bundle.",
            })

    # .then( encadenado sin ningún catch/fail en el resto de la línea/expresión
    # (solo para código con saltos de línea legibles; en minificado se omite)
    if text.count("\n") > 3:
        for m in THEN_WITHOUT_CATCH.finditer(text):
            end = text.find("\n", m.start())
            if end == -1:
                end = min(len(text), m.start() + 1200)
            seg = text[m.start():end]
            if ".catch" not in seg and ".fail" not in seg and "catch(" not in seg:
                findings.append({
                    "finding_type": "POSSIBLE_SILENT_FAILURE",
                    "pattern": "then-sin-catch",
                    "title": ".then() sin .catch/.fail en la misma expresión",
                    "severity": "LOW", "klass": "INDICIO", "confidence": "baja",
                    "file": source, "line": _line(text, m.start()),
                    "snippet": _snippet(text, m.start(), 240),
                    "description": "Cadena de promesa sin manejo de rechazo visible.",
                    "recommendation": "Confirmar manejo global de errores.",
                })
    return findings[:limit]


def _looks_tx(text, pos):
    """¿El fragmento parece parte de un envío de datos (POST/guardar)?"""
    seg = text[max(0, pos - 900):pos + 200]
    return any(w in seg for w in ("Guardar", "Registrar", "Enviar", "Save",
                                  "Create", "Update", "ajax", "fetch", "post"))
