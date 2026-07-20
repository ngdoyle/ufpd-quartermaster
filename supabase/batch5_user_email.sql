-- Batch 5 (change round 7/20) — add optional contact email to user accounts.
-- Used by the admin "Reset Password" flow to email a temporary password.
-- Idempotent: safe to re-run. Already applied on dev.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
