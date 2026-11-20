-- Trust and safety pass (2026-11-21). Idempotent. One transaction.
--
-- ADR-039: a final price above the estimate needs the owner's approval first.
--   job_price_revisions holds what the partner asked for and the owner's answer.
-- ADR-042: towing jobs carry before/after photos in the private bucket.
--   job_photos.file_url is the object path, NULL until the upload is confirmed.
-- ADR-043: an owner can report being asked to pay outside the app, and can
--   report a cancelled job that had a partner on it (that is how leakage looks).

BEGIN;

CREATE TABLE IF NOT EXISTS job_price_revisions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    partner_id      uuid NOT NULL REFERENCES partners(id),
    proposed_amount numeric(10,2) NOT NULL CHECK (proposed_amount > 0),
    reason          text NOT NULL,
    status          varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz
);
-- At most one revision awaiting the owner per job.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_price_revisions_pending
    ON job_price_revisions (job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_job_price_revisions_job ON job_price_revisions (job_id, created_at);

CREATE TABLE IF NOT EXISTS job_photos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    partner_id   uuid NOT NULL REFERENCES partners(id),
    stage        varchar(10) NOT NULL CHECK (stage IN ('pickup', 'drop')),
    content_type varchar(40) NOT NULL,
    file_url     text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    uploaded_at  timestamptz
);
CREATE INDEX IF NOT EXISTS ix_job_photos_job ON job_photos (job_id, stage) WHERE file_url IS NOT NULL;

ALTER TABLE job_disputes DROP CONSTRAINT IF EXISTS check_dispute_reason;
ALTER TABLE job_disputes ADD CONSTRAINT check_dispute_reason CHECK (
    reason IN ('overcharged', 'service_not_done', 'partner_behaviour', 'damage',
               'off_app_payment', 'other')
);

-- The backend connects as the table owner; RLS stays on so the anon and
-- authenticated Supabase roles read nothing through the REST API.
ALTER TABLE job_price_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

COMMIT;
