# Patrones y tablas léxicas compartidas por los analizadores.
import re

HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

# Verbos de acción típicos de rutas MVC/API en español (ASP.NET, etc.)
ACTION_VERBS = (
    "Obtener", "Consultar", "Guardar", "Registrar", "Actualizar", "Enviar",
    "Insertar", "Eliminar", "Borrar", "Buscar", "Listar", "Ver", "Get", "Set",
    "Save", "Create", "Update", "Delete", "Sync", "Login", "Logout",
    "Descargar", "Exportar", "Importar", "Ranking", "Detalle", "Validar",
    "Cambiar", "Cerrar", "Generar", "Procesar", "Anular", "Rechazar",
    "Aprobar", "Subir", "Adjuntar", "Marcar", "Reporte", "Report", "Estado",
    "Recuperar", "IniciarSesion", "CerrarSesion", "Restablecer", "Reset",
    "Editar", "Quitar", "Agregar", "ActualizarKg", "RegistrarKg", "GuardarKg",
)

# Prefijos que por convención denotan LECTURA (seguros de sondear con GET)
READ_PREFIX = (
    "Obtener", "Consultar", "Buscar", "Listar", "Ver", "Get", "Ranking",
    "Detalle", "Descargar", "Exportar", "Generar", "Reporte", "Report",
    "Validar", "Estado", "Recuperar", "Ultimo", "Ultima", "Hoy", "Top",
)

# Marcas de ESCRITURA: jamás se sondearán (aunque se vean como GET en código)
WRITE_TOKENS = (
    "Guardar", "Registrar", "Actualizar", "Enviar", "Insertar", "Eliminar",
    "Borrar", "Save", "Create", "Update", "Delete", "Sync", "Login",
    "IniciarSesion", "CerrarSesion", "Cambiar", "Anular", "Rechazar",
    "Aprobar", "Subir", "Adjuntar", "Marcar", "Procesar", "Importar",
    "Reset", "Restablecer", "Editar", "Quitar", "Agregar", "Cerrar",
    "GuardarKg", "RegistrarKg", "ActualizarKg",
)

STATIC_EXTS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".map", ".mp4", ".webp", ".pdf",
    ".txt", ".xml", ".less", ".scss",
}

# --- Expresiones para descubrir URLs / endpoints dentro de texto ---------
URL_RE = re.compile(r"https?://[A-Za-z0-9_\-.:@%+/~?#=&!$'()*,;\[\]]+")
ROOT_PATH_RE = re.compile(r"""['"`](/[A-Za-z0-9_\-./{}?=&%]+)['"`]""")
QR_PATH_RE = re.compile(r"""['"`]([A-Za-z0-9_\-./]*QrKgAra[A-Za-z0-9_\-./{}?=&%]*)['"`]""")
ACTION_NAME_RE = re.compile(r"/(%s)[A-Za-z0-9_]*" % "|".join(ACTION_VERBS))

AJAX_CALL_RE = re.compile(
    r"(?:\$|jQuery)\.(?:ajax|get|post|getJSON|put|delete)\s*\(|fetch\s*\(|axios\.(?:get|post|put|patch|delete)\s*\(|XMLHttpRequest"
)
FETCH_URL_RE = re.compile(r"fetch\(\s*['\"`]([^'\"`]+)['\"`]")
JQ_METHOD_URL_RE = re.compile(r"\$\.(get|post|getJSON|put|delete)\(\s*['\"`]([^'\"`]+)['\"`]")
AJAX_URL_KEY_RE = re.compile(r"url\s*:\s*['\"`]([^'\"`]+)['\"`]")
AXIOS_URL_RE = re.compile(r"axios\.(get|post|put|patch|delete)\(\s*['\"`]?([^'\"`),]+)")
WS_URL_RE = re.compile(r"new\s+WebSocket\(\s*['\"`]([^'\"`]+)['\"`]")
SIGNALR_OLD_RE = re.compile(r"(?:signalR|\.connection\.|hubProxy|createHubProxy|/signalr/hubs)")
SIGNALR_NEW_RE = re.compile(r"HubConnectionBuilder|withUrl\(\s*['\"`]([^'\"`]+)['\"`]|\.invoke\(\s*['\"`]([^'\"`]+)['\"`]|\.on\(\s*['\"`]([^'\"`]+)['\"`]")

JSON_STRINGIFY_RE = re.compile(r"JSON\.stringify")
FORM_DATA_RE = re.compile(r"FormData")
STORAGE_RE = re.compile(r"localStorage|sessionStorage")

# --- Palabras clave del dominio KG / cosecha (análisis de integridad) ----
KG_KEYWORDS = {
    "kg": r"\bkg\b", "kgs": r"\bkgs?\b", "kilo": r"\bkilo\w*",
    "peso": r"\bpeso\w*", "cosecha": r"\bcosech\w*", "trabajador": r"\btrabajador\w*",
    "dni": r"\bdni\b", "fecha": r"\bfecha\w*", "lote": r"\blote\w*",
    "variedad": r"\bvariedad\w*", "ranking": r"\branking\w*",
    "registro": r"\bregistr\w*", "actualizacion": r"\bactualiz\w*",
    "jefe": r"\bjefe\w*", "cuadrilla": r"\bcuadrilla\w*", "grupo": r"\bgrupo\w*",
    "posicion": r"\bposicion\w*", "exportable": r"\bexportable\b",
    "descarte": r"\bdescarte\w*", "total": r"\btotal\w*", "top": r"\btop\b",
    "cosechador": r"\bcosechador\w*", "pesada": r"\bpesad\w*",
    "kgtotal": r"\bkgtotal\w*", "kgexportable": r"\bkgexportable\w*",
    "kgdescarte": r"\bkgdescarte\w*", "horas": r"\bhora\w*", "jornada": r"\bjornada\w*",
}

ERROR_WORDS_RE = re.compile(
    r"\berror\b|\berrors?\b|success\s*:\s*false|status\s*:\s*['\"]?error|exception|"
    r"\"message\"|mensaje|warning|\bnull\b|timeout|no autorizado|no encontrado|"
    r"no se pudo|ocurri[oó] un error|fall[oó]|invalid|not found|unauthorized"
)


def is_static_path(p: str) -> bool:
    q = p.split("?", 1)[0].lower()
    return any(q.endswith(e) for e in STATIC_EXTS) or "/content/" in q.lower()


def action_part(path: str):
    """Devuelve el primer token tipo acción de la ruta (p. ej. ObtenerRankingVista)."""
    m = ACTION_NAME_RE.search(path)
    if m:
        return m.group(1)
    for seg in path.split("/"):
        for v in ACTION_VERBS:
            if seg.startswith(v) and len(seg) > len(v) - 2:
                return seg
    return None


def is_read_action(action: str) -> bool:
    return any(action.startswith(p) for p in READ_PREFIX) and not is_write_action(action)


def is_write_action(action: str) -> bool:
    return any(t in action for t in WRITE_TOKENS)
