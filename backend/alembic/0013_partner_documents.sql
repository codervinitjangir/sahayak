-- ADR-038: partner documents are uploaded to a private Storage bucket and
-- reviewed by staff. partner_documents existed from the first schema but was
-- never written; this gives it a vocabulary and what review needs.
-- file_url holds the object path inside the private bucket, never a URL a
-- browser can open; it stays NULL until the upload is confirmed.
-- Idempotent. One transaction.

BEGIN;

ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS content_type varchar(40);
-- What the partner typed with the document: the tow vehicle's registration
-- number for tow_vehicle_rc (copied to partner_equipment on approval).
ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS reference_number varchar(30);
-- Set when the partner is rejected (now + 90 days), cleared if they are
-- verified again. The retention sweep deletes the file and the row after it.
ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS retain_until timestamptz;

ALTER TABLE partner_documents DROP CONSTRAINT IF EXISTS check_document_type;
ALTER TABLE partner_documents ADD CONSTRAINT check_document_type CHECK (
    doc_type IN ('driving_licence', 'photo_id', 'tow_vehicle_rc', 'tow_equipment_photo')
);

-- One confirmed document per type per partner. Unconfirmed rows (an upload
-- started and never finished) are not counted and are swept after a day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_documents_type_confirmed
    ON partner_documents (partner_id, doc_type) WHERE file_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_partner_documents_retain_until
    ON partner_documents (retain_until) WHERE retain_until IS NOT NULL;

COMMIT;
