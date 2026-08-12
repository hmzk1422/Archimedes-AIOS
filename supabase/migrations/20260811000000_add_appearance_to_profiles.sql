-- ──────────────────────────────────────────────
-- Tenant Appearance: per-workspace theme + canvas settings
-- ──────────────────────────────────────────────
--
-- Stored on the workspace OWNER's profile row (the row where
-- workspace_id = id). Every member reads the owner's appearance, so the
-- whole team sees one shared branded UI. Only admins may update it.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS appearance JSONB;

COMMENT ON COLUMN profiles.appearance IS
  'JSONB { theme: {brandName, logoSrc, mark, primary, primaryForeground, accent, accentForeground, radius, mode, paletteKey}, canvas: {columns, rowHeight, aiManaged} } — only set on the workspace owner row.';