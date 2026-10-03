# Sahayak — Task Backlog

**Pacing: see [`ROADMAP.md`](ROADMAP.md) — 12 weeks, currently week 3, build window closes
end of week 8.** This file is priority order and task detail only; it is not a schedule.

Ordered by priority. Claude Code should pick up the next unchecked task, confirm 
scope against CLAUDE.md's conventions, implement, and check it off with a one-line 
completion note (date + what shipped) — not a full report unless the task itself 
is high-risk per CLAUDE.md's testing-bar section.

## In Progress
_Nothing in progress. Pick the top item from Next Up._

## Next Up
_Nothing queued. The build backlog is empty — see `ROADMAP.md`; the frontend is the
critical path, and the mechanic/owner interviews are overdue from week 3._

## Backlog (not yet scheduled)
- [ ] Payments — test-mode stub only, low priority
- [ ] EV-specific breakdown flow — good-to-have, low priority
- [ ] Unanswered-offer timeout (currently offers don't expire) — flagged, no task 
      yet
- [ ] Supavisor transaction-mode pooling migration — deferred, multi-worker 
      scaling only, not needed for single-worker MVP

## Done (most recent first)
- [x] Admin analytics endpoints — 2026-10-03: `GET /api/v1/admin/analytics/{overview,
      dispatch,matching}`, admin-only, read-only, both window bounds optional and
      half-open. Shipped in two stages: admin identity first (migration 007, a third
      role resolved from our own `admins` table, no link-auth endpoint on purpose —
      ADR-020), then the three reports (ADR-021). Both TASKS.md exclusions are
      implemented and tested: `Dispatch unavailable:%` jobs leave **both** sides of the
      no-match rate with `rate_including_outages` published beside it, and the
      rating-dimension cutoff is handled by reporting `rating_score` in
      `constant_components` — excluded from `driver` — for any window in which no
      partner was rated, which is the honest form of "don't mix across 2026-09-29".
      Sanity-checked against the §4.2 figure: the harness arranges a divergence by
      hand (nearer partner loaded, further partner free) and asserts
      `was_baseline_choice = false` with `driver == "load_score"`.
      Every number that cannot be defended is absent rather than substituted:
      `eta_accuracy` is null because nothing has ever written an arrival estimate, and
      a nine-code `notes[]` vocabulary ships the caveats inside the response.
      **Two shipping-blocker SQL bugs found and fixed while writing the live harness**
      — all three endpoints were returning 500 on every call while the 47 unit tests
      were green, because the unit fixture monkeypatches the whole repository module:
      (1) nine of twelve queries failed with asyncpg `AmbiguousParameterError` on a
      bare `:param IS NULL`, since asyncpg PREPAREs before binding and needs an
      explicit `CAST`; (2) `partner_supply` filtered on `p.is_verified`, a column that
      has never existed — verification is the `verification_status` enum. A third,
      latent, fixed in passing: `sum(rating_count)` is NULL on an empty table against
      an `int` field. See ADR-021's implementation note. 47 unit tests + 99/99 live
      (`check_admin_analytics.py`), control run 94/99 with all five failures in the two
      sections that depend on the reverted line. Full regression: 371 unit/api, 745
      live across fourteen harnesses, DB back to baseline. HANDOFF §14.
- [x] `docs/FRONTEND-GUIDE.md` — 2026-10-01: a UX/screen-level guide for Adarsh,
      distinct from `HANDOFF-frontend-contract.md` (which stays the API contract log);
      885 lines, six sections plus a plain-language job-vs-assignment primer, every
      method+path re-grepped against its decorator in a final pass. Written from the
      code rather than from the contract doc, which is what made it worth doing — it
      corrected five things the prior reports had wrong. (1) **The frontends call 18
      paths that do not exist**, not the ~13 on record: web adds `GET /jobs`
      (`jobs.service.ts:33`), and mobile has six calls of which **four** are wrong, not
      one — `GET /jobs/me`, `PATCH /jobs/{id}/cancel` (right path, wrong method), and
      `PATCH /jobs/{id}/accept` / `/complete`, which are routes that were never built.
      The last two assume a mechanic acts on a *job*; the model is that a mechanic acts
      on an *assignment*, so threading the assignment id through the mobile partner
      screens is real work, not a path patch. (2) **`no_match_found` has three causes,
      not two, and the frontend can already distinguish all three** — `timeline[].note`
      is returned verbatim, so `DISPATCH_UNAVAILABLE_NOTE` is client-visible today and
      "nobody is available near you" need not be shown when the truth is that our Redis
      was unreachable; the cost is prefix-matching prose, so a machine-readable `reason`
      on the timeline entry is the right follow-up if it becomes load-bearing.
      (3) **`MAX_LOCATION_AGE_S = 300` does not filter** — it logs with
      `enforced=False`, so a mechanic whose phone died an hour ago is still scored and
      still offered jobs at their frozen position. That is a client obligation (keep
      posting while the toggle is on; flip `is_available` false on sign-out), and the
      guide says so rather than implying the backend protects against it. (4) Every
      partner screen is finished UI over `partner.mock`, so the partner surface is eight
      URL changes from working, not a build — and its header comment still says the
      `/partners/me/*` endpoints "are not built yet", which has been false since
      2026-09-27. (5) Confirmed from `PartnerOfferItem` rather than assumed: no score,
      rank-only, and no owner contact detail in an offer payload (ADR-017 holds). Build
      order is frontend-specific and leads with repointing the partner service layer,
      because the mechanic half of the demo loop is currently a mock talking to itself.
- [x] Notification endpoints (job status change alerts) — 2026-10-01: four read
      routes (`GET /api/v1/notifications`, `GET .../unread-count`,
      `POST .../{id}/read`, `POST .../read-all`), both roles on the shared identity
      dependency, no create route — the writer lives in
      `app/services/notification_service.py` and is called from inside the four
      transactions that change a job's status (offer, accept, lifecycle,
      cancellation), in the same place and the same transaction as the
      `job_status_history` row. Three decisions worth the search terms (ADR-019): the
      notification is written **in** the causing transaction with no savepoint,
      because with no outbox or worker a post-commit failure is permanent and
      silent; the recipient is **the party that did not act**, which is right in all
      six events where "the owner cares about their job" is right in five; and
      message text carries **no name, phone, coordinate or user-typed string**,
      because a stored string sits outside ADR-017's read-time contact gate forever.
      Migration 005 made the empty table writable (added `event NOT NULL`, `'in_app'`
      to the `channel` CHECK, `NOT NULL` on the recipient pair, two indexes — one
      composite for the feed, one partial for the badge). Migration 006 then added
      `ON DELETE CASCADE` to `notifications.job_id`, which is the task's real
      finding: the FK had no `ON DELETE` clause, so the hour notifications started
      being written, `purge()` broke in **nine of the thirteen** integration
      harnesses — inside cleanup, before any assertion — and each then failed at its
      next start having run no checks. The new harness passed throughout, because it
      was written knowing the FK had no cascade. Adding a child table is a change to
      the parent's delete path, and it surfaces in the other features' tests. Also
      fixed a second `MissingGreenlet` of ADR-018's class, in
      `dispatch_service._transition`, which logged an ORM attribute after
      `rollback()` and would have served a mapped 409 as a 500. 52 new unit tests
      (40 rule + 12 wiring), 79/79 live in `check_notifications.py` with an
      actor-blind control at 71/79 failing only the owner's-cancellation branch;
      full regression 307 unit + 646 live across thirteen harnesses, DB at baseline.
      Contract in `HANDOFF-frontend-contract.md` §13.
