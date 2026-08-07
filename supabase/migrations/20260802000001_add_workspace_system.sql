-- ──────────────────────────────────────────────
-- Workspace System: Link Admins and Team Members
-- ──────────────────────────────────────────────
--
-- Architecture:
--   Admin (Owner) → Creates workspace, pays for platform, gets invite code
--   Standard User  → Joins workspace via invite code, is developer or viewer
--
--   workspace_id = the admin's user.id (the workspace owner)
--   All team members share the same workspace_id so they see the same data

-- Add account_type: 'admin' (owner/payer) or 'standard' (team member)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'admin'
  CHECK (account_type IN ('admin', 'standard'));

-- Add workspace_id: links team members to the admin's workspace
-- For admins, workspace_id = their own user.id
-- For standard users, workspace_id = the admin's user.id they joined
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Add invite_code: only set for admin accounts, used by team members to join
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- Backfill: existing users become admins of their own workspace
UPDATE profiles
  SET account_type = 'admin',
      workspace_id = profiles.id
  WHERE workspace_id IS NULL;

-- Generate invite codes for existing admins
UPDATE profiles
  SET invite_code = upper(substring(md5(random()::text || profiles.id::text) from 1 for 8))
  WHERE account_type = 'admin' AND invite_code IS NULL;

-- Index for fast workspace lookups
CREATE INDEX IF NOT EXISTS idx_profiles_workspace_id ON profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_profiles_invite_code ON profiles(invite_code) WHERE invite_code IS NOT NULL;

COMMENT ON COLUMN profiles.account_type IS
  'admin = workspace owner (pays for platform), standard = team member (developer/viewer)';
COMMENT ON COLUMN profiles.workspace_id IS
  'UUID of the workspace owner. For admins this is their own id. Team members share the admin''s workspace_id.';
COMMENT ON COLUMN profiles.invite_code IS
  'Unique 8-char code for admins. Team members enter this to join the workspace.';