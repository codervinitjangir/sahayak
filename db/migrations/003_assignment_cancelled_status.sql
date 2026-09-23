-- 003_assignment_cancelled_status.sql
--
-- Let a job_assignments row say "this job was cancelled" instead of borrowing a
-- word that means something else.
--
-- Job lifecycle transitions (POST /api/v1/jobs/{job_id}/status) close out the
-- accepted assignment when a job reaches a terminal state. Completion already
-- had a word for it — 'completed' was in the constraint from the start and
-- nothing had ever written it. Cancellation did not.
--
-- The three candidates for a cancelled job's assignment were:
--
--   'accepted'  — leave it. Rejected: the assignment would claim the partner is
--                 still committed to a job that no longer exists. It happens not
--                 to inflate the load count today, because that count joins
--                 through to jobs.status and 'cancelled' is not an active job
--                 status (ADR-008) — but that is the *join* saving us, not the
--                 row being true. A row that is only harmless because of how it
--                 is currently read is a trap for whoever reads it next.
--
--   'rejected'  — reuse it. Rejected for a sharper reason: 'rejected' is the
--                 partner's answer to an offer, and acceptance rate is computed
--                 from it (ADR-004 is explicit that these attempt records exist
--                 to measure dispatch quality). A partner who accepted a job,
--                 possibly drove to it, and then had the customer cancel would
--                 take a hit to their acceptance rate for someone else's
--                 decision — silently, in a metric that may later drive ranking
--                 or pay. That is a fairness bug hiding in a schema shortcut.
--
--   'cancelled' — this. One migration, and the column stops lying.
--
-- See ADR-012.

-- DROP + ADD rather than an in-place edit: Postgres has no ALTER CONSTRAINT for
-- a CHECK expression. The pair is idempotent as a unit even though ADD alone is
-- not, which is what the directory's re-runnability rule actually requires.
--
-- Two names are dropped because two exist in the wild for this constraint:
-- Postgres auto-named the inline CHECK in schema.sql 'job_assignments_status_check',
-- while app/models/job.py declares the same rule as 'check_assignment_status'.
-- A database built by SQLAlchemy's metadata rather than by schema.sql carries
-- the second name, and a migration that only knew about the first would leave
-- the old constraint in place and silently keep rejecting 'cancelled'.
ALTER TABLE job_assignments
    DROP CONSTRAINT IF EXISTS job_assignments_status_check;

ALTER TABLE job_assignments
    DROP CONSTRAINT IF EXISTS check_assignment_status;

ALTER TABLE job_assignments
    ADD CONSTRAINT job_assignments_status_check
    CHECK (status IN ('offered','accepted','rejected','timed_out','completed','cancelled'));
