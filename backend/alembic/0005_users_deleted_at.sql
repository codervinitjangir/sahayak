-- ADR-025: an owner can delete their account. The row is anonymised, not
-- removed, so jobs, payments and partner earnings keep their foreign keys.
-- Idempotent: safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
