-- ============================================================
-- PROAGRO WEB — COMUNIDAD · Migración 0001
-- Crea las tablas de la Comunidad en D1 (env.DB → proagro-comunidad)
-- NO toca ninguna tabla existente de PROAGRO.
-- ============================================================

-- Supervisores (no hardcodeados en el frontend; administrables vía API)
CREATE TABLE IF NOT EXISTS supervisores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  cargo      TEXT NOT NULL DEFAULT 'Supervisor/a',
  activo     INTEGER NOT NULL DEFAULT 1,          -- 1 activo · 0 inactivo
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Votos de supervisores (un voto activo por supervisor+voter)
CREATE TABLE IF NOT EXISTS supervisor_votes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id INTEGER NOT NULL,
  voter_id      TEXT NOT NULL,                    -- id anónimo/estable del dispositivo
  vote_type     TEXT NOT NULL CHECK (vote_type IN ('like','dislike')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supervisor_id) REFERENCES supervisores(id) ON DELETE CASCADE,
  CONSTRAINT uq_supervisor_voter UNIQUE (supervisor_id, voter_id)
);

-- Comentarios (a un supervisor o a una publicación/noticia)
CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id INTEGER,                          -- si comenta un supervisor
  post_id       INTEGER,                          -- si comenta una noticia/aviso
  voter_id      TEXT NOT NULL,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'visible',  -- visible | hidden (moderado)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supervisor_id) REFERENCES supervisores(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CHECK ((supervisor_id IS NOT NULL) OR (post_id IS NOT NULL))
);

-- Publicaciones: noticias / avisos oficiales
CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL DEFAULT 'aviso',       -- noticia | aviso
  category   TEXT,                                -- ej. 'Horario','Comunicado','Cosecha'
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  image_key  TEXT,                                -- clave en R2 (si se subió imagen)
  image_url  TEXT,                                -- URL pública opcional
  author     TEXT NOT NULL DEFAULT 'Administración',
  status     TEXT NOT NULL DEFAULT 'activo',      -- activo | inactivo
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Encuestas
CREATE TABLE IF NOT EXISTS surveys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'activa',      -- activa | cerrada
  start_at   TEXT,
  end_at     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Opciones de cada encuesta
CREATE TABLE IF NOT EXISTS survey_options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id   INTEGER NOT NULL,
  option_text TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
);

-- Votos de encuestas (un voto por encuesta+voter)
CREATE TABLE IF NOT EXISTS survey_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id  INTEGER NOT NULL,
  option_id  INTEGER NOT NULL,
  voter_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES survey_options(id) ON DELETE CASCADE,
  CONSTRAINT uq_survey_voter UNIQUE (survey_id, voter_id)
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_supervisores_activo ON supervisores(activo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisores_nombre ON supervisores(nombre);
CREATE INDEX IF NOT EXISTS idx_sv_supervisor     ON supervisor_votes(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_sv_voter          ON supervisor_votes(voter_id);
CREATE INDEX IF NOT EXISTS idx_comments_sup      ON comments(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_comments_post     ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_status   ON comments(status);
CREATE INDEX IF NOT EXISTS idx_posts_status      ON posts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_surveys_status    ON surveys(status);
CREATE INDEX IF NOT EXISTS idx_so_survey         ON survey_options(survey_id);
CREATE INDEX IF NOT EXISTS idx_survvotes_survey  ON survey_votes(survey_id);
CREATE INDEX IF NOT EXISTS idx_survvotes_option  ON survey_votes(option_id);
CREATE INDEX IF NOT EXISTS idx_survvotes_voter   ON survey_votes(voter_id);
