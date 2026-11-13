-- ADR-024: staff actions are recorded in an append-only audit log, and an
-- owner account can be suspended. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SET NULL, not CASCADE: removing a staff account must not erase what
    -- that person did.
    admin_id     uuid REFERENCES admins(id) ON DELETE SET NULL,
    action       varchar(40) NOT NULL,
    target_type  varchar(20) NOT NULL,
    target_id    uuid NOT NULL,
    reason       text,
    details      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT check_admin_audit_target_type
        CHECK (target_type IN ('job', 'user', 'partner'))
);

CREATE INDEX IF NOT EXISTS ix_admin_audit_target
    ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_admin_audit_created
    ON admin_audit_log (created_at DESC);

-- Append-only at the database, not just by convention: the application role
-- can insert and read, never rewrite history.
CREATE OR REPLACE FUNCTION admin_audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_admin_audit_log_append_only ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_append_only
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_is_append_only();

ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason text;
