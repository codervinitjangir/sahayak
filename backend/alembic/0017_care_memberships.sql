-- ADR-051: Sahayak Care memberships, without payments. A plan is a number of
-- covered call-outs over a term; staff grant a membership to an owner (audited);
-- a job created while the owner has a call-out left is linked to the membership.
-- "Call-outs used" is never stored: it is counted from the linked jobs
-- (CLAUDE.md principle 1). No price lives here until payments go live (G3).
BEGIN;

CREATE TABLE IF NOT EXISTS care_plans (
    id              serial PRIMARY KEY,
    code            varchar(40) NOT NULL UNIQUE,
    name            varchar(80) NOT NULL,
    callouts        integer NOT NULL CHECK (callouts > 0),
    term_days       integer NOT NULL CHECK (term_days > 0),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_memberships (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id          integer NOT NULL REFERENCES care_plans(id),
    -- Copied from the plan when granted, so editing a plan never changes what
    -- an existing member was promised.
    callouts_allowed integer NOT NULL CHECK (callouts_allowed > 0),
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    granted_by       uuid REFERENCES admins(id) ON DELETE SET NULL,
    grant_reason     text NOT NULL,
    revoked_at       timestamptz,
    revoked_by       uuid REFERENCES admins(id) ON DELETE SET NULL,
    revoke_reason    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT care_memberships_term_check CHECK (ends_at > starts_at),
    CONSTRAINT care_memberships_revoke_check CHECK (
        (revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_care_memberships_user ON care_memberships (user_id, ends_at DESC);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS care_membership_id uuid
    REFERENCES care_memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_jobs_care_membership ON jobs (care_membership_id)
    WHERE care_membership_id IS NOT NULL;

-- RLS on, no policies: only the backend's service connection reads these
-- (same posture as every other table, ADR-020).
ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_memberships ENABLE ROW LEVEL SECURITY;

-- The one plan on offer. Four call-outs a year sits with the card and OEM
-- programmes researched for ADR-051; the number is staff-editable data.
INSERT INTO care_plans (code, name, callouts, term_days)
VALUES ('care', 'Sahayak Care', 4, 365)
ON CONFLICT (code) DO NOTHING;

COMMIT;
