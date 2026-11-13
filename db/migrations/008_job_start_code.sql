-- 008_job_start_code.sql
--
-- Adds the 4-digit start code an owner reads to the assigned mechanic.
-- Server-generated at job creation; never accepted from a client. The partner
-- submits it to POST /jobs/{id}/start, which is the only path from
-- partner_en_route to in_progress.
--
-- Nullable because rows created before this migration have no code. New rows
-- are always populated by app/services/job_service.py.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS start_code VARCHAR(4);

COMMENT ON COLUMN jobs.start_code IS
    'Server-generated 4-digit code the owner gives the assigned partner before work starts.';
