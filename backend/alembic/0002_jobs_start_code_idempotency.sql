-- Restores columns the ORM (app/models/job.py) expects but the initial_schema lacked.
-- Idempotent: safe to re-run.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_code varchar(4);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key varchar(64);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_jobs_user_idempotency_key') THEN
    ALTER TABLE jobs ADD CONSTRAINT uq_jobs_user_idempotency_key UNIQUE (user_id, idempotency_key);
  END IF;
END $$;
