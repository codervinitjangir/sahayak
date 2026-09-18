-- 002_dispatch_audit_columns.sql
--
-- Make a dispatch decision explainable after the fact.
--
-- job_assignments already stored matching_score: one number, with no way to ask
-- why it was that number. That is enough to rank candidates and not enough to
-- defend the ranking. These two columns are what turn the matching engine from
-- a black box into something the evaluation report can actually argue about.

-- The individual weighted terms behind matching_score, e.g.
--   {"distance_score": 0.62, "load_score": 0.8, "skill_score": 1.0, "rating_score": 0.92}
--
-- Stored per offer, not recomputed later, because every input moves: the partner
-- drives away, finishes a job, gets rated. A score recomputed next week answers
-- a question nobody asked. This answers "why this partner, at that moment".
--
-- JSONB rather than four numeric columns: the component set is expected to
-- change (skill_score is a placeholder today), and adding a term should not be a
-- schema migration plus a backfill. The cost is that Postgres will not enforce
-- the shape — app/utils/scoring.py owns that, and writes every key on every row.
ALTER TABLE job_assignments
    ADD COLUMN IF NOT EXISTS score_components JSONB;

-- True when the naive "nearest available partner, nothing else considered"
-- search would have picked this candidate too.
--
-- This is the control arm. Divergence rate — how often the weighted engine
-- picks someone other than the nearest partner — is computed straight off this
-- column, and it is the only honest way to answer "does the matching algorithm
-- do anything a distance sort would not have done?". Recording it at offer time
-- is the only place it can be recorded: the candidate set it was true relative
-- to does not exist afterwards.
--
-- DEFAULT FALSE rather than NULL: every row written by dispatch sets this
-- explicitly, so a false here means "we checked, and no", not "we did not look".
ALTER TABLE job_assignments
    ADD COLUMN IF NOT EXISTS was_baseline_choice BOOLEAN DEFAULT FALSE;

-- Dispatch reads job_assignments two ways on every offer: "who has already been
-- offered this job" (so a rejecting partner is not asked twice), and "how many
-- jobs is this partner actively on" (the load term, counted once per candidate
-- inside the request that creates a job).
--
-- The first is already served by idx_assignments_job. The second is not:
-- idx_assignments_partner covers partner_id alone, and the count filters on
-- status as well, so every candidate costs a heap lookup per assignment row.
-- (idx_assignments_partner becomes a prefix of this index and is therefore
-- redundant — left in place rather than dropped, because dropping an index is
-- the kind of change that should be its own migration.)
CREATE INDEX IF NOT EXISTS job_assignments_partner_id_status_idx
    ON job_assignments (partner_id, status);
