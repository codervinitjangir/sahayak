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

```bash
psql "$DATABASE_URL" -f db/migrations/002_dispatch_audit_columns.sql
```

Or all of them, in order:

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## Log

| File | Applied | What and why |
|------|---------|--------------|
| `001_auth_user_id.sql` | 2026-09-17 | Links `users` and `partners` rows to Supabase Auth accounts. Written down retroactively on 2026-09-18 — the columns were applied directly to the live database during the auth task and only ever existed in two code comments. |
| `002_dispatch_audit_columns.sql` | 2026-09-18 | Makes a dispatch decision auditable: the individual weighted score terms, and whether a naive nearest-partner search would have picked the same partner. |