- [x] Ratings endpoints — two-way, plus the stored partner aggregate that nothing 
      could write — 2026-09-29: `POST` and `GET /api/v1/jobs/{job_id}/ratings`, one 
      row per side per job, `rated_by` taken from the token and refused in the body 
      (`extra="forbid"`). The task's real finding was in the dispatch engine, not the 
      feature: the Postgres trigger meant to maintain `partners.rating_avg` / 
      `rating_count` resolved the rated partner through 
      `job_assignments.status = 'accepted'`, which **completing a job has already 
      left** — so its UPDATE matched zero rows and reported success, `rating_count` 
      was 0 for every partner forever, and every candidate took ADR-009's 
      `UNRATED_PARTNER_RATING_SCORE = 0.7` branch. A fifth of the matching score was 
      a constant and nothing said so. Trigger dropped (`db/migrations/004`); the 
      aggregate is now maintained by `rating_service` and **recomputed from source** 
      rather than incremented, which is what makes it self-heal after a rating is 
      deleted or an assignment repaired (measured: delete one rating in SQL, next 
      write lands on `('4.0', 2)`). `partners` row locked `FOR UPDATE` before the 
      insert so two owners rating the same mechanic on different jobs cannot lose one 
      of the two — they share no job row, so nothing else serialises them. **Two 
      flagged principle deviations, both argued in ADR-018:** `rating_avg` is stored 
      derived data (principle 1) because `get_eligible_partners` reads it per 
      candidate per job creation, inside the path that already holds a connection for 
      1198 ms; and the jobs row is read *without* `FOR UPDATE` (principle 7) because 
      `'completed'` is terminal, pinned by a test that makes the locking read raise. 
      **Bug found in my own code by this task's harness:** both `except` blocks logged 
      an ORM attribute after `await db.rollback()`, and rollback expires every object 
      unconditionally — unlike `commit()`, which `AsyncSessionLocal` opts out of — so 
      the lazy load raised `MissingGreenlet` out of the handler and a duplicate rating 
      would have been served as a 500 instead of a 409. Fixed; failed-first by 
      reverting one line (1 failed / 42 passed, same exception class as the live run). 
      43 unit tests, **44/44** live in `check_ratings.py` against **38/44** for a 
      control that restores the trigger's own predicate, where the six failures are 
      all and only the aggregate assertions. Full regression: **248 unit / 564 live 
      across twelve harnesses**, DB back to baseline. ADR-018; ADR-009 amended; 
      handoff §12. Also corrected ADR-017's evidence line — it said 492 live 
      assertions across eleven harnesses, but the eleven it listed sum to 520 (492 was 
      the ten-harness total from before `partner_offers` was appended and the headline 
      was never recomputed).
