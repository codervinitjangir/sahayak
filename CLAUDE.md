# Sahayak — Project Context (auto-loaded by Claude Code)

This file is read automatically at the start of every Claude Code session in this 
repo. It exists so tasks don't need to re-explain architecture and conventions 
every time — read this fully before starting any task.

## What this project is
Real-time roadside assistance dispatch platform (OJT project, 5-month build). A 
vehicle owner requests help; the system matches them to the best available 
partner (mechanic/tow/fuel) by a weighted scoring algorithm, not just nearest.

## Tech stack
FastAPI (Python, async) · PostgreSQL + PostGIS (via Supabase) · Redis (live 
location, GEOADD/GEOSEARCH) · Supabase Auth (phone OTP, JWT) · Render (deploy)

## Layering — non-negotiable, every feature follows this
```
app/api/          → thin route handlers only. No business logic.
app/services/      → business rules, transaction boundaries, error mapping.
app/repositories/  → SQL only. Never raises HTTP errors. flush(), never commit() 
                     — the service controls the transaction.
```

## Core design principles (do not violate without flagging it explicitly)
1. **Derived data is never stored.** `active_job_count` is always computed live 
   from `job_assignments` joined against `jobs.status` — never cached as a column.
2. **Live/volatile data lives in Redis, never Postgres.** Partner `current_location` 
   is Redis-only.
3. **A job is a request; an assignment is one dispatch attempt.** Never collapse 
   these back into `jobs.partner_id`.
4. **Every job status change writes a `job_status_history` row.** No silent 
   transitions.
5. **Never trust identity from a request body.** `user_id`/`partner_id` come from 
   the verified JWT (`get_current_identity()` / `require_partner()`), never from 
   what the client claims.
6. **404, not 403, when it would leak existence.** E.g. "vehicle not found" 
   whether it doesn't exist or belongs to someone else — same message either way.
7. **Concurrency-sensitive mutations use `get_job_by_id_for_update()`** (row lock). 
   The polling `GET /jobs/{id}` must NEVER use the locking read.

## Error handling
All responses use the envelope pattern: `{"data": ..., "meta": {"request_id"}}` on 
success, `{"error": {"code", "message"}, "request_id"}` on failure. Error codes are 
a shared registry in `errors.py` — reuse existing codes across features rather 
than duplicating the same concept under a new string.

## Testing bar — scales with risk, does not default to maximum every time
- **Small, low-risk addition** (new simple CRUD endpoint following an established 
  pattern): unit tests for the new code + one targeted smoke-test run. Full 
  regression not required every time.
- **Anything touching auth, money, concurrency, or the dispatch engine:** full 
  regression (all unit tests + all `check_*.py` integration harnesses) is 
  required, no exceptions.
- **Show the test failing on the old code before showing it passing on the fix**, 
  whenever fixing a bug — this is the project's standing discipline, not optional.
- Clean up test data after every run; confirm DB returns to documented baseline.

## Documentation discipline
- **One ADR per decision that would need its own search term.** Don't bury a 
  major decision (e.g. concurrency strategy) inside an ADR titled for something 
  else. Don't create a new ADR for something that's clearly a consequence/amendment 
  of an existing one — extend that ADR instead.
- **`HANDOFF-frontend-contract.md`** is the single source of truth for anything 
  that changes what Adarsh's frontend needs to know (new endpoints, changed 
  response shapes, new error codes). Update it, but batch small updates — it 
  doesn't need a new section for every minor addition if 2-3 tasks' worth can go 
  in one pass.
- Flag deviations from a task's literal spec explicitly, with reasoning — don't 
  silently implement something different, and don't silently implement the literal 
  spec if it's actually wrong (e.g. contradicts the schema).
- Flag newly-discovered bugs outside a task's scope rather than silently fixing 
  or silently ignoring them.

## Effort/model guidance
Use high reasoning effort for: dispatch engine changes, auth, concurrency/locking, 
schema migrations, anything security-sensitive. Use medium for straightforward 
CRUD following an already-established pattern in this codebase.

## Where things stand
**Pacing comes from `ROADMAP.md` — 12 weeks, currently week 3.** Any 20-week or 5-month
timeline in `README.md` or `Final prd.md` is superseded and must not be used for pacing.
See `TASKS.md` for the current backlog and what's already done. See 
`docs/adr/ADR.md` for architectural decision history (one file, ADR-001 onward — 
not a directory of separate files). See `HANDOFF-frontend-contract.md` for the 
current frontend-facing API contract.
