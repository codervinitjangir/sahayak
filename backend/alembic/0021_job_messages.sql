-- ADR-058: in-app chat between the owner and the accepted partner of a job.
CREATE TABLE IF NOT EXISTS job_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sender_type varchar(10) NOT NULL CHECK (sender_type IN ('user', 'partner')),
    sender_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_job_messages_job_created ON job_messages (job_id, created_at);
ALTER TABLE job_messages ENABLE ROW LEVEL SECURITY;
