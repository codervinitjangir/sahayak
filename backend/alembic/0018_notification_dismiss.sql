-- ADR-054: an owner or partner can clear notifications from their panel.
-- A soft dismiss, not a delete: the row stays as the record of what was sent
-- (disputes, support), and every read path filters dismissed rows out.
BEGIN;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
COMMIT;
