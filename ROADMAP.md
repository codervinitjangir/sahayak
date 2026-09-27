# Sahayak — Actual Roadmap (12 weeks, corrected)

Real project duration: **3 months / 12 weeks**. The original planning documents referenced a
5-month/20-week window — that was wrong and is superseded by this file. This is now the
authoritative timeline; `CLAUDE.md` and `TASKS.md` should be read alongside this for
conventions and task detail, not for pacing.

**Current position: Week 3 of 12.**

## Structure

| Weeks | Phase |
|---|---|
| 1–2 | Idea validation, architecture, DB design, initial setup — **DONE** |
| 3–8 | Remaining build: backend completion + frontend catch-up + lightweight validation |
| 9–10 | Integration, full regression, polish, documentation finalization |
| 11–12 | Viva preparation only — no new features built in this window |

The weeks 11–12 buffer is **fixed, not flexible**. If weeks 3–10 run long, the fix is cutting
backlog scope (payments, EV flow, offer timeouts — all already flagged as deferrable), not
eating into viva prep time.

## Where things actually stand (Week 3)

**Ahead of pace:** dispatch/matching engine, auth, job lifecycle, concurrency races closed,
load-tested. This was originally scoped as month 2–4 work and is done.

**On pace, deadline this week:** validation interviews. Zero product constants should go into
the final evaluation writeup un-defended by at least one real conversation.

**Behind pace, now the critical path:**

- Partner-facing frontend (web + mobile) — doesn't exist yet
- `GET /partners/me/offers` — the one backend piece still blocking it

## Remaining backend work (all unblocked, no dependency on Adarsh)

1. `GET /partners/me/offers` — blocks Adarsh, do first
2. Re-run k6 load test at the corrected connection pool size — cheap, closes an unverified
   throughput number before it goes into any evaluation document
3. Ratings endpoints
4. Notification endpoints
5. Admin analytics endpoints (dispatch latency, acceptance rate, matching accuracy vs.
   baseline — must exclude `Dispatch unavailable:%` notes per the metric-hygiene fix already
   documented)

**Backlog, deliberately not scheduled:** payments stub, EV-specific flow, offer
timeout/expiry, transaction-mode connection pooling. None of these block a working demo.

## Validation (parallel, not sequential)

- **Target:** 5–8 real conversations with mechanics (phone/WhatsApp, not in-person), 5–8 with
  vehicle owners — condensed versions of the existing interview scripts
- **Deadline:** end of this week
- **Purpose:** at least one real data point behind the dispatch radius, the concurrency cap,
  and the scoring weights — currently defended only by engineering reasoning, not by anyone
  who actually does this work

## Frontend (Adarsh, tracked here since it's now critical path)

- No partner-facing screens exist yet on web or mobile
- Everything partner-side has only ever been tested via scripted tokens, never a real client
- Two decisions pending from him: the role-switch UX decision, and the offers-endpoint
  response shape (backend proceeding with a reasonable default; confirm it matches what he
  needs once he's building against it)

## What "done" looks like by Week 10

- All 15 backend features complete and regression-tested (current: 10/15)
- Web + mobile frontend covering the full owner and partner happy paths
- At least 5–8 real interviews on each side, documented
- Final evaluation document written, inheriting the metric-hygiene notes already captured in
  the load-test report
- One tagged, stable git commit representing the demo-ready state

Everything after that point is rehearsal, not construction.
