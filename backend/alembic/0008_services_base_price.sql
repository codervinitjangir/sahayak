-- ADR-028: the base price of a service is a column staff can change, not a code constant.
-- Idempotent: safe to re-run. Additive: the previous backend ignores the new column.

ALTER TABLE services ADD COLUMN IF NOT EXISTS base_price numeric(10,2);

ALTER TABLE services DROP CONSTRAINT IF EXISTS check_services_base_price_positive;
ALTER TABLE services ADD CONSTRAINT check_services_base_price_positive
    CHECK (base_price IS NULL OR base_price > 0);

-- Backfill with the values the code constant held (job_service.SERVICE_BASE_PRICES),
-- only where nothing has been set, so a re-run never undoes a staff edit.
UPDATE services SET base_price = v.price
FROM (VALUES
    ('flatbed_towing',    1499.00),
    ('wheel_lift_towing', 1199.00),
    ('battery_jumpstart',  499.00),
    ('flat_tyre',          399.00),
    ('minor_repair',       599.00),
    ('fuel_delivery',      449.00)
) AS v(code, price)
WHERE services.code = v.code AND services.base_price IS NULL;

-- A price change is a staff action and goes in the audit log (ADR-024). A service
-- has an integer id, not a uuid, so target_id becomes nullable and the service
-- code is carried in details.
ALTER TABLE admin_audit_log ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS check_admin_audit_target_type;
ALTER TABLE admin_audit_log ADD CONSTRAINT check_admin_audit_target_type
    CHECK (target_type IN ('job', 'user', 'partner', 'dispute', 'service'));
