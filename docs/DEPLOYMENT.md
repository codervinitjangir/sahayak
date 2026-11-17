# Sahayak: deployment, rollback and backups

Written 2026-11-14. Covers E5 (environments, secrets, rollback) and E6 (backups, restore
drill) from `REMAINING-WORK.md`. The steps that need an account are marked **[you]**; none
of them has been carried out yet.

## 1. Environments

Two of everything, never shared: **staging** and **production**.

| Piece | Staging | Production |
|---|---|---|
| Supabase project (Postgres + Auth) | its own project | its own project |
| Redis | its own instance | its own instance |
| Backend (Render web service, `backend/Dockerfile`) | `main` auto-deploy | manual deploy of a tagged commit |
| Web (static build of `web/`) | preview origin | real origin |
| Mobile | EAS `preview` profile | EAS `production` profile |

The live harnesses (`backend/tests/integration/check_*.py`) create and delete rows. Run them
against staging only, never production.

## 2. Secrets

Secrets live in the host's environment settings, never in git and never in the image
(`backend/.dockerignore` keeps `.env` out of the build context).

Backend (see `backend/.env.example` for the full list):

| Variable | Production value |
|---|---|
| `DATABASE_URL` | the ap-south-1 pooler in session mode (the direct host does not resolve) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | the production project's |
| `REDIS_URL` | production Redis |
| `CORS_ALLOWED_ORIGINS` | the web origin(s), comma-separated. **Not `*`** |
| `SHARE_LINK_SECRET` | 32+ random bytes. Rotating it revokes every share link already sent |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | `true`; token only with Expo enhanced push security |
| `DISPATCH_WORKER_ENABLED`, `DISPATCH_WORKER_INTERVAL_S` | `true`, `15` (ADR-032). The worker runs in every API process; overlap is safe |

Web build: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
optional `VITE_ERROR_REPORT_URL`. `VITE_DEMO_MODE` and `VITE_PARTNER_API_MOCK` must be unset.

Mobile build: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_API_BASE_URL` (Render URL; the app adds `/api/v1`), `EXPO_PUBLIC_WEB_URL`, and the file variable `GOOGLE_SERVICES_JSON` (EAS environment `preview`). No Maps key: ADR-031.

Rotation **[you]**: the Google Maps key that was once committed (R2), and any Supabase secret
key that has been pasted into a chat or a log.

## 3. Release checklist

1. CI green on the commit (backend ruff + unit, web and mobile `tsc` + `vitest` + `check:rule-a`).
2. If the change touches auth, money, concurrency or dispatch: full live regression against
   **staging** (`docs/evidence/run_harnesses.sh`), all green.
3. Apply new files in `backend/alembic/` to staging with `backend/tools/apply_migration.py`,
   then smoke test (section 5).
4. Take a production backup (section 6).
5. Apply the same migrations to production, then deploy the backend, then the web build.
   Migrations here are additive, so the old backend keeps working against the new schema;
   keep it that way (add columns nullable, drop nothing in the same release that stops using it).
6. Smoke test production. Watch `GET /health` and the logs for 15 minutes.

## 4. Rollback

| What went wrong | Do this |
|---|---|
| Backend deploy is bad | Render: redeploy the previous successful deploy. The schema is additive, so no database step |
| Web build is bad | Re-publish the previous build artefact |
| A migration is bad | Do not improvise a down-migration on production. Roll the backend back first (old code runs on the new schema), then fix forward with a new migration tested on staging |
| Data was damaged | Restore the last backup into a **new** database (section 6), verify, then repoint `DATABASE_URL`. Jobs created after the backup are lost; say so to support |
| Mobile release is bad | A store build cannot be recalled. Keep the previous backend contract working for one release, and ship a fixed build |

## 5. Smoke test (staging)

Automated: `backend/tests/smoke/smoke_e2e.py` (see its docstring for the six environment
variables and the two test numbers it needs). It has not been seen passing end to end yet.
By hand, the same path:

Sign in with a staging test number as an owner, add a vehicle, request help; sign in as a
verified partner on duty with a location, accept, enter the start code, complete with a
final price, confirm the cash payment; rate from both sides. Then `/admin/jobs` shows the
job as completed and the alerts line shows no stuck jobs.

## 6. Backups and the restore drill

Supabase takes daily backups on paid plans only; the free plan has none, and a paused
project (it has happened once) is not a backup. Until the plan is upgraded **[you]**:

```bash
DATABASE_URL=postgresql://... ./scripts/backup_db.sh
```

Run it daily from a scheduled job and copy the dump off the machine. Redis holds only live
partner locations (rebuilt within a minute of partners coming on duty), so it is not backed up.

Restore drill, monthly, into a scratch database, never the live one:

```bash
RESTORE_DATABASE_URL=postgresql://scratch... ./scripts/restore_db.sh backups/sahayak_YYYYMMDD_HHMMSS.dump
```

The script refuses to run when the target equals `DATABASE_URL`, and prints row counts to
compare with production. The drill passes when the counts match and the backend's unit
suite plus one live harness pass against the restored database. **No drill has been run yet.**

## 7. Monitoring (E7)

In place: structured JSON logs with a request id on every line; `GET /health` (process and
database); `GET /api/v1/admin/alerts` (stuck jobs, no-match rate, partners on duty), shown
on the admin Jobs board.

Not in place **[you]**: an uptime monitor on `/health` and on the web origin, log shipping
with an alert on `level=ERROR`, crash reporting for mobile (Sentry needs an account and a
DSN), and a public status page. Nobody is paged by anything today.