- [x] k6 baseline re-run at the reduced pool + load-test report §8 corrected — 
      2026-09-27: the 2026-09-25 prediction of "~5-6 creations/s per worker" was 
      wrong in two independent ways and is now replaced by a measurement. At 
      `pool_size=3, max_overflow=2` one worker accepts **3.14 jobs/s** at an offered 
      10/s while **failing 57.1 %** of requests (621/1088, all app-side `QueuePool` 
      timeouts after the full 30 s, zero Supavisor `EMAXCONNSESSION`); the rate it 
      sustains **cleanly is 2/s** (181/181, 0 errors, p50 1.5 s). Prediction error 1: 
      it fed Little's law with §3's 860 ms dispatch window, but the profiled 
      connection-hold is **1198.3 ms** (655.0 ms in 16 statements + ~506.2 ms in 16.1 
      transaction-control/pre-ping round trips + 540.3 ms Python + 3.0 ms Redis) — 
      corrected arithmetic gives 4.2/s, measured 3.14/s. Prediction error 2: it 
      assumed `pool_timeout` would queue the surplus, but a *sustained* arrival rate 
      above capacity grows the queue without bound, so waiters time out and return 
      500s — `pool_timeout` converts overload into delayed 500s rather than absorbing 
      it. **The algorithm did not degrade**: DB-clock dispatch p50 871.9 ms vs 858.3 
      at pool=15, 100 % matched, 72.3 % divergence from pure-nearest, all four 
      invariants 0, 0 deadlocks — measured in a run where more than half the requests 
      failed. §4.1's `Dispatch unavailable:%` exclusion was applied and is empty 
      (469/469 jobs reached `matching`, `no_match_found` = 0 in all three runs), 
      which is stated in the report rather than skipped. Report updated: new §8.1 
      with the full comparison, header/§1/§2/§2.1/§3/§4.1/§5/§6/§8/§9.1/§10 
      cross-corrected; §2's figures kept as measured and re-labelled "pool=15". No 
      code change, no ADR (a measurement settling an existing decision belongs inside 
      it). Tooling note added: the collector's "1242 ceiling messages" is a line 
      count, two per failure. DB returned to documented baseline; 26 QA accounts and 
      18 Redis pins removed.
- [x] `GET /api/v1/partners/me/offers` — 2026-09-27: a partner can now discover the
      `assignment_id` it needs to answer an offer, which closes the last backend gap
      in the partner flow. Filter is assignment `'offered'` + job `'matching'`, the
      same predicate `respond_to_assignment` enforces under the lock, pinned to it by
      a test. No lock and no transaction on this read (ADR-015 amended — it is the
      second polled endpoint). No owner name, phone, `user_id` or pickup coordinates
      in the payload: ADR-017. 8 unit tests, 28/28 live
      (`check_partner_offers.py`, control 9/28). HANDOFF §10 rewritten with the
      shipped shape; §0 and §4 updated.
- [x] MAX_CONCURRENT_JOBS enforced at accept — 2026-09-25: capacity re-checked
      under `partners FOR UPDATE` inside the accept transaction; refusal is
      `409 PARTNER_AT_CAPACITY`, offer stays `'offered'`, re-dispatches once.
      Lock order is now `jobs` → `partners` → `job_assignments`. ADR-009 amended.
- [x] Jobs no longer stranded in 'requested' on Redis timeout — 2026-09-25:
      `find_candidates()` raises `DispatchUnavailableError`; the job lands in
      `no_match_found` with note `"Dispatch unavailable: ..."`. POST /jobs still
      201. ADR-016.
- [x] Connection pool config change — 2026-09-25: `pool_size=3, max_overflow=2`
      (5/worker, was 15), documented as a single-worker MVP constraint in
      README.md "Future Scope — deployment" and load-test report §9.1.
- [x] Accept-vs-cancel race condition fix (dispatch_service.py) — ADR-015 
      resolved
- [x] Cancel-vs-complete race condition fix (job_service.py) — ADR-015
- [x] Dispatch concurrency load test — ceiling documented, 2 new bugs found (both 
      fixed 2026-09-25, above)
- [x] Owner-side job cancellation
- [x] Job lifecycle status transitions (assigned → completed)
- [x] User registration
- [x] Vehicle registration + listing
- [x] Dispatch/matching engine (Redis GEOSEARCH + weighted scoring vs. naive 
      baseline)
- [x] Supabase Auth (JWT, phone OTP) + retrofit onto jobs/partners
- [x] Partner endpoints (register, availability, service linkage)
- [x] Jobs endpoints (create, get with timeline)
- [x] FastAPI skeleton + SQLAlchemy models + deploy to Render
