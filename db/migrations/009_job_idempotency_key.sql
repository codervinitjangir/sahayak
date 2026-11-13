-- 009_job_idempotency_key.sql
--
-- Adds the client-generated retry token from POST /jobs' Idempotency-Key
-- header. The unique index is what turns "check then insert" into a real
-- guarantee: two concurrent retries can both pass the SELECT, and the loser
-- then fails this index instead of creating a second dispatch.
--
-- Partial, because the header is optional and every pre-existing row is NULL.
-- A plain UNIQUE(user_id, idempotency_key) would also allow multiple NULLs in
-- Postgres, but the partial form states the intent and keeps the index small.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_user_idempotency_key
    ON jobs (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN jobs.idempotency_key IS
    'Client-generated Idempotency-Key from POST /jobs; unique per owner, null when absent.';
