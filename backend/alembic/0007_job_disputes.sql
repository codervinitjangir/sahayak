-- ADR-027: an owner can report a problem on a finished job; staff resolve it.
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS job_disputes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES users(id),
    reason           varchar(30) NOT NULL,
    description      text,
    status           varchar(20) NOT NULL DEFAULT 'open',
    resolution_note  text,
    resolved_by      uuid REFERENCES admins(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,
    CONSTRAINT check_dispute_reason CHECK (reason IN
        ('overcharged','service_not_done','partner_behaviour','damage','other')),
    CONSTRAINT check_dispute_status CHECK (status IN ('open','resolved','rejected','refunded'))
);
-- At most one open dispute per job, enforced by the database so a double tap
-- cannot open two (the service maps the violation to 409 DISPUTE_ALREADY_OPEN).
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_disputes_one_open
    ON job_disputes (job_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_job_disputes_status_created
    ON job_disputes (status, created_at DESC);

-- Dispute resolutions are staff actions and go in the audit log (ADR-024).
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS check_admin_audit_target_type;
ALTER TABLE admin_audit_log ADD CONSTRAINT check_admin_audit_target_type
    CHECK (target_type IN ('job', 'user', 'partner', 'dispute'));
