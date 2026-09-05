# PROAGRO-WEB-FORENSICS — paquete principal.
# Herramienta read-only de análisis técnico/forense del sitio público
# https://digital.proagro.pe/QrKgAra/QrKgAra
from pathlib import Path
import datetime
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
EVIDENCE_DIR = ROOT / "evidence"
JAVASCRIPT_DIR = EVIDENCE_DIR / "javascript"
SNAPSHOT_DIR = ROOT / "snapshots"
REPORTS_DIR = ROOT / "reports"
DB_PATH = DATA_DIR / "forensics.db"
WEB_DIR = ROOT / "web"
TESTS_DIR = ROOT / "tests"

for _d in (DATA_DIR, EVIDENCE_DIR, JAVASCRIPT_DIR, SNAPSHOT_DIR, REPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DEFAULT_URL = "https://digital.proagro.pe/QrKgAra/QrKgAra"


def now_iso():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def ts_tag():
    return datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p) -> str:
    return sha256_bytes(Path(p).read_bytes())


def safe_name(s: str, maxlen: int = 80) -> str:
    s = re.sub(r"[^A-Za-z0-9._\-]+", "_", s).strip("_")
    return s[:maxlen] or "x"


def save_json(obj, path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# Cabeceras HTTP que se conservan como evidencia. Se excluyen cookies,
# tokens y cabeceras privadas por diseño (requisito de privacidad).
HEADERS_ALLOW = {
    "content-type", "content-length", "date", "server", "last-modified",
    "etag", "cache-control", "expires", "vary", "location",
    "x-aspnetmvc-version", "x-aspnet-version", "x-powered-by",
    "content-encoding", "content-disposition", "pragma", "age",
    "accept-ranges", "transfer-encoding", "retry-after", "allow",
    "x-frame-options", "x-content-type-options", "strict-transport-security",
}


def headers_safe(h: dict) -> dict:
    out = {}
    for k, v in h.items():
        kl = k.lower()
        if kl in HEADERS_ALLOW:
            out[k] = v
    return out
