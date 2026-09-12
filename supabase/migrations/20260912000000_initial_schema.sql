-- ==============================================================================
-- Sahayak Initial Schema Migration (v2.1)
-- PostgreSQL 15+ with PostGIS
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ============================
-- 1. USERS
-- ============================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    phone           VARCHAR(15) UNIQUE NOT NULL,
    email           VARCHAR(150) UNIQUE,
    phone_verified  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 2. VEHICLES
-- ============================
CREATE TABLE IF NOT EXISTS vehicles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type    VARCHAR(20) CHECK (vehicle_type IN ('two_wheeler','four_wheeler')),
    make            VARCHAR(50),
    model           VARCHAR(50),
    vehicle_number  VARCHAR(20) NOT NULL,   -- car/bike registration number, e.g. 'KA-01-AB-1234'
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 3. SERVICE CATEGORIES
-- ============================
CREATE TABLE IF NOT EXISTS service_categories (
    id      SERIAL PRIMARY KEY,
    code    VARCHAR(30) UNIQUE NOT NULL,   -- 'towing', 'mechanical', 'fuel'
    name    VARCHAR(60) NOT NULL
);

-- ============================
-- 4. SERVICES
-- ============================
CREATE TABLE IF NOT EXISTS services (
    id                          SERIAL PRIMARY KEY,
    category_id                 INTEGER REFERENCES service_categories(id),
    code                        VARCHAR(40) UNIQUE NOT NULL,  -- 'flatbed_towing','battery_jumpstart'
    name                        VARCHAR(60) NOT NULL,
    requires_vehicle_equipment  BOOLEAN DEFAULT FALSE
);

-- ============================
-- 5. ADMINS
-- ============================
CREATE TABLE IF NOT EXISTS admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100),
    email       VARCHAR(150) UNIQUE,
    role        VARCHAR(20) DEFAULT 'ops' CHECK (role IN ('ops','super_admin')),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 6. PARTNERS
-- ============================
CREATE TABLE IF NOT EXISTS partners (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        VARCHAR(100) NOT NULL,
    phone                       VARCHAR(15) UNIQUE NOT NULL,
    primary_category_id         INTEGER REFERENCES service_categories(id),
    verification_status         VARCHAR(20) DEFAULT 'pending'
                                 CHECK (verification_status IN ('pending','verified','rejected','suspended')),
    is_independent_contractor   BOOLEAN DEFAULT TRUE,
    is_available                BOOLEAN DEFAULT FALSE,
    rating_avg                  NUMERIC(2,1) DEFAULT 0.0,
    rating_count                INTEGER DEFAULT 0,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_availability ON partners (is_available) WHERE is_available = TRUE;

-- ============================
-- 7. PARTNER SERVICES (junction)
-- ============================
CREATE TABLE IF NOT EXISTS partner_services (
    partner_id  UUID REFERENCES partners(id) ON DELETE CASCADE,
    service_id  INTEGER REFERENCES services(id),
    PRIMARY KEY (partner_id, service_id)
);

-- ============================
-- 8. PARTNER EQUIPMENT
-- ============================
CREATE TABLE IF NOT EXISTS partner_equipment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id          UUID REFERENCES partners(id) ON DELETE CASCADE,
    equipment_type      VARCHAR(40),
    registration_number VARCHAR(30),
    verification_status VARCHAR(20) DEFAULT 'pending'
                         CHECK (verification_status IN ('pending','verified','rejected')),
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 9. PARTNER DOCUMENTS
-- ============================
CREATE TABLE IF NOT EXISTS partner_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id          UUID REFERENCES partners(id) ON DELETE CASCADE,
    doc_type            VARCHAR(30),
    file_url            TEXT,
    status              VARCHAR(20) DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','expired')),
    verified_by         UUID REFERENCES admins(id),
    verified_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    expiry_date         DATE,
    uploaded_at         TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 10. JOBS
-- ============================
CREATE TABLE IF NOT EXISTS jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id),
    vehicle_id          UUID REFERENCES vehicles(id),
    vehicle_number      VARCHAR(20),
    service_id          INTEGER REFERENCES services(id) NOT NULL,
    status              VARCHAR(20) DEFAULT 'requested'
                         CHECK (status IN (
                             'requested','matching','assigned','partner_en_route',
                             'in_progress','completed','cancelled','no_match_found'
                         )),
    pickup_location     GEOGRAPHY(POINT, 4326) NOT NULL,
    pickup_address_text TEXT,
    drop_location       GEOGRAPHY(POINT, 4326),
    issue_description   TEXT,
    issue_photo_urls    TEXT[],
    price_estimate      NUMERIC(8,2),
    price_final         NUMERIC(8,2),
    requested_at        TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_pickup_location ON jobs USING GIST (pickup_location);

-- ============================
-- 11. JOB ASSIGNMENTS
-- ============================
CREATE TABLE IF NOT EXISTS job_assignments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID REFERENCES jobs(id) ON DELETE CASCADE,
    partner_id              UUID REFERENCES partners(id),
    status                  VARCHAR(20) DEFAULT 'offered'
                             CHECK (status IN ('offered','accepted','rejected','timed_out','completed')),
    offered_at              TIMESTAMPTZ DEFAULT now(),
    responded_at            TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    distance_at_offer_m     NUMERIC(10,2),
    estimated_arrival_min   INTEGER,
    matching_score          NUMERIC(5,4),
    assignment_rank         SMALLINT,
    rejection_reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_assignments_job ON job_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_assignments_partner ON job_assignments (partner_id);

-- ============================
-- 12. JOB STATUS HISTORY
-- ============================
CREATE TABLE IF NOT EXISTS job_status_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
    status      VARCHAR(20),
    changed_at  TIMESTAMPTZ DEFAULT now(),
    note        TEXT
);

-- ============================
-- 13. RATINGS
-- ============================
CREATE TABLE IF NOT EXISTS ratings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES jobs(id),
    rated_by    VARCHAR(10) CHECK (rated_by IN ('user','partner')),
    rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (job_id, rated_by)
);

-- Trigger to keep partners.rating_avg denormalized and correct
CREATE OR REPLACE FUNCTION update_partner_rating() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.rated_by = 'user' THEN
        UPDATE partners
        SET rating_count = rating_count + 1,
            rating_avg = ((rating_avg * rating_count) + NEW.rating) / (rating_count + 1)
        WHERE id = (SELECT partner_id FROM job_assignments 
                     WHERE job_id = NEW.job_id AND status = 'accepted' LIMIT 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_partner_rating ON ratings;
CREATE TRIGGER trg_update_partner_rating
AFTER INSERT ON ratings
FOR EACH ROW EXECUTE FUNCTION update_partner_rating();

-- ============================
-- 14. PAYMENTS
-- ============================
CREATE TABLE IF NOT EXISTS payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID REFERENCES jobs(id),
    amount          NUMERIC(8,2),
    status          VARCHAR(20) DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','failed','refunded')),
    payment_method  VARCHAR(20),
    gateway_ref_id  VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- 15. NOTIFICATIONS
-- ============================
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_type  VARCHAR(10) CHECK (recipient_type IN ('user','partner')),
    recipient_id    UUID,
    channel         VARCHAR(10) CHECK (channel IN ('push','sms')),
    message         TEXT,
    is_read         BOOLEAN DEFAULT FALSE,
    sent_at         TIMESTAMPTZ DEFAULT now(),
    job_id          UUID REFERENCES jobs(id)
);
