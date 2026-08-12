-- ──────────────────────────────────────────────
-- AI Mode System: per-tenant active mode + per-mode
-- agent tasks + custom instructions.
--
-- Terminology:
--   "mode"        → The active AI mode for the tenant (stored on profiles.mode)
--   "datatype"    → The knowledge-base / task / instruction slice within a mode
--
-- This migration adds:
--   1. profiles.mode JSONB  — active mode config for the tenant
--   2. customer-service-provider datatype 'agent_tasks'  — tasks per mode
--   3. customer-service-provider datatype 'custom_instructions' — instructions per mode
-- ──────────────────────────────────────────────

-- 1. Active mode on the workspace owner's profile row
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mode JSONB;

COMMENT ON COLUMN profiles.mode IS
  'JSONB { active: "customer_support" | "sales" | "billing", label, description } — only set on the workspace owner row.';

-- 2. The customer-service-provider table already exists (it is the main config table).
--    We do NOT add new columns — we reuse the existing (tenant_id, filename, datatype, data)
--    composite key and just introduce two NEW datatype values:
--
--      datatype = 'agent_tasks'     → filename = <mode>     → data.tasks = [...]
--      datatype = 'custom_instructions' → filename = <mode> → data.instruction = "..."
--
--    This mirrors the existing knowledge-base pattern where
--      datatype = 'policies' / 'research' / ..., filename = <file.pdf>, data = md_text
--
-- No schema change needed for the table itself.

