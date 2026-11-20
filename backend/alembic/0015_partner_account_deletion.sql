-- 0015: partner self-service account deletion (ADR-045, 2026-11-21).
--
-- Google Play requires an in-app way to delete any account the app lets a person
-- create. Owners have had one since ADR-025. Partners had none.
--
-- Like owners, a deleted partner row is anonymised, not removed: jobs,
-- assignments, ratings, payments, disputes and tow photos point at it, and the
-- owners on the other side keep their history. deleted_at marks the row.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN partners.deleted_at IS
  'ADR-045. Set when the partner deleted their account; the row is anonymised and can never sign in.';
