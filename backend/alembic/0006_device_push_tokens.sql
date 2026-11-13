-- ADR-026: Expo push tokens per signed-in device. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS device_push_tokens (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type    varchar(10) NOT NULL,
    owner_id      uuid NOT NULL,
    token         text NOT NULL UNIQUE,
    platform      varchar(10),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT check_push_owner_type CHECK (owner_type IN ('user', 'partner'))
);
CREATE INDEX IF NOT EXISTS ix_device_push_tokens_owner ON device_push_tokens (owner_type, owner_id);
