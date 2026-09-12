-- ==============================================================================
-- Sahayak Seed Data
-- ==============================================================================

-- 1. Service Categories
INSERT INTO service_categories (code, name) VALUES
('towing', 'Towing'),
('mechanical', 'Mechanical'),
('fuel', 'Fuel')
ON CONFLICT (code) DO NOTHING;

-- 2. Services
INSERT INTO services (category_id, code, name, requires_vehicle_equipment) VALUES
((SELECT id FROM service_categories WHERE code='towing'), 'flatbed_towing', 'Flatbed Towing', TRUE),
((SELECT id FROM service_categories WHERE code='towing'), 'wheel_lift_towing', 'Wheel-Lift Towing', TRUE),
((SELECT id FROM service_categories WHERE code='mechanical'), 'battery_jumpstart', 'Battery Jumpstart', FALSE),
((SELECT id FROM service_categories WHERE code='mechanical'), 'flat_tyre', 'Flat Tyre Support', FALSE),
((SELECT id FROM service_categories WHERE code='mechanical'), 'minor_repair', 'On-Site Minor Repair', FALSE),
((SELECT id FROM service_categories WHERE code='fuel'), 'fuel_delivery', 'Emergency Fuel Delivery', FALSE)
ON CONFLICT (code) DO NOTHING;

-- 3. Default Admins
INSERT INTO admins (name, email, role) VALUES
('Sahayak Ops Admin', 'ops@sahayak.in', 'ops'),
('Super Admin', 'admin@sahayak.in', 'super_admin')
ON CONFLICT (email) DO NOTHING;
