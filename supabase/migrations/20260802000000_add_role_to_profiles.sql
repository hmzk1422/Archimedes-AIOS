-- ──────────────────────────────────────────────
-- RBAC: Add role column to profiles table
-- ──────────────────────────────────────────────

-- Add the role column with a default of 'admin' so existing users
-- keep full access after the migration (backward compatibility).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'developer', 'viewer'));

-- Backfill any NULLs (shouldn't exist due to NOT NULL, but just in case)
UPDATE profiles SET role = 'admin' WHERE role IS NULL;

-- Helpful comment for the Supabase dashboard
COMMENT ON COLUMN profiles.role IS
  'RBAC role: admin (full access), developer (build/configure), viewer (read-only)';