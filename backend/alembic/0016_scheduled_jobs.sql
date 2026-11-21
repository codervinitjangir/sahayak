-- ADR-050: scheduled jobs. The owner books a slot; the job waits as 'scheduled'
-- and the dispatch worker releases it to normal matching shortly before the slot.
BEGIN;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS slot_end timestamptz;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN (
    'scheduled','requested','matching','assigned','partner_en_route',
    'in_progress','completed','cancelled','no_match_found'));

-- Both slot columns or neither, and a slot that ends after it starts.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_slot_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_slot_check CHECK (
    (scheduled_for IS NULL AND slot_end IS NULL)
    OR (scheduled_for IS NOT NULL AND slot_end IS NOT NULL AND slot_end > scheduled_for));

-- A 'scheduled' job always has a slot.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_scheduled_has_slot;
ALTER TABLE jobs ADD CONSTRAINT jobs_scheduled_has_slot CHECK (
    status <> 'scheduled' OR scheduled_for IS NOT NULL);

-- The worker's release read: "scheduled jobs whose slot starts soon".
CREATE INDEX IF NOT EXISTS ix_jobs_scheduled_due ON jobs (scheduled_for) WHERE status = 'scheduled';

COMMIT;
