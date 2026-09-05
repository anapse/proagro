# Capa de persistencia SQLite (tablas del proyecto, auditorías, evidencia...).
import sqlite3
import threading
import json

from . import DB_PATH, now_iso

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS audits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  mode TEXT,
  options_json TEXT,
  summary_json TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  url TEXT, method TEXT, status INTEGER, content_type TEXT,
  size INTEGER, ttfb_ms REAL, total_ms REAL, sha256 TEXT,
  kind TEXT, initiator TEXT, error TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS responses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  request_id INTEGER,
  url TEXT, http_status INTEGER,
  body_path TEXT, body_preview TEXT, record_count INTEGER,
  sha256 TEXT, structure_json TEXT, metrics_json TEXT
);
CREATE TABLE IF NOT EXISTS scripts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  url TEXT, name TEXT, kind TEXT, size INTEGER, sha256 TEXT,
  downloaded_at TEXT, path TEXT, status TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS endpoints(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  path TEXT, method TEXT,
  classification TEXT,          -- OBSERVADO | REFERENCIADO | POSIBLE
  endpoint_type TEXT,           -- mvc_action | api | hub | page | static
  source_file TEXT, source_line INTEGER, context TEXT,
  params_json TEXT, sources_json TEXT,
  status TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS findings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  fid TEXT,
  severity TEXT,               -- INFO | LOW | MEDIUM | HIGH | CRITICAL
  klass TEXT,                  -- HECHO OBSERVADO | INDICIO | HIPOTESIS | PRUEBA PENDIENTE
  finding_type TEXT,           -- RESPONSE_INCONSISTENCY | POSSIBLE_SILENT_FAILURE | ...
  title TEXT, description TEXT, evidence TEXT,
  file TEXT, endpoint TEXT,
  confidence TEXT, impact TEXT, recommendation TEXT,
  status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  category TEXT, filename TEXT, url TEXT,
  sha256 TEXT, size INTEGER, path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  dir TEXT, created_at TEXT, manifest_json TEXT
);
CREATE TABLE IF NOT EXISTS changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  prev_audit_id INTEGER,
  kind TEXT, description TEXT, detail_json TEXT
);
CREATE TABLE IF NOT EXISTS kg_flows(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  screen TEXT, func_name TEXT, request_desc TEXT, endpoint TEXT,
  response_desc TEXT, processing_desc TEXT, display_desc TEXT,
  notes TEXT, keyword TEXT, file TEXT
);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  kind TEXT, path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS kg_queries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  dni TEXT, fecha TEXT, created_at TEXT,
  endpoint TEXT, method TEXT,
  http_status INTEGER, elapsed_ms REAL,
  estado TEXT, nombre TEXT,
  kg_exportable REAL, kg_descarte REAL, kg_total REAL,
  raw_path TEXT, raw_sha256 TEXT,
  request_json TEXT, response_preview TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_audit ON requests(audit_id);
CREATE INDEX IF NOT EXISTS idx_resp_audit ON responses(audit_id);
CREATE INDEX IF NOT EXISTS idx_scr_audit ON scripts(audit_id);
CREATE INDEX IF NOT EXISTS idx_ep_audit ON endpoints(audit_id);
CREATE INDEX IF NOT EXISTS idx_find_audit ON findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_ev_audit ON evidence(audit_id);
CREATE INDEX IF NOT EXISTS idx_kg_audit ON kg_flows(audit_id);
CREATE INDEX IF NOT EXISTS idx_chg_audit ON changes(audit_id);
CREATE INDEX IF NOT EXISTS idx_kgq_dni ON kg_queries(dni);
CREATE INDEX IF NOT EXISTS idx_kgq_created ON kg_queries(created_at);
"""


def connect():
    conn = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with _lock:
        conn = connect()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()


def insert(table: str, values: dict) -> int:
    with _lock:
        conn = connect()
        try:
            cols = ",".join(values.keys())
            ph = ",".join("?" * len(values))
            cur = conn.execute(
                f"INSERT INTO {table}({cols}) VALUES({ph})", list(values.values())
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def update(table: str, rid: int, values: dict):
    with _lock:
        conn = connect()
        try:
            sets = ",".join(f"{k}=?" for k in values)
            conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", [*values.values(), rid])
            conn.commit()
        finally:
            conn.close()


def q(sql: str, params=()) -> list:
    conn = connect()
    try:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()  # permite usar q() también para DML (DELETE/UPDATE)
        return [dict(r) for r in rows]
    finally:
        conn.close()


def q1(sql: str, params=()) -> dict:
    rows = q(sql, params)
    return rows[0] if rows else None


def row_to_json(v):
    """Serializa filas con campos json en texto plano."""
    return v


def project_default():
    p = q1("SELECT * FROM projects WHERE name=?", ("PROAGRO",))
    if not p:
        from . import DEFAULT_URL
        insert("projects", {"name": "PROAGRO", "url": DEFAULT_URL, "created_at": now_iso()})
        p = q1("SELECT * FROM projects WHERE name=?", ("PROAGRO",))
    return p
