-- ADR-055: the owner can attach up to 3 photos of the problem to a request.
-- Reuses the ADR-042 job_photos table and private bucket with a third stage,
-- 'issue', uploaded by the owner instead of the partner. Exactly one uploader
-- column is set, matching the stage.
BEGIN;
ALTER TABLE job_photos ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
ALTER TABLE job_photos DROP CONSTRAINT IF EXISTS job_photos_stage_check;
ALTER TABLE job_photos ADD CONSTRAINT job_photos_stage_check CHECK (stage IN ('pickup', 'drop', 'issue'));
ALTER TABLE job_photos DROP CONSTRAINT IF EXISTS job_photos_uploader_check;
ALTER TABLE job_photos ADD CONSTRAINT job_photos_uploader_check CHECK (
  (stage = 'issue' AND user_id IS NOT NULL AND partner_id IS NULL)
  OR (stage <> 'issue' AND partner_id IS NOT NULL AND user_id IS NULL));
COMMIT;
