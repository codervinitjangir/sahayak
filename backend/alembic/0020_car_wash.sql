-- ADR-056: car wash, booking only.
-- booking_only services must carry scheduled_for; POST /jobs refuses them "now".
ALTER TABLE services ADD COLUMN IF NOT EXISTS booking_only boolean NOT NULL DEFAULT false;

INSERT INTO service_categories (code, name)
SELECT 'washing', 'Car wash'
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE code = 'washing');

INSERT INTO services (category_id, code, name, requires_vehicle_equipment, base_price, booking_only)
SELECT c.id, v.code, v.name, false, v.price, true
FROM service_categories c
CROSS JOIN (VALUES
    ('exterior_wash', 'Exterior wash', 299.00),
    ('interior_exterior_wash', 'Interior + exterior wash', 549.00),
    ('deep_clean', 'Deep clean', 999.00)
) AS v(code, name, price)
WHERE c.code = 'washing'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.code = v.code);
