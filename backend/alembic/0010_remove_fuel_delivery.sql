-- ADR-033: fuel delivery is withdrawn. Doorstep fuel delivery needs a PESO
-- licence and approved mobile dispensers in India and is not lawful to offer
-- "everywhere", so the service, its category and every row that depends on it
-- are removed. Decided by the team on 2026-11-17, including deleting past jobs.
--
-- Idempotent: every statement is a no-op once fuel_delivery is gone.
-- One transaction so a failure leaves nothing half-deleted.

BEGIN;

-- Partners who were responsible for a fuel job: their rating aggregate must be
-- recomputed once those jobs' ratings are gone (ADR-018 rule, restated in SQL).
CREATE TEMP TABLE _fuel_partners ON COMMIT DROP AS
SELECT DISTINCT ja.partner_id
FROM job_assignments ja
JOIN jobs j ON j.id = ja.job_id
JOIN services s ON s.id = j.service_id
WHERE s.code = 'fuel_delivery'
  AND ja.status IN ('accepted', 'completed', 'cancelled');

-- ratings and payments reference jobs with NO ACTION; the rest cascade
-- (job_assignments, job_status_history, notifications, job_disputes).
DELETE FROM ratings WHERE job_id IN (
    SELECT j.id FROM jobs j JOIN services s ON s.id = j.service_id WHERE s.code = 'fuel_delivery');
DELETE FROM payments WHERE job_id IN (
    SELECT j.id FROM jobs j JOIN services s ON s.id = j.service_id WHERE s.code = 'fuel_delivery');
DELETE FROM jobs WHERE service_id IN (SELECT id FROM services WHERE code = 'fuel_delivery');

DELETE FROM partner_services WHERE service_id IN (SELECT id FROM services WHERE code = 'fuel_delivery');
DELETE FROM services WHERE code = 'fuel_delivery';
DELETE FROM service_categories c
WHERE c.code = 'fuel' AND NOT EXISTS (SELECT 1 FROM services s WHERE s.category_id = c.id);

UPDATE partners p SET
    rating_count = sub.cnt,
    rating_avg = COALESCE(ROUND(sub.avg, 1), 0.0)
FROM (
    SELECT fp.partner_id,
           COUNT(r.id) AS cnt,
           AVG(r.rating)::numeric AS avg
    FROM _fuel_partners fp
    LEFT JOIN job_assignments ja
           ON ja.partner_id = fp.partner_id
          AND ja.status IN ('accepted', 'completed', 'cancelled')
    LEFT JOIN ratings r ON r.job_id = ja.job_id AND r.rated_by = 'user'
    GROUP BY fp.partner_id
) sub
WHERE p.id = sub.partner_id;

COMMIT;
