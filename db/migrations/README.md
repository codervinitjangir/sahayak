# Migrations

`schema.sql` is the from-scratch build of the database. Everything in this
directory is a change applied to a database that already exists, in filename
order.

There is no migration framework here on purpose — the project has one
environment and a handful of changes, and Alembic's autogenerate would have to
be taught about PostGIS geography columns before it produced anything
trustworthy. What matters at this size is that every applied change is written
down somewhere other than someone's shell history, which is what this directory
is for.

## Rules

* **Filenames are `NNN_short_description.sql`, numbered in the order applied.**
  The number is the whole ordering mechanism; do not reuse one.
* **Every statement is idempotent** (`IF NOT EXISTS`, `IF EXISTS`). Re-running
  the directory top to bottom against an already-migrated database must be a
  no-op, because that is the only way to be sure which ones a given database has
  had without a migrations table.
* **`schema.sql` is updated in the same change.** A fresh database built from
  `schema.sql` alone must match a database built from `schema.sql` plus every
  migration. If the two drift, the migration is the truth and `schema.sql` is
  the bug.

## Applying

There is no `psql` on the development machine, so migrations are applied with:

```bash
python tools/apply_migration.py 007_admin_auth.sql
```

from `backend/`. Add `--dry-run` to see which database it would hit without
touching it. The script runs the whole file in **one transaction**, so a
migration that fails partway leaves nothing behind, and it prints the target
host and the password's length rather than the connection string.

Re-running an already-applied migration is the test of the idempotency rule
above, and is expected to succeed silently. Do it once for every new migration
before recording it below.

## Log

| File | Applied | What and why |
|------|---------|--------------|
| `001_auth_user_id.sql` | 2026-09-17 | Links `users` and `partners` rows to Supabase Auth accounts. Written down retroactively on 2026-09-18 — the columns were applied directly to the live database during the auth task and only ever existed in two code comments. |
| `002_dispatch_audit_columns.sql` | 2026-09-18 | Makes a dispatch decision auditable: the individual weighted score terms, and whether a naive nearest-partner search would have picked the same partner. |
| `003_assignment_cancelled_status.sql` | 2026-09-20 | Adds `'cancelled'` to the `job_assignments.status` CHECK. Job lifecycle transitions close out the accepted assignment when a job ends, and a cancelled job had no truthful word for it — `'rejected'` would have charged the partner's acceptance rate for the customer's decision. See ADR-012. |
| `004_drop_rating_trigger.sql` | 2026-09-29 | Drops `trg_update_partner_rating` and its function. It resolved the rated partner through `job_assignments.status = 'accepted'`, which completing a job has already left, so its UPDATE matched zero rows and reported success — `rating_count` was 0 for every partner forever and a fifth of the matching score was a silent constant. The aggregate is now recomputed from source by `rating_service`. See ADR-018. |
| `005_notifications_writable.sql` | 2026-10-01 | Makes the (empty, never-written) `notifications` table correct before the first insert: adds `event NOT NULL`, adds `'in_app'` to the `channel` CHECK, puts `NOT NULL` on the recipient pair, and adds two indexes — one composite for the feed, one partial for the unread badge. See ADR-019. |
| `006_notifications_job_fk_cascade.sql` | 2026-10-01 | Adds `ON DELETE CASCADE` to `notifications.job_id`, which 005 left as the original schema's bare `REFERENCES jobs(id)` — i.e. NO ACTION, i.e. a job with notifications attached could not be deleted at all. Found by nine of the thirteen integration harnesses breaking inside `purge()` the hour notifications started being written. A new child table is a change to its parent's delete path. |
| `007_admin_auth.sql` | 2026-10-01 | Gives `admins` an `auth_user_id`, so an admin can authenticate at all — until now the table was two seeded rows that nothing read and no account could reach. Prerequisite for the analytics endpoints, which must not be servable to a logged-in customer. Deliberately has **no link-auth endpoint**: the column is set by hand in SQL, because an admins row is a privilege grant and the self-service claim pattern users and partners use rests on "an unlinked profile is unclaimed", which is the wrong trade here. See ADR-020. |

Entries 004 to 006 were backfilled on 2026-10-01, having been applied without
being recorded. That is the failure mode this file exists to prevent; the dates
are the dates the work shipped per `TASKS.md`.

