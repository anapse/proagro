-- ============================================================
-- PROAGRO WEB — ADMIN · Migración 0004 (seed inicial)
-- Único usuario administrativo de arranque: anapse (ADMIN, Nivel 1).
-- Solo contiene el HASH PBKDF2 de la contraseña (nunca texto plano).
-- La contraseña inicial se cambia en el primer ingreso
-- (must_change_password = 1, obligatorio en el login).
-- ============================================================

INSERT OR IGNORE INTO admin_users (username, password_hash, display_name, role_level, active, must_change_password)
VALUES (
  'anapse',
  'pbkdf2$sha256$100000$tc98Y70gB78/6x/IeZYQfw==$FYNLUU6phajJs5FkfId3bLDA1zfXI/sA9jNryu+DTXs=',
  'Administrador',
  1,
  1,
  1
);
