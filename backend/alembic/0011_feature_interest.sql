-- ADR-035: owners can say "notify me" on a service that is announced but not
-- bookable yet. One row per (owner, feature); a second tap is a no-op.
-- Idempotent and additive: the previous backend ignores this table.

CREATE TABLE IF NOT EXISTS feature_interest (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature     varchar(40) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_feature_interest_user_feature UNIQUE (user_id, feature),
    CONSTRAINT check_feature_interest_feature
        CHECK (feature IN ('scheduled', 'doorstep', 'pickup-drop', 'business'))
);

-- Admin counts per feature.
CREATE INDEX IF NOT EXISTS ix_feature_interest_feature ON feature_interest (feature);
