-- ============================================================
-- PROAGRO WEB — COMUNIDAD · Migración 0002 (seed inicial)
-- Supervisores iniciales de CONFIGURACIÓN (solo para probar la
-- estructura). Son datos de arranque claramente identificados;
-- el administrador puede agregar/editar/desactivar después
-- desde Administración → Supervisores.
-- Los votos/comentarios empiezan en 0 (no se siembran datos falsos).
-- ============================================================

INSERT OR IGNORE INTO supervisores (nombre, cargo, activo) VALUES
  ('Brigitte', 'Supervisora', 1),
  ('Rosaura',  'Supervisora', 1),
  ('César',    'Supervisor',  1);
