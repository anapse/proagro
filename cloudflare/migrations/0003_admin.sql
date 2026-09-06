-- ============================================================
-- PROAGRO WEB — ADMIN · Migración 0003
-- Tablas del panel administrativo privado (/admin).
-- NO borra ni altera las tablas de Comunidad (0001/0002).
-- Usa la misma D1: proagro-comunidad (binding env.DB).
-- ============================================================

-- Usuarios administrativos (fuente de verdad: D1, nunca el frontend)
CREATE TABLE IF NOT EXISTS admin_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- PBKDF2: pbkdf2$sha256$iter$salt$hash
  display_name TEXT NOT NULL DEFAULT '',
  role_level  INTEGER NOT NULL DEFAULT 4,   -- 1 ADMIN · 2 MODERADOR · 3 EDITOR · 4 CONSULTA
  active      INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,  -- 1 = obligar cambio en el 1er ingreso
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- Sesiones emitidas por el Worker (validadas en cada petición)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT NOT NULL,                -- SHA-256 del token (nunca el token crudo)
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user  ON admin_sessions(user_id);

-- Conteo diario de visitas a la página pública (estadísticas reales)
CREATE TABLE IF NOT EXISTS visit_stats (
  day  TEXT NOT NULL,                      -- YYYY-MM-DD (UTC)
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
);
