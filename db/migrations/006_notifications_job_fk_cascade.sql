-- 006_notifications_job_fk_cascade.sql
--
-- `notifications.job_id` gets ON DELETE CASCADE.
--
-- One change, and it is a correction to 005 rather than a new idea: 005 made the
-- table writable and left the foreign key exactly as the original schema wrote
-- it, `job_id UUID REFERENCES jobs(id)` with no ON DELETE clause — which means
-- NO ACTION, which means **a job row with notifications attached cannot be
-- deleted at all**.
--
--
-- How this was found
-- ------------------
-- Not by reading the schema. By the entire integration suite breaking at once.
--
-- Nine of the thirteen check_*.py harnesses create jobs and delete them again in
-- purge(). The hour notifications started being written, every one of those
-- deletes began failing with
--
--     update or delete on table "jobs" violates foreign key constraint
--     "notifications_job_id_fkey" on table "notifications"
--
-- and the failures landed in the worst possible place: inside cleanup, which
-- runs before the first assertion and again in `finally`. A purge that raises
-- leaves its own rows behind, so each harness then failed at its *next* start,
-- never having run a single check. Fifteen jobs, forty-three notifications,
-- seven partners and six users were stranded across five namespaces before the
-- cause was clear.
--
-- Worth recording, because the shape generalises: adding a child table to a
-- parent that something deletes is a change to the parent's delete path, and the
-- place it surfaces is not the new feature's tests. check_notifications.py
-- passed 79/79 against this constraint — it deletes notifications before jobs,
-- because it was written knowing the FK had no cascade. Only the *other*
-- harnesses, which could not have known, broke.
--
--
-- Why CASCADE is the right answer and not just the convenient one
-- --------------------------------------------------------------
-- The schema already makes this distinction, consistently, among the five
-- children of `jobs`:
--
--   job_assignments     ON DELETE CASCADE   -- dispatch mechanics
--   job_status_history  ON DELETE CASCADE   -- the job's own audit trail
--   ratings             (no cascade)        -- evidence; feeds scoring (ADR-018)
--   payments            (no cascade)        -- money; must outlive the job
--   notifications       (no cascade)        -- ...which side is this on?
--
-- It is on the first side. A notification is a derived view of an event that
-- already has its own durable record in job_status_history; it stores no fact
-- that is not recoverable from the job and its history. Its only purpose is to
-- be rendered in a feed whose every row deep-links to `job_id`, so a
-- notification about a job that no longer exists is not an orphaned record, it
-- is an unrenderable one — a row the client fetches and can do nothing with.
--
-- Ratings and payments are the opposite: a rating is input to the matching
-- score, a payment is a financial record, and both must survive their job for
-- reasons that have nothing to do with the job's own lifecycle. Notifications
-- have no such claim.
--
-- The privacy argument points the same way, and is the one that settles it.
-- A notification message is the one place in this system where text about a job
-- sits outside that job's access gate — GET /jobs/{id} decides who may read a
-- job, and nothing re-gates a stored string in a feed. (This is why ADR-019
-- puts no names, phones or coordinates in a message in the first place.) If a
-- job row were ever removed — a retention policy, a deletion request — leaving
-- its notifications behind would leave feed entries referring to a job whose
-- access rules no longer exist to consult. CASCADE is the only version where
-- deleting a job means the job is actually gone.
--
--
-- What this does not change
-- -------------------------
-- Nothing in production deletes a job. Cancellation is a status, not a delete,
-- and no code path in the application issues DELETE FROM jobs. So this
-- constraint has no effect on any live request today; it governs test cleanup
-- and whatever retention job eventually exists. That is precisely why it is
-- cheap to fix now and would not be later.
--
-- It also does not relax the harnesses' own discipline:
-- check_notifications.py keeps deleting notifications explicitly before jobs.
-- A purge that states what it removes is better documentation than one relying
-- on a cascade, and it stays correct if this FK is ever reconsidered.
--
--
-- Re-runnable, as this directory requires: DROP IF EXISTS then ADD.

BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_job_id_fkey;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;

COMMIT;

-- Verification (not part of the transaction — run it after):
--
--   SELECT conname, confdeltype
--     FROM pg_constraint
--    WHERE conname = 'notifications_job_id_fkey';
--
-- confdeltype must read 'c' (cascade). 'a' is NO ACTION, i.e. this migration
-- did not take.
