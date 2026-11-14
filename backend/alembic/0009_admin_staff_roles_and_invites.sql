-- ADR-029: staff roles and a one-time invite, replacing "edit the database to add an admin".
-- Idempotent: safe to re-run. Additive: the previous backend ignores everything here.

-- Four roles instead of two. Existing rows ('ops', 'super_admin') stay valid.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
    CHECK (role IN ('ops', 'super_admin', 'support', 'finance'));

-- The number the invite was bound to (shown in the staff list), who invited
-- them, and a soft off-switch: a disabled admin resolves to 403, the row and
-- its audit history stay.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone        varchar(15);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS invited_by   uuid REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS disabled_at  timestamptz;

CREATE TABLE IF NOT EXISTS admin_invites (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SHA-256 of the token. The token itself is shown once and never stored.
    token_hash         char(64) NOT NULL UNIQUE,
    phone              varchar(15) NOT NULL,
    name               varchar(100) NOT NULL,
    role               varchar(20) NOT NULL,
    created_by         uuid REFERENCES admins(id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    accepted_at        timestamptz,
    accepted_admin_id  uuid REFERENCES admins(id) ON DELETE SET NULL,
    revoked_at         timestamptz,
    CONSTRAINT check_admin_invite_role CHECK (role IN ('ops', 'super_admin', 'support', 'finance'))
);
-- At most one open invite per number, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS ux_admin_invites_one_open_per_phone
    ON admin_invites (phone) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Staff changes are staff actions and go in the audit log (ADR-024).
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS check_admin_audit_target_type;
ALTER TABLE admin_audit_log ADD CONSTRAINT check_admin_audit_target_type
    CHECK (target_type IN ('job', 'user', 'partner', 'dispute', 'service', 'admin'));
