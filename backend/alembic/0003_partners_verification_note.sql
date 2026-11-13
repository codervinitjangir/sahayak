-- Admin's reason for rejecting/suspending a partner (PRD: "approve/reject reason").
-- Idempotent: safe to re-run.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS verification_note text;
