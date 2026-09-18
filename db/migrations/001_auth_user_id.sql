-- 001_auth_user_id.sql
--
-- Bind local profiles to Supabase Auth accounts.
--
-- Written down retroactively on 2026-09-18. These two columns were applied
-- directly to the live database while the auth module was being built, and
-- until now existed nowhere in the repository except two code comments
-- (app/models/user.py and app/models/partner.py) that both pointed at
-- "db/migrations/001" — a file that did not exist. This is that file.
--
-- Why a column rather than trusting the token alone: a verified Supabase JWT
-- establishes *an account*, not a role or a profile. resolve_identity looks the
-- token's `sub` up here to decide whether the caller is a vehicle owner or a
-- partner, and which local row is theirs.
--
-- Nullable, because a row can exist before its human holds an account:
--   * partners are registered by ops over the phone, often before the mechanic
--     has ever opened the app;
--   * users predate the registration endpoint entirely (see app/api/users.py).
-- Unique, because one Supabase account must never control two profiles, and
-- because that constraint is what makes the null check in link_*_auth a real
-- defence rather than a race.

ALTER TABLE users    ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- Named explicitly rather than left to ADD CONSTRAINT UNIQUE, so the index name
-- is stable across environments and IF NOT EXISTS is available.
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_key
    ON users (auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS partners_auth_user_id_key
    ON partners (auth_user_id);
