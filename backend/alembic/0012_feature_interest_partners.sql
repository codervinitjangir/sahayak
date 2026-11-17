-- ADR-035 (amended 2026-11-18): partners can register interest too, and the
-- owner-side "business" card is withdrawn (B2B stays in docs/FUTURE-ROADMAP.md only).
-- A row belongs to exactly one profile: an owner (user_id) or a partner (partner_id).
-- Idempotent. One transaction so the constraint swap is all-or-nothing.

BEGIN;

ALTER TABLE feature_interest ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE feature_interest ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE feature_interest DROP CONSTRAINT IF EXISTS check_feature_interest_one_owner;
ALTER TABLE feature_interest ADD CONSTRAINT check_feature_interest_one_owner
    CHECK ((user_id IS NULL) <> (partner_id IS NULL));

-- Owner features and partner features are separate lists; a row's feature must
-- belong to its side. 'business' is gone (no rows ever held it on 2026-11-18).
DELETE FROM feature_interest WHERE feature = 'business';
ALTER TABLE feature_interest DROP CONSTRAINT IF EXISTS check_feature_interest_feature;
ALTER TABLE feature_interest ADD CONSTRAINT check_feature_interest_feature CHECK (
    (user_id IS NOT NULL AND feature IN ('scheduled', 'doorstep', 'pickup-drop'))
 OR (partner_id IS NOT NULL AND feature IN ('financing', 'certification', 'custody-tier'))
);

-- UNIQUE (user_id, feature) stays; NULLs never collide, so partner rows pass it.
ALTER TABLE feature_interest DROP CONSTRAINT IF EXISTS uq_feature_interest_partner_feature;
ALTER TABLE feature_interest ADD CONSTRAINT uq_feature_interest_partner_feature UNIQUE (partner_id, feature);

COMMIT;
