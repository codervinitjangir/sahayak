-- 005_notifications_writable.sql
--
-- Make `notifications` a table the application can actually write and read
-- correctly. Four changes, all of them free today and none of them free later.
--
-- Run before deploying the notification endpoints. `notifications` holds **0
-- rows** at the time of writing and no code has ever inserted into it, which is
-- what makes every tightening below a no-op against existing data. That will not
-- be true again after the first job status change on the new code.
--
--
-- 1. `channel` gains 'in_app'
-- ---------------------------
-- The CHECK permitted only ('push','sms'). Neither exists: there is no FCM
-- credential, no SMS provider, and nothing in the codebase sends anything. The
-- endpoints being added are an in-app feed the client polls.
--
-- Writing channel='push' for a row nothing pushes is the same class of defect as
-- ADR-018's rating trigger — a column whose value asserts a behaviour that does
-- not happen, with nothing anywhere to contradict it. 'in_app' is the truthful
-- value for what is being built, so it is being added rather than approximated.
--
-- 'push' and 'sms' are deliberately kept. They are the states a real delivery
-- worker will need, and ADR-008's addendum already records the cost of adding a
-- CHECK value to a table with live rows. Adding all three now while the table is
-- empty is the cheap direction.
--
--
-- 2. NOT NULL on recipient_type, recipient_id, channel
-- ---------------------------------------------------
-- All three were nullable, and both CHECK constraints pass on NULL, because SQL
-- CHECK evaluates NULL to unknown and admits it. So the table as shipped would
-- accept a notification addressed to nobody: recipient_type NULL, recipient_id
-- NULL. Such a row is invisible to every query the feed endpoints can issue —
-- they all filter on the recipient pair — so it would be written, stored,
-- counted in table size, and never delivered or surfaced as an error.
--
-- The SQLAlchemy model already declared recipient_type and channel as
-- nullable=False, so the application was stricter than the database it trusted.
-- This makes the database agree rather than making the model lie.
--
-- recipient_id is tightened too, which the model did *not* declare. A
-- notification with a type but no id is addressed to "some user" and is equally
-- undeliverable. job_id stays nullable on purpose: not every notification a
-- later feature sends will be about a job.
--
--
-- 3. An index on the only query the feed makes
-- -------------------------------------------
-- There was exactly one index on this table: the primary key. Every read the
-- endpoints perform is
--
--     WHERE recipient_type = $1 AND recipient_id = $2 ORDER BY sent_at DESC
--
-- which against a PK-only table is a sequential scan plus a sort, on the one
-- table in the schema that grows with every status change of every job — faster
-- than `jobs` and faster than `job_assignments`. The composite index below
-- serves the filter and the ordering together, so the sort disappears too.
--
--
-- 4. A partial index for the unread badge
-- --------------------------------------
-- GET /notifications/unread-count runs on every client poll and is the most
-- frequent read in the feature by a wide margin. `WHERE is_read = false` is a
-- shrinking minority of the table over any account's lifetime, which is the
-- textbook case for a partial index: it indexes only the rows the query wants
-- and stops growing once the user reads their mail.
--
-- is_read is nullable with DEFAULT FALSE, so `= false` would miss a NULL. The
-- predicate is written `IS NOT TRUE` to match, and the service always writes an
-- explicit boolean so no NULL is created by this code — the tolerance is for
-- rows any other writer might leave.
--
--
-- 5. A new `event` column, because `message` alone is not a contract
-- -----------------------------------------------------------------
-- As shipped, the only thing distinguishing one notification from another was
-- `message`, a free-text string. A client cannot branch on prose: picking an
-- icon, choosing a deep-link target or grouping a feed all need a stable key,
-- and matching on English would break the first time the wording is improved.
--
-- This is the same split the API's error envelope already makes and for the same
-- reason — `code` is the contract clients branch on, `message` is for humans and
-- may be reworded at any time (app/schemas/common.py:ErrorDetail). A
-- notifications table with only the human half repeats a mistake this codebase
-- has already decided against everywhere else.
--
-- No CHECK constraint on the values, deliberately, and this is the one place
-- this migration chooses looseness. The vocabulary grows with every feature that
-- notifies, so a CHECK would mean a migration per new notification kind — and
-- the predictable result of that friction is someone reusing an almost-right
-- existing value to avoid it, which corrupts the column's meaning far worse than
-- an unconstrained string does. The vocabulary lives in
-- app/services/notification_service.py as one module-level table, is the only
-- thing that writes this column, and is asserted by unit test.
--
--
-- Re-runnable, as this directory requires. Every statement is IF EXISTS /
-- IF NOT EXISTS or a DROP-then-ADD pair.

BEGIN;

-- 1 --------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_channel_check
    CHECK (channel IN ('in_app', 'push', 'sms'));

-- 2 --------------------------------------------------------------------------
-- Guard rather than assume: if this migration is ever run against a database
-- that did acquire an unaddressed row, fail loudly here instead of having the
-- ALTER fail with a message that does not say why the row is wrong.
DO $$
DECLARE orphaned integer;
BEGIN
    SELECT count(*) INTO orphaned FROM notifications
     WHERE recipient_type IS NULL OR recipient_id IS NULL OR channel IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'migration 005: % notification row(s) are unaddressed '
            '(recipient_type, recipient_id or channel is NULL). These were '
            'never deliverable. Decide whether to delete or repair them before '
            'applying NOT NULL.', orphaned;
    END IF;
END $$;

ALTER TABLE notifications ALTER COLUMN recipient_type SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN recipient_id   SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN channel        SET NOT NULL;

-- 3 --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_sent
    ON notifications (recipient_type, recipient_id, sent_at DESC);

-- 4 --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
    ON notifications (recipient_type, recipient_id)
    WHERE is_read IS NOT TRUE;

-- 5 --------------------------------------------------------------------------
-- Added without a default and immediately made NOT NULL, which is only safe
-- because the table is empty. Against rows, this pair would have to become
-- ADD COLUMN -> backfill -> SET NOT NULL, and there would be no honest value to
-- backfill with, since the event kind of an existing row cannot be recovered
-- from its prose.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event VARCHAR(40);

DO $$
DECLARE untyped integer;
BEGIN
    SELECT count(*) INTO untyped FROM notifications WHERE event IS NULL;
    IF untyped > 0 THEN
        RAISE EXCEPTION
            'migration 005: % notification row(s) predate the event column and '
            'cannot be backfilled — the event kind is not recoverable from the '
            'message text. Delete them or assign an event explicitly.', untyped;
    END IF;
END $$;

ALTER TABLE notifications ALTER COLUMN event SET NOT NULL;

COMMIT;
