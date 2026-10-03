# ADR-001: FastAPI for Backend APIs

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Use FastAPI and Python for backend services.

## Context

The team has Python familiarity and needs validated async-friendly APIs. FastAPI provides Pydantic validation, automatic OpenAPI documentation, and native async support.

## Consequences

FastAPI is used. The team must maintain async/database-session discipline and avoid blocking map/network calls in request paths.

---

# ADR-002: Redis GEO for Live Partner Location; PostgreSQL for Durable Data

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Store current available-partner positions in Redis GEO, not in the relational `partners` table.

## Rationale

Coordinates change frequently and nearby search is latency-sensitive; completed jobs and their geography need durable relational storage.

## Consequence

Redis loss does not corrupt history, but live presence must be republished and matching degrades to manual handling during an outage.

---

# ADR-003: Unified Partner Application and Capability Model

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

One partner application supports mechanics, tow operators and fuel agents through `partner_services` and `partner_equipment`.

## Rationale

Separate apps/codebases by service type duplicate flow and block multi-capability partners.

## Consequence

Eligibility rules are more important and must explicitly enforce service/equipment verification.

---

# ADR-004: Assignment Attempts are First-Class Records

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Model a job request separately from `job_assignments`.

## Rationale

An assignment is an offer/attempt; one job can require several. Losing rejected/timeout attempts would hide dispatch quality and weaken evaluation.

## Consequence

Reports can calculate acceptance/retry metrics; state transitions are slightly more complex.

**Addendum, 2026-09-18 (implementation):** `job_assignments.status` ended up with a CHECK constraint permitting only `('offered','accepted','rejected','timed_out','completed')`. `timed_out` is written by nothing yet — there is no expiry worker — so today every terminal attempt is an explicit `rejected`. The column is not dead: it is the state a sweep will need, and adding it to the constraint later would be a migration on a table with live rows. See ADR-008.

---

# ADR-005: Weighted Matching with a Nearest-Only Baseline

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Rank eligible candidates using distance, load, skill and rating while retaining nearest eligible partner as experimental baseline.

## Rationale

Product differentiation needs evidence beyond claiming that a score is smarter.

## Consequence

Weights and scenario data must be documented; results are evaluation evidence, not a claim of universal optimality.

**Addendum, 2026-09-18 — the weights, as promised above.** `app/utils/scoring.py`:

| Component | Weight | Form |
|---|---|---|
| `distance_score` | 0.40 | `1 - d/10000`, clamped to [0, 1] |
| `load_score` | 0.20 | `1 / (1 + active_job_count)` |
| `skill_score` | 0.20 | constant `1.0` — every candidate is an exact service match today |
| `rating_score` | 0.20 | Bayesian-smoothed rating / 5 (ADR-009) |

Chosen, not fitted. Distance carries roughly twice any other term because a stranded driver experiences minutes, not ratings; the remaining three are equal because nothing yet justifies ranking them against each other. They are asserted at import to sum to 1.0, so a total score stays in [0, 1] and remains comparable across jobs — which is the only reason a stored `matching_score` from week 6 can be compared with one from week 20.

Every offer stores its own `score_components` JSONB, so re-tuning is an analysis over real offers rather than an argument. Bounded components are load-bearing, not cosmetic: the obvious `1/distance` diverges at zero, and one partner standing on the pickup point would then outrank any weighting of anything else.

The baseline is deliberately the dumbest possible strategy — sort by distance, take the first — and is computed independently of the ranking over the same candidate set, with exactly one candidate flagged `was_baseline_choice`. Comparing against a cleverer baseline would flatter the result.

---

# ADR-006: Docker Compose Before Kubernetes

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Use Docker Compose for MVP/local/staging parity; postpone Kubernetes.

## Rationale

Five-month, two-person scope should prove product correctness before cluster complexity.

---

# ADR-007: Test-Mode Payments Only

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Persist payment intent/status simulation without moving money.

## Rationale

A student MVP does not have the regulatory/operational foundation for payment aggregation.

---

# ADR-008: Partner Load is Counted Through `jobs.status`, Not Assignment Status

**Status:** Accepted  
**Date:** 2026-09-18  

## Decision

A partner's active-job count is `job_assignments.status = 'accepted'` **joined to** `jobs.status IN ('assigned','partner_en_route','in_progress')` — not the assignment-status filter the internal dispatch specification named.

## Context

The specification said to count `job_assignments WHERE status IN ('accepted','in_progress')`. That is not implementable as written: the column's CHECK constraint permits only `('offered','accepted','rejected','timed_out','completed')`, so `'in_progress'` can never appear in it — it is a *job* status, not an assignment status.

This is worth recording because of how it would have failed. Written literally the query is valid SQL, runs without error, returns plausible rows, and silently degrades to `status = 'accepted'`. Nothing surfaces the dropped term. The bug would have been a load score that was subtly wrong in exactly the situation the cap exists for.

Taking `'accepted'` alone is also wrong, in the opposite direction: nothing in the API yet moves an assignment from `'accepted'` to `'completed'` (that transition belongs to job completion, which is not built). An assignment-only count would therefore treat every job a partner has ever finished as still occupying them — their `load_score` would decay toward zero permanently, and after a few jobs a good partner would stop being dispatched for reasons nobody could see.

## Rationale

The job's status is the fact that actually answers "is this partner busy right now", and it is maintained — job status transitions are a first-class part of the flow with a `job_status_history` row behind each one. The assignment status answers "did they say yes", which is a different question. Joining the two asks both.

## Consequence

The eligibility query carries a correlated subquery across `job_assignments` → `jobs` rather than a single-table count. The constants are named and commented at the point of use (`ACTIVE_ASSIGNMENT_STATUSES`, `ACTIVE_JOB_STATUSES` in `app/repositories/dispatch_repository.py`), so the pairing cannot be half-edited later. When assignment completion *is* implemented, this stays correct without modification.

---

# ADR-009: Bayesian-Smoothed Ratings, and Concurrency as a Filter Not a Score

**Status:** Accepted  
**Date:** 2026-09-18  

## Decision

Two rules that a weighted score alone gets wrong:

1. `rating_score` smooths toward a prior of `PRIOR_MEAN = 3.5` with `PRIOR_WEIGHT = 5.0` imaginary reviews, rather than using the raw `rating_avg / 5`.
2. A partner holding `MAX_CONCURRENT_JOBS = 2` active jobs is removed from the candidate set entirely, in the eligibility filter — not penalised in `load_score`.

## Rationale

**On smoothing.** The raw average treats one five-star review as identical evidence to fifty. The failure is predictable and visible: the top of the board fills with partners holding a single review, because a perfect 5.0 from one customer beats a 4.7 earned over a year. It runs the other way too — one bad night gives a new partner a 1.0 they can never climb out of, since a partner nobody dispatches never earns a second rating.

Smoothing makes evidence accumulate before it moves the score: one 5★ review lands at 3.75/5, five at 4.25, fifty at 4.86. It also removes a special case — an earlier version scored unrated partners at a flat 0.6, which meant "no reviews" and "some reviews" were two different pieces of arithmetic that disagreed at the boundary, so a partner's score jumped the instant their first review landed. With a prior there is no boundary: an unrated partner simply *is* the prior (0.7), and every rating moves them off it continuously.

**On the cap.** One mechanic with one van can be in one place. A preference is not a limit: with the weights as they stand, a partner juggling four jobs 200 m away still outscores an idle partner 6 km out, so the busiest partner in a dense area becomes the default answer for everything near them. The second job is defensible — it is the one they drive to next, and holding it stops the queue stalling. The third is a promise nobody can keep, and the customer waiting on it has no way to know they are third in line.

It is a filter rather than a score of zero because it is a rule about physical capacity, not an opinion about quality. Expressed as a score it would sit inside the weighted sum where a future re-tuning could silently overrule it.

## Consequence

A perfect `1.0` total score is now unreachable — smoothing is asymptotic, so a heavily-reviewed 5★ partner at the pickup point approaches 1.0 without touching it. Scores stored before 2026-09-18 are not comparable with scores after it; there are none, because nothing has run in production.

`MAX_CONCURRENT_JOBS` can starve a thin candidate set: in a sparse area, capping the only nearby partner yields `no_match_found` where an uncapped system would have offered a third job. That is the intended trade — a refused match is visible and recoverable, an over-committed partner is neither.

**Amendment, 2026-09-24 — the filter is currently the cap's *only* enforcement point, and that is not sufficient.** Recorded here rather than as a new ADR because it is a consequence of this decision, not a separate one.

Choosing to express the cap as an eligibility filter means it is evaluated once, when candidates are selected, and never again. Two things follow that were not intended:

- An `'offered'` assignment costs no capacity — `ACTIVE_ASSIGNMENT_STATUSES` is `("accepted",)` (ADR-008) — so a partner can hold any number of outstanding offers while still looking idle to the filter.
- `POST /api/v1/job-assignments/{id}/respond` does not re-check the cap before accepting. `MAX_CONCURRENT_JOBS` appears nowhere in `assignment_service.py`.

So a partner who is offered five jobs before answering any of them can accept all five, and the filter that was supposed to stop the third one was satisfied — correctly — five offers ago. The 2026-09-24 load test observed one partner holding **four** accepted jobs against a cap of 2, and six distinct partners over cap in a single two-minute run; it also occurred at only 4 creations/s, so this is a missing check rather than a narrow race.

Full evidence: [`docs/load-test-dispatch-concurrency.md`](../load-test-dispatch-concurrency.md) §7.1.

The general lesson is the one worth keeping: **a filter enforces an invariant at the moment it runs, not for the lifetime of the thing it filtered.** Any rule expressed only as a candidate-selection filter needs a second check wherever the filtered-on state can change between selection and commit.

**Closed 2026-09-25 — the second enforcement point.** `dispatch_service._require_capacity()` now runs as the first statement of `_accept()`: it counts the partner's active jobs again and refuses with **`409 PARTNER_AT_CAPACITY`** when the accept would take them past `MAX_CONCURRENT_JOBS`. Four things about it were decisions rather than mechanics.

**1. The lock is on the `partners` row, not the `jobs` row — and the spec that asked for this fix assumed otherwise.** The obvious reading is to re-check "inside the transaction already locked for the accept-vs-cancel race" (ADR-015), but that lock is on the job, and the failure mode here is *one partner, two different jobs*: two job rows, so neither transaction waits for the other, both count the same pre-accept number, and both commit. The job lock cannot order them because they never contend for it. The `partners` row is the only row the two transactions have in common, so `dispatch_repository.lock_partner_for_update()` takes `FOR UPDATE` on it and the count runs after. Under READ COMMITTED the count is a later statement with a fresh snapshot, so the transaction that waits sees the accept that went first (the same EvalPlanQual property ADR-015 depends on). Nothing is written to the partner row; the lock is being used purely as a mutex on a number derived from other tables, which is why it has to be taken explicitly rather than falling out of an `UPDATE`.

**The lock order is now `jobs` → `partners` → `job_assignments`.** Verified acyclic by inspection before the change rather than after: `with_for_update()` appeared in exactly one place in the codebase (`job_repository.py`), so no path locked `partners` ahead of `jobs`, and the new lock could only be inserted in the middle. `pg_stat_database.deadlocks` held at 4 → 4 across the capacity harness. ADR-015's Resolved section records why that measurement is evidence and not proof.

**2. A refused offer stays `'offered'`; it is not written `'rejected'`.** Being full is not declining. Marking it rejected would charge a mechanic's acceptance rate for a limit the platform imposed on them — the same reasoning that gave owner-cancelled assignments their own status in ADR-012. The cost is that the job can briefly carry two live offers, the refused one and the re-dispatched one; the first accepted wins and the other gets the ordinary `ASSIGNMENT_ALREADY_ANSWERED`, which is already what happens to any offer a job outruns.

**3. The refusal re-dispatches, so a capacity refusal is indistinguishable from a decline on the customer's side.** `_require_capacity()` commits (releasing both row locks — `_offer_next()` reaches Redis, and this module holds no Postgres lock across a call to another service) and calls the same `_offer_next()` a rejection uses, *then* raises the 409. The 409 is the partner's answer; the customer's job simply moves to the next candidate.

**4. The re-dispatch is guarded on `assignment_rank`, which the spec did not ask for and the design needs.** Because the refused offer survives at `'offered'`, the partner's app keeps showing it and it will be tapped again. Unguarded, every tap fires another `_offer_next()`: one more candidate burned per tap, the pool walked to exhaustion, and the job finally landed in `no_match_found` while several partners were still holding live offers for it. Re-offering only when this offer is the newest one on the job (`assignment.assignment_rank >= get_max_assignment_rank()`) makes the refusal idempotent.

**`PARTNER_AT_CAPACITY` is its own error code rather than a reuse of `ASSIGNMENT_ALREADY_ANSWERED`,** because the remedies differ: that one means the offer is gone and there is nothing to retry, this one means *you are full* and the same offer may well be acceptable in ten minutes. 409 rather than 403 because permission is not the problem — the state is, and it changes on its own.

**Evidence.** 21 unit tests (`tests/unit/test_dispatch_capacity.py`), **11 failing** with `_require_capacity` neutered to a no-op; the 10 survivors are the regression guards and the pure contract assertions, which deliberately do not depend on the new call site. Live: **49 of 49** in `tests/integration/check_dispatch_capacity.py` against **28 of 45** with the same call removed. The control run reproduced the original defect exactly — six QA partners ending on **3** active jobs against a cap of 2 — including a scaled-down replay of the load test's own shape (12 jobs, 4 partners, all offers made while the fleet was idle, then every accept fired at once): **12 accepted / 0 refused / every partner over cap** reverted, against **8 accepted / 6 refused / every partner at exactly 2** fixed. The two-way race at `MAX_CONCURRENT_JOBS - 1` splits one 200 and one `PARTNER_AT_CAPACITY` with the fix and two 200s without it, and the assertion that discriminates them is the count on the row, not the status codes.

**Amendment, 2026-09-29 — until this date the smoothing above had no input to smooth.** `rating_score` reads `partners.rating_avg` and `partners.rating_count`, and nothing in the system could write either column: the Postgres trigger meant to maintain them resolved the rated partner through `job_assignments.status = 'accepted'`, which completing a job has already left. So `rating_count` was zero for every partner forever, every candidate took the `UNRATED_PARTNER_RATING_SCORE = 0.7` branch, and this ADR's entire rationale — that evidence should accumulate before it moves a score — described arithmetic that never ran on a real rating. Ranking was decided by distance, load and skill alone, at effective weights of 0.5 / 0.25 / 0.25 rather than the documented 0.4 / 0.2 / 0.2 / 0.2.

**ADR-018** records who maintains those two columns now and why the aggregate is recomputed from source rather than incremented. The division of ownership between the two ADRs is deliberate: the formula, the prior and the cap live here; the writer, its lock and its storage exception live there. It also matters for reading any earlier dispatch measurement — no ranking *produced by the application* before 2026-09-29 exercised this dimension, though the load-test harness did, by writing the columns itself (ADR-018's Consequence, corrected 2026-09-30). What that dimension is worth was measured on 2026-09-30 and is load-test report §4.2: without it this formula reduces exactly to `argmin(distance)`.

---

# ADR-010: Stale Partner Locations are Observed, Not Enforced

**Status:** Accepted  
**Date:** 2026-09-18  

## Decision

`MAX_LOCATION_AGE_S = 300` is measured and logged per candidate (`dispatch_stale_partner_location`, `enforced=False`). No partner is excluded for a stale position.

## Rationale

There is no partner client yet, so nothing pushes location on a timer — positions are written only when something explicitly calls `POST /partners/{id}/location`. A hard cutoff today would empty every candidate set within five minutes of the pilot starting, and the failure would present as "the matching engine finds nobody", which is the most expensive possible way to learn this.

Beyond the timing, "stop offering work to a partner because their signal dropped" is a decision about someone's earnings. It belongs to whoever owns that call, not to a matching change.

## Consequence

Dispatch can offer a job based on a position that is hours old. The staleness is visible in the logs rather than hidden, which is the part that cannot be added retroactively — the timestamp has to have been written all along.

Revisit when the partner client pings periodically (blocked on the partner frontend). At that point a stale position genuinely means the app is closed or the signal is gone, and enforcing it is a one-line change.

---

# ADR-011: Owner Registration Binds the Auth Account in the Same INSERT, and "Not Registered" is a Distinct Error From "Not Linked"

**Status:** Accepted  
**Date:** 2026-09-19  

## Decision

`POST /api/v1/users` creates a vehicle owner's profile with `auth_user_id` set from the verified token's `sub` **in the same INSERT**. Owner signup is therefore one round trip, not registration followed by `link-auth`.

`POST /api/v1/users/{user_id}/link-auth` is kept, unchanged, for rows that arrive by some other route.

`resolve_identity` now answers two different 403s where it previously answered one:

| Evidence | Code | Client remedy |
|---|---|---|
| An **unclaimed** profile (`auth_user_id IS NULL`) matches the token's phone claim | `IDENTITY_NOT_LINKED` | call the matching `link-auth` |
| No local row and no unclaimed profile | `USER_NOT_REGISTERED` | call `POST /api/v1/users` |

`users.phone_verified` is written `true` only when the token's phone claim matches the submitted number, `false` when the token carries no phone claim, and the request is refused with `400 PHONE_MISMATCH` when the two differ.

## Context

Until this change nothing in the API created a `users` row. A brand-new owner could pass OTP, hold a perfectly valid token, and be refused by every endpoint forever — which made the Month 2 pilot (10–20 manual bookings with real owners) unrunnable, since every one of those owners hits it on first launch.

## Rationale

**One INSERT, not two calls.** Partner signup is two steps because the two events genuinely happen at different times and by different people: ops onboards a mechanic in person, frequently before that mechanic has ever opened an app, so the profile has to be able to exist before the Supabase account does. An owner's situation is the opposite — they have just passed OTP, they are holding the token, and nobody else is involved. Splitting that into two calls would add a window in which a `users` row exists that no account owns, for no benefit. Doing it in one statement means registration either happened or did not.

`link-auth` survives because it covers what registration cannot: a row already in the table. `db/seed.sql` produces those today and a data migration would produce more. Deleting the endpoint would leave those rows permanently unreachable.

**Why the error split is not cosmetic.** The obvious move — rename `IDENTITY_NOT_LINKED` to `USER_NOT_REGISTERED` — breaks partner onboarding. A mechanic registered by ops through the open `POST /api/v1/partners` sits with `auth_user_id` NULL by design, waiting for `link-auth`. Send that mechanic to owner signup and their next call fails with `PARTNER_ALREADY_EXISTS`: a dead end with no instruction that escapes it. So the two are distinguished by evidence rather than by guess, at the cost of one indexed query (`phone IN (...) AND auth_user_id IS NULL`) on a path that has already failed. `IN` over the two spellings of the number keeps the unique index usable; normalising the column with a function would turn this into a table scan on every unregistered request.

**Why both are 403 and neither is 401.** 401 means "your credentials are not good enough", and the standard client response to it is to re-authenticate. Here the credentials are perfect — the token verified. A client that reads 401 sends the user back to OTP entry, they pass OTP again, they get another valid token, and they arrive at the same 401. The loop has no exit. 403 says the token is fine and the account is not yet entitled, which is exactly true and which the client can act on.

**`phone_verified` — the spec said X, the schema made X mean something else.** The specification for this endpoint said to insert `phone_verified=true` unconditionally, reasoning that Supabase had already verified the number by OTP for the caller to get this far. That reasoning is correct about the **token** and silent about the **body**. Supabase verified the number in the token; nothing in the request connected that to the number in the payload.

Set `true` unconditionally, the column would record "the client asserted this" while its name promises "this was proved" — and the gap is exploitable, not merely untidy. `users.phone` is UNIQUE, so anyone holding any valid Supabase session could register a stranger's number as verified, and the real owner would then be permanently unable to sign up: their own registration would return `USER_ALREADY_EXISTS` with no path around it.

Resolved by making the column record what was actually proved, using only material already in hand — a consistency check between token and body, not the independent OTP step the spec explicitly ruled out. Tokens with no phone claim (email and OAuth sign-ins, which this Supabase project can issue) store `false` rather than being refused: blocking a legitimate signup over a claim that was never required would be worse than an honest `false` that `link-auth` or a later profile update can correct.

Comparison is exact equality on digits only. Supabase reports the claim without the leading `+` (`919000000801`) while the schema stores E.164 (`+919000000801`), so the two never match as strings. Suffix matching was rejected because it collides across country codes — `+1 9000000801` is a suffix of `+91 9000000801`.

## Consequence

Owner signup is a single authenticated call, and no code path now produces a `users` row without an owner.

`phone_verified` is meaningful for the first time: `true` means a Supabase OTP proved that number for that account. Rows created before this change, and rows from email or OAuth signups, read `false` — so the column must be read as "proved" and never as "reachable". Any feature that needs a reachable number (dispatch SMS, job notifications) has to treat `false` as unknown rather than as bad.

Clients must handle three codes on an authenticated route instead of one. `USER_NOT_REGISTERED` was added rather than repurposing an existing code precisely so that older clients fail loudly on something they do not recognise, instead of quietly routing a mechanic into owner signup.

---

# ADR-012: The Job Lifecycle Endpoint — a Cancelled Assignment Gets Its Own Status, and What Actually Frees a Partner

**Status:** Accepted  
**Date:** 2026-09-21  

## Decision

`POST /api/v1/jobs/{job_id}/status` lets the partner responsible for a job move it along its lifecycle. Four decisions sit inside it:

1. **Legal moves are a table, not a chain of branches.** `ALLOWED_TRANSITIONS` maps every one of the eight statuses in the `jobs` CHECK constraint to the set reachable from it: `assigned → partner_en_route → in_progress → completed`, plus `cancelled` from any of those three. `completed`, `cancelled`, `no_match_found`, `requested` and `matching` reach nothing a partner can ask for. Anything outside the table is `409 INVALID_STATUS_TRANSITION`.

2. **A cancelled job's assignment becomes `'cancelled'`, not `'rejected'`.** This needed a new value in the `job_assignments.status` CHECK constraint — `db/migrations/003_assignment_cancelled_status.sql`, applied.

3. **Check order is 404 → 403 → 409 → 400**, and "responsible partner" means an assignment in `('accepted', 'completed', 'cancelled')`, not `'accepted'` alone.

4. **Every transition writes a `job_status_history` row** in the same transaction as the job columns and the assignment status.

## Context

Before this endpoint, nothing in the API could move a job off `assigned`, `partner_en_route` or `in_progress`. Dispatch created jobs and offers; `POST /job-assignments/{id}/respond` accepted them; and there the lifecycle stopped. A partner who accepted one job was one job busier for the rest of time.

## Rationale

**Why `'cancelled'` and not `'rejected'` on the assignment.** The specification left this open and asked for a decision with reasons. `'rejected'` already means something specific and narrow: *the partner was offered this job and said no*. It is the partner's answer to an offer, it is set on the `respond` path next to `responded_at`, and it is the raw material for an acceptance-rate metric — the number that will eventually decide who gets offered work.

A customer cancelling a job the partner had already accepted is a different event with a different author. Recording it as `'rejected'` would take a decision made by the customer and write it onto the partner's record, where it would read as a refusal and, once acceptance rate is scored, cost that partner future work for something they did not do. Doing that to a mechanic's livelihood to save one line in a CHECK constraint is not a trade worth making. The alternative considered — leaving it `'accepted'` — was ruled out by the specification and independently by correctness: it would leave a closed job occupying its partner's capacity.

The cost is a migration against a live database and one more value clients must recognise. Both are cheap; the audit trail's honesty is not recoverable later.

**What actually frees the partner — a correction to the premise.** The task described the assignment update as "what finally frees the partner from the active-job-count query", and asked for that to be confirmed explicitly. Confirmed, but not in the way stated, and the difference matters. The count in `dispatch_repository.get_eligible_partners` ANDs both sides:

```
JobAssignment.status IN ('accepted')  AND  Job.status IN ('assigned','partner_en_route','in_progress')
```

Moving the **job** to `completed` or `cancelled` already drops it from the count on the `Job.status` side, whatever the assignment says. So the assignment update is not the mechanism that releases the partner — the job status transition is, and the assignment update is the second half of a consistent write.

That makes it worth keeping rather than optional. Both sides are written in one transaction, and the join is what keeps the count correct if they ever disagree: an assignment stranded at `'accepted'` by a partial write would otherwise occupy its partner indefinitely, with the job status — the side a human reading the database would trust — saying the opposite. Both halves are verified in `tests/integration/check_job_lifecycle.py` §2 and §3.

The real bug this task fixed is the plainer one: **no endpoint could move a job off an active status at all**, so no partner's load ever went back down. The regression test is §3 — drive a partner to `MAX_CONCURRENT_JOBS`, confirm dispatch stops returning them as a candidate, close the jobs out, confirm they come back. It measures load by calling the production eligibility query rather than re-implementing the SQL it is checking.

**Why 403 before 409.** The legality of a transition is a fact about a job's current status. If the legality check ran first, anyone holding a partner token could sweep the four requestable statuses against a job id and read that job's state off the 409/403 pattern without ever being on it. Authorising first means a non-participant gets the same 403 whatever the job's state.

**Why "responsible" is wider than "currently accepted".** The first implementation looked up the assignment by `status = 'accepted'`, which is correct for a live job and wrong the instant one finishes: completion closes the assignment out, so the lookup found nothing and the job's own partner was told `403 — you are not the partner assigned to this job`. Both the code and the sentence were wrong; they had just completed it. The integration harness caught this and the unit tests did not, because the unit fixture paired a `completed` job with an `'accepted'` assignment — a state the database cannot hold. The fixture now mirrors reality and the case is pinned directly.

So authorisation asks *whose job is this*, and the answer does not expire when the job does: `('accepted', 'completed', 'cancelled')`, all three of which descend from an acceptance. `'offered'`, `'rejected'` and `'timed_out'` mean the partner was asked, which confers nothing. The probing defence is untouched — an intruder is still refused on `partner_id` before any status is consulted.

**Why 409 before 400.** A client completing an already-completed job should be told the job is finished, not told to add a `price_final`. The other order costs two round trips to learn one fact, and the second one is a 409 anyway.

**Why `price_final` on a non-completion is a 400 rather than ignored.** A client sending it has the wrong state in mind. Accepting the request silently would confirm a price was recorded when none was. Same for `cancellation_reason` outside a cancellation. A missing `cancellation_reason` **is** allowed — a mandatory reason field produces a column full of "x".

**Timestamps come off the database clock.** `completed_at`, `cancelled_at` and `changed_at` are written as `func.now()`, so "how long did this job take" does not depend on which API process served which request, or on that machine's clock drift. The cost is that the in-memory object holds a SQL expression until `db.refresh()` resolves it — which is why the unit suite's fake session substitutes a datetime on refresh rather than being a no-op.

**The repository's write path is allowlisted.** `update_job_fields` is a generic setter, which keeps the "does this status need a price?" branching in the service where it belongs. Generic setters write anything, so it refuses any field outside `{status, price_final, completed_at, cancelled_at, cancellation_reason}` with a `ValueError` — a programming error, not an HTTP one. It is the guard against a future edit reaching for a convenient writer and landing on `user_id`.

## Consequence

A job can now reach a terminal state, so a partner's capacity is released and `MAX_CONCURRENT_JOBS` stops being a one-way ratchet. This is visible in Adarsh's tracking screen without any frontend change: job status will now actually advance past `assigned`.

`job_assignments.status` has a sixth value. Anything grouping assignments by status — an acceptance-rate metric above all — must treat `'cancelled'` as neither an acceptance nor a refusal, or it will read a customer's decision as the partner's.

The endpoint is partner-only. An owner cancelling their own job needs a different route with different authorisation, and deliberately does not reuse this one, since a partner-authenticated path that also accepted owners would make `require_partner` a lie. That route was built next — `POST /api/v1/jobs/{job_id}/cancel`, ADR-013 — and it inherits the `'cancelled'`-not-`'rejected'` rule decided here, for the same reason and with more force: on this endpoint the partner at least made the decision themselves.

One detail of this endpoint changed when ADR-013 landed. The `job_status_history` note on a partner cancellation used to be the bare `cancellation_reason`; it is now prefixed with the actor, so `"car started"` is written as `"Cancelled by partner: car started"`. `job_status_history` has no actor column, and once both roles can write a `cancelled` row, an unprefixed note makes the two indistinguishable. Both paths call one helper so the spellings cannot drift.

---

# ADR-013: Owner Cancellation is Its Own Route, and `no_match_found` is Not Terminal for the Person Who Asked

**Status:** Accepted
**Date:** 2026-09-22

## Decision

`POST /api/v1/jobs/{job_id}/cancel` lets a vehicle owner call off their own job. Six decisions sit inside it:

1. **A separate route, not a role branch on `/status`.** `/status` is the partner's, `/cancel` is the owner's. They are guarded by different dependencies (`require_partner` vs `require_user`), answer to different ownership columns (`job_assignments.partner_id` vs `jobs.user_id`), work from different status sets, and take different request bodies.

2. **`Depends(require_user)` rather than the specified `get_current_identity` plus an inline role check.** Same behaviour, declared in the route signature.

3. **Check order is 404 → 403 → 409.** Ownership is established before the job's state is consulted.

4. **Every non-terminal status is cancellable, including `no_match_found`.** Terminal here means `{completed, cancelled}` and nothing else — a deliberately different rule from `ALLOWED_TRANSITIONS`, held in its own constant, `TERMINAL_JOB_STATUSES`.

5. **`409 JOB_ALREADY_TERMINAL`, a new error code**, rather than reusing `INVALID_STATUS_TRANSITION`.

6. **Every open assignment is closed as `'cancelled'`** — `('offered', 'accepted')`, plural, via `job_repository.get_open_assignments`.

## Context

Before this endpoint the booking flow had no exit. Dispatch created jobs and offers, partners accepted and completed them, and an owner who changed their mind had nothing to press. Worse, the window with no exit was precisely the window where a driver is most likely to change their mind: `requested` and `matching`, while they are sitting at the roadside watching a spinner and deciding whether to call a friend instead. The partner endpoint cannot reach those statuses at all — there is no assigned partner yet to authorise the call.

## Rationale

**Why a separate route.** One route branching on `identity.role` would carry two authorisation models in one handler, and the branch would sit *after* the dependency had already decided the caller was acceptable — which means the dependency could no longer be either `require_user` or `require_partner`, only `get_current_identity`. That trades a precise declared guard for an imprecise one plus an `if`, and it is exactly the shape in which a future edit drops the `if` on one path. It would also read wrong in OpenAPI: one operation whose description has to explain that half of it does not apply to you.

They are also not the same operation in product terms. A partner cancelling is a mechanic declaring they cannot do the job — a reliability event, and one that should eventually cost them something. An owner cancelling is a customer changing their mind — a refund conversation at worst. Collapsing them into one route makes that distinction a column value rather than a route, and the whole point of ADR-012's `'cancelled'` status is that the distinction must survive.

**Why `require_user` over the specification's literal `get_current_identity`.** The specification asked for `Depends(get_current_identity)` and then `role == "user"`. `require_user` *is* those two things, already written, already used by `create_job`, and mirrored by `require_partner` on the sibling endpoint. Putting the role gate in the signature means it appears in the generated OpenAPI security documentation and cannot be skipped by an early `return` added later. The deviation is naming only; the behaviour is what was asked for.

**Why `no_match_found` is cancellable.** This is the one genuinely contested status, and the two endpoints disagree about it on purpose.

`ALLOWED_TRANSITIONS` gives `no_match_found` an empty set, so by the partner's rules it looks terminal — correctly, because no partner was ever assigned and none has standing to move it. The owner's question is a different one. A job that found nobody is not a finished job; it is a request that was never served. From the driver's side it is still open, and it is the *most* likely thing they want to clear: nobody came, so they called a tow truck, and the app still shows a live booking.

Refusing would leave that row permanently un-closable by the only person with an interest in closing it, and would leave it eligible for the re-dispatch sweep that will exist later. Nothing is lost by allowing it — `job_status_history` keeps the `no_match_found` entry, so "we failed to find anyone for this job" remains answerable, and the analytics question is asked of the history table, not of the current status.

`TERMINAL_JOB_STATUSES` is therefore a separate constant rather than a derivation like `ALLOWED_TRANSITIONS[s] == frozenset()`. The two rules genuinely disagree on one value; deriving one from the other would silently make them agree the next time either is edited, and the direction that failure takes is the harmful one — a driver who cannot cancel.

**Why a new error code.** `INVALID_STATUS_TRANSITION` answers "you cannot get *there* from here", which requires a caller who named a target status. An owner cancelling names no target — the body has one optional field and deliberately no `status`. The only thing that can be wrong is that the job is already over. The client remedies differ too: the partner's 409 means retry with a different status, the owner's means stop rendering a cancel button for this job. Two different remedies behind one code is a code that tells the client nothing.

**Why 403 before 409, again.** Same reasoning as ADR-012 and it binds harder here. The cancel body carries nothing worth guessing, so the error code would be the *entire* oracle: a stranger holding any user token could sweep job ids and read each one's state off whether they got 403 or 409. Both the unit suite and the integration harness pin this by asking a second real registered owner to cancel a *completed* job that is not theirs and asserting 403 — the case where the two orderings visibly differ.

The 403 message also names neither the owner nor the status: *"This job belongs to a different account"*. The caller has established that the id exists and nothing else.

**Why the assignment close is plural.** At most one assignment should be open at a time — dispatch offers to one partner and moves on only after that offer closes. But "should" is doing work there that no UNIQUE constraint is doing, and the cost of the assumption being wrong is specific and bad: a `job_assignments` row left at `'offered'` against a job that no longer exists for anyone, sitting on a mechanic's phone with an accept button that still works. Closing every open row costs one loop and removes the need for the invariant to hold.

`'offered'` is closed as well as `'accepted'` for the same reason. Being offered a job confers no authority — which is why `RESPONSIBLE_ASSIGNMENT_STATUSES` excludes it — but it does create an obligation to tell that partner the job is gone. The two constants overlap on `'accepted'` and differ on everything else, so neither is derived from the other.

And the value written is `'cancelled'`, never `'rejected'`, for ADR-012's reason: `'rejected'` is the partner's own answer to an offer and feeds acceptance rate. On this route the partner did not answer at all — the customer removed the question. Charging a mechanic's record for that would be worse here than on the partner path, where at least the partner made the decision.

**The actor is in the note, and that is a workaround.** `job_status_history` has `status`, `changed_at` and `note`, and no actor column. Once both roles can write a `cancelled` row, the table cannot answer the single most useful question about a cancellation: did the customer call it off, or did the mechanic? That is the difference between a refund conversation and a reliability problem, and it is the first thing anyone will ask of this data.

The real fix is a `changed_by_role` column, and it is deliberately not in this task: it is a schema change plus a backfill decision for the existing rows, whose actor is not recoverable. Until then the note carries it — `"Cancelled by owner"`, `"Cancelled by partner: car started"` — written by one helper, `_cancellation_note`, used on both paths so the two spellings cannot drift and leave the column unqueryable by the `LIKE` that will eventually be run against it.

This changed the partner endpoint's existing behaviour: a note that used to read `"car started"` now reads `"Cancelled by partner: car started"`. Visible in Adarsh's timeline UI, and written down in the handoff rather than left to be discovered.

**Closed 2026-09-23: the cancel-versus-complete lost update.** This ADR originally named a deferral here — neither endpoint locked the job row, so an owner cancelling at the same moment as the partner completed had both transactions read `in_progress`, both pass their checks, and the later commit win, leaving the job `completed` with a `cancelled_at` set or `cancelled` with a `price_final`. It was fixed in its own task, as planned, with `SELECT … FOR UPDATE` on both mutating reads.

The decision has its own record in **ADR-015**, because the substance of it is not owner cancellation: it is that the locking read had to be a *second* repository function so the polled `GET /jobs/{job_id}` could stay lock-free, and that the whole thing rests on the connection running at READ COMMITTED. Nothing in this ADR's contract changed — the 409 `JOB_ALREADY_TERMINAL` documented above simply became reachable in practice, where before it could be raced past.

## Alternatives considered

**A `DELETE /jobs/{job_id}`.** Rejected: a cancelled job is not a deleted job. It keeps its history, its partner's time, and its place in "how many bookings did we lose before anyone arrived" — which is the retention question the pilot exists to answer.

**A 204 with no body.** Rejected: the client needs to know whether a partner was released, because that decides whether the confirmation screen says "your booking is cancelled" or "we've let Ramesh know". That is `assignment_status`, which is `null` when the job had never been offered.

**Reusing `JobStatusTransitionResponse`.** Rejected: it carries `price_final` and `completed_at`, both null by definition on this path, and its field-visibility reasoning is about withholding `jobs.user_id` from a *partner* — the wrong audience entirely.

## Consequence

The booking flow has a cancel button for the first time, and it works from every status a driver can actually be looking at, including the pre-match window that had no exit at all.

Adarsh's owner app needs the new endpoint wired up; `HANDOFF-frontend-contract.md` §7 has the contract, and §6.3 — which previously told him no owner cancel endpoint existed — is corrected. The timeline-note change on the partner path is flagged there too.

`job_status_history` notes are now structured-ish text with an actor prefix. Anything parsing them should expect that; the proper `changed_by_role` column remains open.

Verified by 28 unit tests (`tests/unit/test_job_cancellation.py`) and 54 live assertions against real Postgres and real Supabase tokens (`tests/integration/check_job_cancellation.py`), including the regression that matters most: cancelling an accepted job drops the partner's active-job count back to zero, measured through the production eligibility query rather than a count written by the test.

---

# ADR-014: Registration Numbers are Normalised, Not Validated, and Deliberately Not Unique

**Status:** Accepted
**Date:** 2026-09-23

## Decision

`POST /api/v1/vehicles`, `GET /api/v1/vehicles` and `GET /api/v1/vehicles/{vehicle_id}` let a vehicle owner register their own vehicles and read them back. Eight decisions sit inside them:

1. **`vehicle_number` is normalised on the way in — uppercased, with whitespace and dashes removed — and is not format-validated.** There is no Indian-registration regex. `"ka 01 ab 1234"`, `"KA-01-AB-1234"` and `"KA01AB1234"` all store as `KA01AB1234`.

2. **`vehicle_number` is not unique, globally or per owner.** Two owners can each register the same string, and so can one owner twice. There is no `VEHICLE_ALREADY_EXISTS` error code, by choice rather than by omission.

3. **Normalisation rejects non-ASCII alphanumerics.** A Cyrillic `А` in `KА01AB1234` is a 400, not a stored row.

4. **`404 VEHICLE_NOT_FOUND` for a vehicle that belongs to someone else**, identical in status, code and message to the 404 for a vehicle that does not exist.

5. **An owner with no vehicles gets `200` and `[]`.** Not a 404, not an error of any kind.

6. **`vehicle_type` is required by the API although `vehicles.vehicle_type` is nullable** — and is typed `Literal[...]` inbound but `Optional[str]` outbound.

7. **`get_vehicle_by_id` moved out of `job_repository` into `vehicle_repository`** rather than being copied into it.

8. **`Depends(require_user)` rather than the specified `get_current_identity` plus an inline role check** — the same substitution as ADR-013 item 2, for the same reason.

## Context

Every job that has ever been created in this system used a vehicle row inserted by hand. The jobs endpoint shipped with an ownership check against `vehicles.user_id`, dispatch matched against it, the lifecycle and cancellation endpoints both read it — and none of that was reachable by a real person, because there was no way to get a vehicle into the table without database access. The owner-facing happy path had a hole in the middle that no amount of testing the surrounding endpoints could have found, because every one of those tests started by stepping over it.

That is what makes this a blocker rather than a feature. Ratings, notifications and admin endpoints are additions to a working product; this was a missing segment of the one path the Month 2 pilot depends on.

## Rationale

**Why normalise and not validate.** Indian registration formats vary by state, by vehicle class and by era: the current `XX 00 XX 0000` series, the newer BH series (`22 BH 1234 AA`), older single-letter series codes, trade plates, and military and diplomatic formats that follow none of it. A regex tight enough to be worth writing will refuse a real plate on a real vehicle in front of a real owner at the roadside — and the failure lands at the worst possible moment, on someone who needs help now and is being told their car does not exist. The false-rejection cost is asymmetric with the benefit: a malformed number that gets stored is a data-quality annoyance an admin can fix later, while a rejected valid number is a customer who cannot use the product at all.

Normalisation is the part that carries real value, and it is not validation. Its job is that one physical vehicle produces one string, so `vehicles.vehicle_number` can be searched, matched against a job's snapshot, and eventually deduplicated. That works without knowing anything about what a valid plate looks like.

**Why dashes, beyond the literal specification.** The task said "uppercase, strip whitespace". Stripping only whitespace does not meet the specification's own stated goal — that two spellings of one vehicle must not become two rows — because `KA-01-AB-1234` and `KA 01 AB 1234` are the same plate written by two people, and phone keyboards emit en- and em-dashes where the user meant a hyphen. So ASCII hyphen, en-dash, em-dash and underscore are stripped too. The goal was followed rather than the letter, and the divergence is recorded here because that is the rule for this project.

**Why the ASCII guard.** `str.isalnum()` is Unicode-aware. Cyrillic `А`, Greek `Α` and Latin `A` all pass it and all render identically in every font anyone will use. Without the guard, `KА01AB1234` with one Cyrillic character stores as a row that is byte-different from `KA01AB1234` and visually indistinguishable from it — reintroducing the exact duplicate normalisation exists to prevent, in the single form that cannot be spotted by reading the data or by any `SELECT` anyone would think to write. `normalised.isascii() and normalised.isalnum()` closes it for the price of one line.

**Why registration numbers are not unique.** This is the decision most likely to be "fixed" into a bug later, so the reasoning is explicit.

A `UNIQUE` constraint on `vehicle_number` means that the first person to typo their plate as someone else's permanently locks the real owner of that plate out of the product. The error that owner sees is unanswerable: their number is correct, their car is real, and the system tells them to contact support. There is no self-service remedy, because the fix requires editing a row belonging to a different account.

A per-owner unique constraint is narrower but buys little and still misfires — a family that shares one car across two accounts, a fleet owner re-registering after deleting a vehicle, or simply someone adding the same car twice, which is a UI problem to solve with a confirmation prompt rather than a database error.

The case a `UNIQUE` index is reached for is real — two accounts claiming one vehicle is either a typo or fraud — but the response to it is admin review with both accounts' history in view, not a hard refusal at insert time that cannot tell the two apart. Insert time has the least information available and the worst place to fail.

The decision is also cheap to reverse in the direction that matters: adding a constraint later is a migration plus a duplicate-resolution pass. Removing one after clients have shipped error handling for it is harder. And it required no schema work now — `vehicles.vehicle_number` is `String(20)` with no `UNIQUE`, so the model already agreed.

Both suites assert it rather than assume it: `test_duplicate_number_is_not_refused` in the unit tests, and a live registration of the same plate twice in the harness. A future `UNIQUE` index would fail those tests instead of silently changing the product.

**Why 404 and not 403 for someone else's vehicle.** ADR-012's and ADR-013's reasoning, applied to a resource with a much larger attack surface. A 403 here would mean the endpoint answers "does this UUID name a vehicle?" for any authenticated caller, and vehicle ids are the one identifier that appears in a job body — so an owner who has seen one job can probe around it. The 404 is byte-identical in both cases: same status, same code, same message. Pinned by `test_the_two_404s_are_indistinguishable` in the unit suite and, more meaningfully, in the harness by a *second real registered owner* asking for a vehicle that genuinely exists and genuinely is not theirs. A 404 that is only ever produced by ids that do not exist is not anti-enumeration at all, and a forged id could not tell the difference.

**Why an empty list is not an error.** Every user is in this state between finishing signup and adding their first vehicle. It is the most ordinary moment in the product. A 404 there would make a client render an error screen for a new user who has done nothing wrong, and would push every client into treating a normal empty collection as an exception — which is how "you have no vehicles yet, add one" becomes "something went wrong".

**Why `vehicle_type` is required inbound and nullable in the column.** The column predates this endpoint and is nullable; existing rows may have a NULL. Requiring it at the API stops *new* rows being created without it, which is the only part still in anyone's control, and does so without a migration or a backfill decision about rows whose type is not recoverable. Tightening at the edge and leaving the column alone is the reversible direction: relaxing the schema later costs nothing, while a `NOT NULL` migration has to answer for every existing row first.

The inbound/outbound type asymmetry follows from the same fact and is not an inconsistency. `Literal["two_wheeler", "four_wheeler"]` on `VehicleCreateRequest` is validation, and rejecting `"spaceship"` is correct. The same `Literal` on `VehicleItem` would be response validation, and a legacy row with a NULL or an unexpected `vehicle_type` would then produce a 500 — the API refusing to show an owner their own vehicle because it disapproves of data it already stored. Outbound is `Optional[str]`. Strict on the way in, tolerant on the way out.

**Why the repository function moved instead of being copied.** `job_repository.get_vehicle_by_id` already existed, because job creation was the only caller that had ever needed to read a vehicle. Writing a second copy in `vehicle_repository` would have left job creation's ownership check and `GET /vehicles/{id}`'s 404 reading the same row through two different `SELECT`s — and they have to agree about what "this vehicle" means, since between them they decide whether a job can be raised against it. Two copies of one query is the mechanism by which they would eventually stop agreeing. Nothing patched or imported it by name outside `job_service`, checked before moving it, so the move was free.

`get_vehicle_by_id` is deliberately not filtered by owner. Ownership is a rule, and the two callers apply it differently: `get_user_vehicle` returns 404 for a vehicle that is not yours, while `create_job` returns 404 with a different message from a different code path. A repository that pre-filtered by `user_id` would make both of those the same query returning `None`, which reads fine until one of them needs to distinguish "no such vehicle" from "not yours" — for a log line, or for an admin endpoint.

**Why `vehicle_number` is in the redaction list but not in the success log.** `_REDACTED_KEYS` gained `vehicle_number` as a backstop, and `register_vehicle` separately does not pass it to `log_event` at all. A registration number is quasi-identifying — it maps to a person through a public register — and logs are the artifact most likely to be read by someone with no business reading customer data. The `vehicle_registered` event records `vehicle_id`, `user_id` and `vehicle_type`, which is enough to debug with and not enough to identify a car. Verified that the redaction entry changes no existing log line: the only other use of that key name is a `JobDetailResponse` field, which is a response body, not a log.

## Alternatives considered

**A regex per state series.** Rejected. It is a maintenance commitment to a dataset that changes by government notification, the failure mode is refusing real vehicles, and the benefit — cleaner data — is available later through an admin review pass with no customer-facing downside.

**`UNIQUE (user_id, vehicle_number)`.** Rejected, above. The genuine duplicate problem it addresses is a review problem; the 409 it produces has no self-service remedy.

**Soft-flagging duplicates at registration** — store the row, mark it for admin attention. Not rejected, deferred. It is the right eventual answer and it needs somewhere for the flag to go and someone to look at it, neither of which exists yet. Registering the row without blocking is the half of it that is useful now, and the half that does not have to be undone later.

**`PATCH`/`DELETE /vehicles/{vehicle_id}`.** Out of scope for this task and genuinely harder than it looks: `jobs.vehicle_id` has no `ON DELETE` clause, and a job's `vehicle_number` snapshot exists precisely so that history stays truthful when the vehicle changes. Deletion has to be a soft delete or it rewrites the past.

**Returning `user_id` on `VehicleItem`.** Rejected. All three responses are already scoped to the caller by their token, so the field could only ever echo back the id of the account making the request. Omitting it keeps the response from being a place where an ownership bug could look like a feature.

## Consequence

The owner-facing path is complete end to end for the first time: register → add a vehicle → request help → get matched, with nothing inserted by hand at any point. `tests/integration/check_vehicle_registration.py` §8 drives exactly that sequence over HTTP and asserts the resulting offer against `job_assignments` — which is the first test in this project that a real user's first session could have produced.

The jobs endpoint's vehicle-ownership check is now exercised by real registered vehicles rather than a seeded row, including the cross-owner refusal.

Adarsh's owner app needs the three endpoints wired up; `HANDOFF-frontend-contract.md` §8 has the contract, and §2.6 — which listed vehicle registration among the endpoints that did not exist — is corrected. The client must send the registration number as typed and display the normalised form the response returns, rather than normalising locally: two implementations of that rule will drift, and the server's is the one the database agrees with.

`vehicle_number` is not unique. Anything that assumes otherwise — a join, a cache key, a lookup by plate — is wrong today, not merely fragile.

Verified by 38 unit tests (`tests/unit/test_vehicle_service.py`) and 54 live assertions against real Postgres and real Supabase tokens (`tests/integration/check_vehicle_registration.py`), run twice to confirm the cleanup restores the baseline.

---

# ADR-015: Two Reads of the Same Row — `FOR UPDATE` on the Mutating Job Paths, and Nothing on the Polled One

**Status:** Accepted
**Date:** 2026-09-23

## Decision

`app/repositories/job_repository.py` now exposes two ways to read a job by primary key, and which one a caller picks is a correctness decision rather than a preference:

1. **`get_job_by_id_for_update(db, job_id)`** — the same `SELECT` plus `.with_for_update()`, so Postgres takes a `FOR UPDATE` row lock that is held until the surrounding transaction ends. Used by exactly the callers that intend to write the row they just read: `job_service.transition_job_status()` (the partner lifecycle endpoint) and `job_service.cancel_job_by_owner()` — and, since the Resolved section below, `dispatch_service.respond_to_assignment()` and `dispatch_service._offer_next()`.

2. **`get_job_by_id(db, job_id)`** — unchanged, and deliberately still lock-free. It serves `GET /jobs/{job_id}` and everything else that only reads.

The locking read also carries `.execution_options(populate_existing=True)`. No caller needs it today; it is there because the failure it prevents is invisible. If the job were already in the session's identity map, SQLAlchemy would take the row lock and then hand back the *stale* in-memory object — the query ran, the lock is held, the code looks right, and the status the legality check reads is the one from before the winning transaction committed. That is the original bug wearing the fix's clothes.

Both mutating paths take the job row lock as the first statement of their transaction, before touching `job_assignments`. The two dispatch paths added later keep that same `jobs` → `job_assignments` ordering, though `_offer_next()` takes its lock after a Redis round trip rather than first — for a reason given in the Resolved section.

**Amended 2026-09-25: the order is now `jobs` → `partners` → `job_assignments`.** A third table joined it when the concurrency cap gained a second enforcement point — `dispatch_repository.lock_partner_for_update()`, taken inside the accept path between the job lock and the assignment write. The reasoning for that lock belongs to the decision that needed it and is recorded in the ADR-009 amendment; what belongs here is the order itself, because this is where a future caller will look it up. It was checkable in advance for once: `with_for_update()` existed in exactly one place in the codebase before the change, so nothing locked `partners` ahead of `jobs` and the new lock could only be inserted in the middle. Measured delta across the capacity harness: `pg_stat_database.deadlocks` 4 → 4.

## Context

ADR-013 named this as a known deferral: neither `POST /jobs/{job_id}/status` nor `POST /jobs/{job_id}/cancel` locked the job row, so a partner completing a job and its owner cancelling it at the same moment both read `in_progress`, both passed their own legality check, and both committed. The loser's write simply landed second. The observable result was a row that contradicted itself — `status = 'cancelled'` with a `price_final` and a `completed_at`, or `completed` with a `cancelled_at` — two terminal rows in `job_status_history`, and HTTP 200 returned to both callers, neither of whom had any way to know.

The sequencing was fixed before this was: close the race first, then load-test dispatch, so that a load test surfaces known-and-already-fixed behaviour instead of producing a fresh mystery under concurrency.

## Rationale

**The window was never the write. It was the decision in front of it.** This is the part that is easy to get wrong in the retelling. The trailing `UPDATE` always took a row lock — Postgres gives every `UPDATE` an exclusive lock on the rows it touches, and it always did. Nothing about the pre-fix code let two writes to the same row proceed simultaneously; they queued, politely, one after the other. The defect was that each transaction evaluated "is `in_progress → completed` legal?" *outside* any lock, got "yes", and only then queued up to write. Both answers were correct at the moment they were computed and one of them was stale by the time it was acted on. Moving the read under `FOR UPDATE` does not add a lock to the write; it extends the write's lock backwards to cover the decision, so the check and the write become one indivisible step.

**Why the loser gets an honest 409 rather than an error or an overwrite.** When the second transaction's `FOR UPDATE` blocks and is then granted, it does not resume with the snapshot it started with. Under READ COMMITTED, Postgres re-reads the latest committed version of the row before locking it (the EvalPlanQual path). So the second request genuinely sees `completed`, its existing check fires, and it returns the 409 it would have returned had the two requests arrived a second apart — `JOB_ALREADY_TERMINAL` when the owner loses, `INVALID_STATUS_TRANSITION` when the partner does. No new error code, no new branch, no retry logic: the fix makes an already-correct check see the truth.

**That behaviour is isolation-level-specific, so it is asserted, not assumed.** Under REPEATABLE READ or SERIALIZABLE the same statement does not re-read — it aborts with a serialization failure (`40001`). These two endpoints have no retry wrapper, so the loser would get a 500 instead of a 409, and the symptom would be indistinguishable from a bug. The application never sets an isolation level, so it inherits the Postgres default of READ COMMITTED; `check_job_race.py` queries `transaction_isolation` through the application's *own* engine and asserts `read committed`, so a future `isolation_level=` added to `create_async_engine()` for some unrelated reason fails here loudly rather than quietly converting a 409 into a 500.

**Both sides, or neither.** One endpoint locking alone buys nothing at all — the unlocked side still reads a stale status and still writes. This is why the fix is two call sites and why the unit fixtures for *both* endpoints enforce it.

**Consistent lock ordering, which is what keeps it from being a deadlock instead.** Both paths lock the job row first and reach `job_assignments` second. Had one endpoint locked the assignment first, two simultaneous requests would each hold what the other wanted, and the lost update would have been traded for a deadlock — arguably worse, because Postgres resolves it by aborting one transaction with `40P01` and the client sees a 500. That is not a hypothetical: one path *did* order them the other way and the deadlock was real, measured, and fixed the same day. See Resolved, below.

**The polled read is the reason this is two functions and not one clause.** `GET /jobs/{job_id}` is called every few seconds, for the entire life of a job, by every tracking screen watching it. Adding `FOR UPDATE` there would be invisible to every test that checks status codes and bodies, and would make each poll queue behind every mutation of that job and vice versa — so the customer's map would freeze for exactly as long as the mechanic's status update took, and a slow update would stall a fleet of polls. Postgres' MVCC means a plain `SELECT` never waits on a row lock, so keeping this read unchanged keeps it free. The harness proves this rather than asserting it: with a `FOR UPDATE` held on the row from a connection outside the application, three concurrent polls answered 200 in 534ms worst case (against 480ms unlocked) while a mutating request on the same row could not get through in 2000ms.

That timing comparison is only worth anything if the lock was really held, so a third connection probes it with `FOR UPDATE NOWAIT` and requires `LockNotAvailable`. Without that probe, "the GET came back instantly" would also be exactly what you would see if the test had stopped locking anything.

**Evidence, and why a green concurrency test is not evidence.** `tests/integration/check_job_race.py` drives six independent jobs to `in_progress` — the only status where both a completion and an owner cancellation are legal, per ADR-012's transition table — and fires the two requests at each with `asyncio.gather()`. Sequential calls cannot reproduce this defect *even with the bug present*, because the first request has committed by the time the second reads; that is precisely why five green integration harnesses had been living alongside it.

So the harness was run against the broken code on purpose. With only the two call sites reverted to the non-locking read: **23 of 43 assertions passed**, the defect reproducing in 5 of 6 trials, each leaving `status = 'cancelled'` with `price_final = 450.00` and a non-null `completed_at`, two terminal history rows, and HTTP 200 on both requests. With the fix in place: **43 of 43**, winner split 4 completed / 2 cancelled, so both 409 paths were exercised live rather than one being inferred from the other.

The sharpest assertion is not the status codes. Counting 409s does catch this bug, since it returned 200 twice — but the unambiguous fingerprint is a job row that claims both that the mechanic finished and charged for the work and that the customer called it off, and that is the assertion written to fail loudest.

Two of the harness's six sections pass even against the unfixed code, and the module docstring says so. Section 4 ("the mutation waits for the lock") was never testing the broken part, for the reason above: the `UPDATE` always locked. Leaving it in is useful — it is how the lock is shown to exist at all — but recording it as proof of the fix would have been a false claim about the test's own power.

**`tests/unit/test_job_repository_locking.py` pins the clause in both directions** by compiling both statements against the Postgres dialect, so it needs no database and runs in milliseconds. It asserts `FOR UPDATE` present on the locking read and absent on the polled one, and separately rejects the three near-misses: `FOR SHARE` (two transactions can hold a share lock, so both would pass the check and both would write — the original bug with a lock in front of it for reassurance), `SKIP LOCKED` (right for a queue worker claiming any free item, wrong here, where the row is not interchangeable and "someone else is mid-write" must become a 409 and never a spurious 404), and `NOWAIT` (turns an ordinary double-tap into a 500 instead of a ~millisecond wait). It also asserts that stripping `FOR UPDATE` from the locking statement yields the polled one exactly, so the two can never drift into fetching different rows.

**The old call is now a tripwire, not a stub.** In `test_job_cancellation.py` and `test_job_lifecycle.py`, the fixtures stub `get_job_by_id_for_update` and replace `get_job_by_id` with a function that raises `AssertionError` naming this ADR. A future edit that swaps back to the non-locking read — which is a plausible edit, because it looks like a harmless simplification and every response body stays identical — now fails across roughly 28 tests at once instead of silently reopening the lost update.

## Alternatives considered

**An optimistic `version` column with `UPDATE … WHERE version = :seen`.** Rejected, though it is the better answer at a different scale. It takes no locks and would leave the polled read untouched by construction, but it needs a schema migration on a shipped table, a re-read-and-retry loop in both services, and a decision about what to do when the retry also loses. It buys throughput under contention that does not exist here: two people acting on the same job in the same instant is a rare event, and the lock is held for a single-digit number of milliseconds. Paying migration and retry complexity to avoid a lock nobody is queuing for is the wrong trade today. Worth revisiting if job mutation ever becomes a hot path.

**`SELECT … FOR UPDATE` on both endpoints via a single read used everywhere.** Rejected — this is the version that looks simplest and is the actual hazard, since it silently converts the most-called endpoint in the system into a lock-taking one. The whole decision here is the split.

**`SERIALIZABLE` (or `REPEATABLE READ`) on the two endpoints' transactions.** Rejected: it would also close the race, by aborting the loser with `40001`, but the correct handling of `40001` is to retry, and a retry loop is more code in more places than one clause in one repository function. It would also convert the loser's clean 409 into either a 500 or a retried request that then produces the 409 anyway — the same outcome, later, through more machinery.

**A Postgres advisory lock keyed on the job id.** Rejected: it is the tool for coordinating things that are not rows, and the thing being coordinated here is a row. `FOR UPDATE` is released by transaction end automatically; an advisory lock outlives the transaction unless explicitly released, so a path that raised before its release would hold the lock for the life of the connection — and the connection is pooled, so the next request to borrow it would inherit the problem.

**Serialising in the application — a per-job `asyncio.Lock`, or Redis.** Rejected: an in-process lock is correct only while there is exactly one process, and the deployment target is multiple uvicorn workers. Redis would work across processes but puts the correctness of a database write behind the availability of a cache, which inverts the dependency: a Redis blip would then mean either a refused cancellation or an unprotected one.

## Consequence

The two 409s were always in the contract; they are now actually enforceable under simultaneous action rather than racing past each other. No request or response shape changed, no new error code exists, and no client needs to be updated to *work* — but a client that treated a 409 on cancel or status as a hard error state will now show it to a real user occasionally, so `HANDOFF-frontend-contract.md` records that the right response is to refresh the job and show its true state.

`GET /jobs/{job_id}` is unchanged and measured to be unchanged. Any future caller that reads a job intending to write it must use `get_job_by_id_for_update()`; the repository docstrings say so at both functions, since "which read did you use" is not a question a reviewer will think to ask.

Verified by 6 unit tests on the emitted SQL (`tests/unit/test_job_repository_locking.py`), tripwires in the two endpoints' existing unit fixtures, a full unit suite at 158 passing, and 43 live assertions against real Postgres (`tests/integration/check_job_race.py`) — the latter first shown to fail at 23/43 against the unfixed code.

**Resolved 2026-09-23 — the third race, in dispatch, plus a deadlock nobody predicted.** This section previously recorded `dispatch_service.respond_to_assignment()` as a known gap of the same class: it read the job through the non-locking `get_job_by_id()` and then `_accept()` wrote both the assignment and the job, so an owner cancelling while a partner accepted could resurrect a cancelled job as `assigned` and re-commit a mechanic to work the customer had called off. It is closed. What follows is the record, in the same form as the fix above it.

Two changes in `app/services/dispatch_service.py`:

1. **`respond_to_assignment()` reads the job through `get_job_by_id_for_update()`, and checks `job.status != 'matching'` *after* that call returns rather than before.** `'matching'` is the only status an answerable offer can coexist with — `dispatch_job()` requires `'requested'`, commits the move to `'matching'`, and only then creates the offer; the job stays `'matching'` through an entire rejection chain — so anything else means the job moved underneath a live offer. Both branches take the lock, not only the accept: a rejection writes the job's history and can re-dispatch, so it has the same interest in the job not vanishing mid-flight.

2. **A second exposure in the same endpoint, found while fixing the first and outside the task's letter.** `_reject()` commits — and so releases the lock — before calling `_offer_next()`, deliberately, so that a failing candidate search cannot lose the partner's recorded "no". That commit reopens exactly the window this ADR is about: an owner cancelling inside it would get a fresh `'offered'` row written against a cancelled job, or `no_match_found` written over `cancelled`. `_offer_next()` now re-reads the job under `FOR UPDATE` and abandons the re-dispatch if it has left `'matching'`, logging `matching_abandoned` — abandoning is the right answer rather than an error, since the rejection is already committed and correct and there is simply no longer a job to re-offer. The lock goes *after* the Redis candidate search and immediately before the writes, not at the top of the function, because holding a Postgres row lock across a network call to another service is how one slow dependency becomes a queue of blocked writers. That is the same reasoning that keeps `dispatch_job()` unlocked entirely: it is the only path that reaches Redis *between* reading the job and writing it, and also the one path with nothing to lose, since it requires `'requested'`, a status no other endpoint can leave a job in. Here the `populate_existing=True` above is load-bearing rather than defensive — the job is already in the session's identity map from the outer read, so without it the re-read would return the stale object and the whole check would be theatre.

This second one was not theoretical. Reverted, it produced a job at `status = 'no_match_found'` whose history read `requested → matching → no_match_found → cancelled`: a cancellation overwritten by a matching attempt that had already been told to stop.

**The loser gets `409 ASSIGNMENT_ALREADY_ANSWERED`, not `JOB_ALREADY_TERMINAL`, and that is a choice.** Whichever path moved the job also closed this assignment, so by the time the partner re-reads their offer list the row will not say `'offered'` either. Returning a different code purely because our `SELECT` landed a few milliseconds before their `UPDATE` would make the client's error handling depend on timing. It is also honest: the offer has been answered, by the job going away.

**The pre-existing `assignment.status != 'offered'` guard was never wrong — it was incomplete — and it still comes first.** Owner cancellation closes every open assignment it finds (`OPEN_ASSIGNMENT_STATUSES = ('offered','accepted')`), so the *sequential* cancel-then-accept case was already caught, and still answers on the assignment's own status before the job is read at all. That ordering is asserted rather than left to inspection: four settled assignment statuses and a stranger's 403 each refuse with no locking read taken, because taking a job row lock for what is usually a double tap is wasted contention.

**"Exactly one wins" needed reframing before it could be asserted.** The task asked for confirmation that either the job ends `'cancelled'` with its assignment `'cancelled'`, or it ends `'assigned'` with the cancel refused. The second branch cannot occur, and should not: `'assigned'` is not terminal, and `ALLOWED_TRANSITIONS` carries `assigned → cancelled` on purpose, because a driver is allowed to change their mind after a mechanic has accepted. So the owner's cancel is always a 200 and the final status is always `'cancelled'`; the two correct outcomes differ only in ordering — **(A)** cancel commits first, the accept is refused 409, timeline `requested → matching → cancelled`; **(B)** the accept commits first, both requests get 200, timeline `requested → matching → assigned → cancelled`. Status codes therefore cannot discriminate the fix from the bug, because outcome B is two 200s and so was the bug. The invariant the harness asserts instead is **a committed cancellation is never overwritten**, read off the job row and the history chain rather than the response codes.

**The lock-ordering claim was checked rather than asserted, and checking it found a second defect.** All three paths that now lock a job — `transition_job_status`, `cancel_job_by_owner`, `respond_to_assignment` — order **`jobs` → `job_assignments`**, and none of them holds one row lock while acquiring another, so the structural argument says no cycle can exist. The harness measures it anyway, as the delta in `pg_stat_database.deadlocks` for the current database across the race trials. Post-fix: **0 → 0**.

Pre-fix: **0 → 4**, with four of six trials dying on `MissingGreenlet("greenlet_spawn has not been called…")` — asyncpg connections killed mid-statement by Postgres' deadlock detector, surfacing through SQLAlchemy's async layer as a greenlet error rather than a clean `DeadlockDetected`. The cause is precisely the ordering the Rationale above warns about, and the *first* fix is what introduced it: the pre-fix accept path updated `job_assignments` first (`mark_assignment_accepted`) and `jobs` second (`set_job_status`), while `cancel_job_by_owner` — once this ADR gave it `FOR UPDATE` on `jobs` — locks `jobs` first and reaches assignments second. Opposite order, real cycle. So for one day the accept-vs-cancel race could surface as a **500 to a real user**, not only as a self-contradictory row, and closing the race removed that as a side effect by bringing the accept into the same order. The measurement is evidence, not proof — the proof is the ordering argument; a nonzero delta would refute it. The lesson generalises past this ADR: a fix that adds a lock changes the lock order of every path that touches the same rows, and the paths it breaks are the ones it did not edit.

**Evidence.** 17 unit tests (`tests/unit/test_dispatch_locking.py`), using the same tripwire technique — `get_job_by_id` is replaced by a function that raises `AssertionError` naming this ADR, so a future revert fails with a sentence instead of passing quietly. Reverted, **12 of 17 fail**; the 5 survivors are exactly the assignment-guard and ownership tests, whose behaviour deliberately did not change, which is itself the check that the new tests test the new thing. Live: **69 of 69** assertions in `tests/integration/check_dispatch_race.py` against **37 of 45** reverted. The `asyncio.gather()` race split 5 cancel-first / 1 accept-first across six trials, so both orderings were observed rather than one inferred from the other; a separate section reproduces outcome A with no timing luck at all by holding the job row from an outside connection, firing the accept so that it queues on the lock instead of deciding, then cancelling and committing inside the holding transaction. That section leaves the assignment `'offered'` on purpose, so that a pass isolates the new post-lock job-status check and cannot be credited to the assignment guard.

Full regression after the change: **175 unit tests** and **443 live assertions** across nine harnesses, baseline restored.

**Amendment 2026-09-27 — a third polled read, and why it takes no lock either.** `GET /api/v1/partners/me/offers` (`dispatch_repository.get_open_offers_for_partner`) is the second endpoint in the system polled on a timer, and it falls on the same side of this split as `GET /jobs/{job_id}`: no `FOR UPDATE`, no transaction, no `commit()`. The reasoning is the one above, sharpened by what this particular read is *for* — it exists to produce accepts, and the accept path locks the job row. A lock here would make every idle partner app queue against the very writes the list is trying to cause. A unit test compiles the emitted SQL and asserts `for update` does not appear in it, and a second asserts the service never calls `commit()` or `rollback()`, so the two halves of the split are now each pinned by a test rather than by a docstring.

The consequence is one a client has to be told about, and it is recorded in `HANDOFF-frontend-contract.md`: because the list is a snapshot taken without a lock, an offer can be answered — by this partner on another device, by the owner cancelling, or by the offer being reassigned — between the read and the tap. `409 ASSIGNMENT_ALREADY_ANSWERED` on a freshly-listed `assignment_id` is therefore **ordinary traffic, not an error state**, and the correct handling is to re-read the list. A filter cannot fix this and should not be attempted: any predicate evaluated at read time is a guess about the state at write time, which is the whole reason the guard lives under the lock.

**Capacity is deliberately not one of the list's filters, for the same reason.** A partner at `MAX_CONCURRENT_JOBS` still sees their outstanding offers. Hiding them would look kinder and be worse: the cap is enforced in `_require_capacity` under the job lock (ADR-008 counts load through `jobs.status`, which is live data that moves independently of this list), so a hidden offer would still be answerable by a partner who completed a job a second later, while a shown-then-refused offer produces a `409 PARTNER_AT_CAPACITY` the mechanic can actually understand. An offer the app never displayed cannot be explained to the person holding the phone.

---

# ADR-016: A Dispatch Outage Shares a Status With "Nobody Available", and Stays Distinguishable in the Timeline

**Status:** Accepted
**Date:** 2026-09-25

## Decision

When the partner location store cannot be reached, dispatch no longer leaves the job where it was. Three pieces:

1. `find_candidates()` raises **`DispatchUnavailableError`** — a new Python *type*, a subclass of `InternalError`, with a deliberately unchanged wire contract (500, `INTERNAL_ERROR`, same message).
2. `job_service._try_dispatch()` catches that type specifically, separately from its existing catch-all, and calls `dispatch_service.mark_dispatch_unavailable()`.
3. That function moves the job to **`no_match_found`** — the same status as "we searched and nobody was eligible" — with a `job_status_history` note fixed by the constant `DISPATCH_UNAVAILABLE_NOTE`: `"Dispatch unavailable: could not reach the partner location service"`.

No new job status, no new error code, no migration, and no synchronous retry.

## Context

`POST /jobs` triggers dispatch inside a guard, on the principle that a dispatch fault must never fail a job creation that genuinely succeeded — the job exists, it is durable, and returning a 500 would tell a stranded driver their request failed while inviting a retry that creates a second job for one breakdown. That principle is not in question and did not change.

What the guard also did was leave the status alone, and for most faults that is right: `'requested'` is the honest description of a job nobody has been asked about yet. It is wrong for exactly one fault — the one where *nothing will ever look again*. There is no background worker in this system (deliberately deferred), so a job left in `'requested'` by a Redis timeout has no path out of it. The driver's app shows a live request card. Nothing in the timeline says otherwise. Nobody is coming.

The 2026-09-24 dispatch load test produced these at **0.08%** of creations — 5 jobs out of roughly 6,000. Low frequency, and the worst failure mode this particular product has: a stranded customer with no assignment, no signal, and no retry path.

## Rationale

**Why an exception type and not a return value.** `find_candidates()` already has a meaningful empty answer — no eligible partners — and that answer is correctly handled as `no_match_found` today. Overloading it to also mean "the search did not run" would put the distinction in a flag that every caller has to remember to check, which is the shape of bug that gets reintroduced. As a type, it is impossible to catch by accident and impossible to ignore: `_try_dispatch`'s `except DispatchUnavailableError` sits above its `except Exception`, and anything that is not this specific fault still takes the old path.

**Why it is an `InternalError` subclass with an identical response.** A client's remedy does not change, so the contract must not. The type exists to let one internal caller tell three situations apart — "we could not look", "we looked and nobody was there", "the database write failed" — that leave the job in three different places, only one of which is normal. Before it existed, the first was indistinguishable from the third inside a bare `except Exception`.

**Why `no_match_found` rather than a new status — the part that contradicts an earlier comment in this codebase.** `find_candidates()` carried a warning against exactly this conflation, and `_try_dispatch`'s docstring still says that marking a job `no_match_found` would confuse "we looked and there was nobody" with "we never got to look". That warning was about *silently* conflating them, and it stands. The resolution here is that the **status** is shared while the **cause** stays separable:

- From the driver's seat the two situations are identical. Nobody is coming, the request did not find help, and the action available is the same one: cancel, or ask again. A status is a description of the customer's situation, not a diagnosis of ours.
- `no_match_found` is already the one non-terminal dead end in the system. ADR-013 kept it out of `TERMINAL_JOB_STATUSES` precisely so an owner can still cancel or re-request from it, which is what makes it safe to route an infrastructure fault there. A genuinely terminal status would strand the driver a second way.
- The cause lives in `job_status_history.note`, which is the same mechanism ADR-013 already uses to carry a cancellation's actor. The note is a module constant rather than a literal because the reporting query matches on it:

```sql
SELECT count(*) FROM job_status_history
 WHERE status = 'no_match_found'
   AND note LIKE 'Dispatch unavailable:%';
```

That query is what keeps the evaluation honest: coverage and match-rate numbers can exclude the outages instead of quietly counting an infrastructure failure as a legitimate "no partners nearby". A single blended number would have been the actually misleading outcome.

**Why not a new status.** It was the first instinct and the blast radius decided it: a `jobs.status` CHECK-constraint migration on a shipped table, a new key in `ALLOWED_TRANSITIONS`, a terminality decision, matching work in the owner and partner clients, and a new value Adarsh's frontend must learn to render — all for a path that occurs in under one job in a thousand and whose correct handling is byte-for-byte what `no_match_found` already gets. If the evaluation ever needed to report on it as a first-class outcome the trade would change; the note-based split covers the reporting need at none of the cost.

**Why the recovery is itself guarded.** `mark_dispatch_unavailable()` is wrapped in its own `try`. Recovery from a failure must not become a second failure, and if the recording write also fails the job stays in `'requested'` — exactly where it was a moment earlier, so strictly no worse than before this ADR existed.

**Why nothing retries.** A retry inside the request would block the driver's POST on a dependency that has just timed out, paying the timeout twice to create one job. Whether the job is retried later is a background-worker question, and there is no background worker; when there is one, the natural sweep is over jobs in `'requested'` past some age, which this change does not obstruct. `mark_dispatch_unavailable()` re-reads the job under `FOR UPDATE` and does nothing if it has already left `'requested'`, so it cannot overwrite a dispatch that succeeded on a later path.

## Alternatives considered

**Leave it, and fix it when the background worker is built.** Rejected. The worker is deferred indefinitely, and "invisible until some future task" is the property that makes this the product's worst failure mode rather than a cosmetic gap.

**Fail the POST with a 503 so the client can retry.** Rejected, and it is the tempting one. It would be honest about the dependency, but it breaks the principle the guard exists for: the job *was* created, durably, before dispatch ran. A 503 after a successful write invites the client to create a duplicate job for the same breakdown, which turns one unmatched request into two.

**Retry dispatch inline with a short backoff.** Rejected: it converts a single timeout into a multiple of that timeout inside the driver's request, for a dependency that has already declined to answer once.

**A separate `dispatch_failed` column or flag alongside the status.** Rejected as a worse version of the note — a second field carrying the same information, which every query would then have to know to consult, and which no client would render.

## Consequence

A Redis outage during job creation is now visible in three places instead of none: the job's status, its timeline, and a `dispatch_after_create_failed` log event carrying `reason="location_store_unavailable"`. `POST /jobs` still returns 201 and still returns it promptly — measured at 782ms with the location store hard-timing-out on every call, against an 8s ceiling in the harness.

Owners will occasionally see a job go straight to `no_match_found` seconds after creation with no offers ever made. That is correct and was already possible (an empty candidate set does the same), so no client change is required; `HANDOFF-frontend-contract.md` notes that a `no_match_found` job with zero assignments is a legitimate state to render.

The evaluation write-up must split the two causes using the query above rather than reporting a single `no_match_found` count.

**Evidence.** 6 unit tests in `tests/unit/test_dispatch_capacity.py` covering the branch selection — that `DispatchUnavailableError` is recorded, that every other exception is not, that a success records nothing, that a failure *while* recording still does not fail the POST, and that nothing retries. Live: `tests/integration/check_dispatch_capacity.py` §8 injects the outage at the Redis client that `find_candidates()` fetches, so the real `except RedisError` handler and the real exception are exercised rather than a mock one level higher. Reverted (with `job_service.DispatchUnavailableError` rebound so the specific catch never matches, which is precisely the pre-fix path): the job stays `'requested'`, the 201 body reports `'requested'`, and the timeline is empty of any explanation — the three assertions that now pass.

---

# ADR-017: An Offer Carries No Way to Reach the Customer — Contact Release is Keyed to Assignment, Not to Role

**Status:** Accepted
**Date:** 2026-09-27

## Decision

`GET /api/v1/partners/me/offers` returns, for each outstanding offer, the `assignment_id`, the offer's own frozen facts (distance at offer, ETA, rank, timestamp) and a nested job object containing the service, the vehicle number, the human pickup address string, the issue description, the price estimate and the request time.

It deliberately does **not** contain the owner's `user_id`, their name, their phone number, or the pickup coordinates. The mechanic learns none of those by being offered the job; they learn them by accepting it, from `GET /api/v1/jobs/{job_id}`, which already gates contact details on `may_see_contact_details = is_owner or is_assigned_partner`.

The rule this generalises: **contact release follows the assignment, not the role.** "Partner" is not a permission to see a customer. The permission is "partner who has taken responsibility for *this* job".

## Context

Until this endpoint, the partner side of the API had no GET route at all. A partner could be offered a job by the dispatch engine and had no way to discover the `assignment_id` that `POST /job-assignments/{assignment_id}/respond` requires — the load-test harness worked around it by reading ids out of Postgres, which a phone cannot do. This endpoint is that missing read, and it is the first time the system has had to answer "what may a mechanic see about a customer *before* agreeing to help them?"

The question is not academic. An offer is made by the engine to whoever scores best; the partner has done nothing to earn it and may well decline. The rejection path is a normal, frequent outcome — `_reject()` exists, re-dispatches, and is exercised in the race harness. So any field in this payload is a field handed to a mechanic who may say no and walk away with it, and by design the same job is then offered onward to the next candidate, who gets the same payload. A phone number in this response is a phone number distributed to every partner the engine considered.

There was a real pull the other way, which is why this needed deciding rather than assuming. A mechanic deciding whether to accept genuinely wants to know where they are going, and "coordinates plus the customer's number" is the obvious way to let them judge and call ahead. The pilot's partner base is small and known; the tempting argument is that these are trusted contractors.

## Rationale

**The precedent already existed and was found rather than invented.** `job_service` (around lines 348–416) computes `may_see_contact_details` as `is_owner or is_assigned_partner`, and when it redacts, it withholds even `partner_id` — the comment there notes that on its own it is only an opaque uuid, but it is the lookup key for every partner-scoped read in the API. An *offered* partner is not an *assigned* partner. Reading the existing rule literally answers this endpoint's question without a new policy, and inventing a second, looser policy for the same data one endpoint over is how a codebase ends up with two contradictory privacy rules and no way to say which is authoritative.

**`pickup_address_text` is enough to decide with, and is categorically different from a coordinate.** "Outer Ring Rd, near Marathahalli bridge" tells a mechanic which side of the city the job is on and whether to take it. A lat/lng to six decimal places is a person's position to within a few metres, which is what is needed to *arrive*, not to *choose*. The distance the engine measured at offer time is on the offer itself (`distance_at_offer_m`), so the trip length is answered without the point. That split — a description to decide, a coordinate to navigate — is the whole of the decision in one line.

**The trusted-contractor argument fails on the timeline, not on trust.** The partner base is small now; the data handling has to be defensible for the base the platform is built for. And the cost of getting it wrong is asymmetric in a way that does not recover: a rescinded permission un-shows a screen, but a phone number that has been on a stranger's device cannot be recalled. Withholding it until acceptance costs a mechanic one extra read after they have already committed to the job.

**It also keeps the offer payload honest about what it is.** An offer is a question. If answering "no" costs the customer their phone number, then the question was never really a question.

## Alternatives considered

**Include the coordinates but not the phone number.** Rejected, and this was the closest call. It reads as a reasonable middle — but a precise pickup point is identifying on its own: it is very often a home address, and combined with the vehicle number (which *is* in this payload, and which maps to a person through a public register) it is arguably more identifying than a phone number, not less. The vehicle number stays because a mechanic must be able to recognise the car on arrival and there is no substitute for it; the coordinate has a substitute, which is the address string.

**Include the owner's first name.** Rejected as unnecessary rather than dangerous. Nothing in the accept/decline decision depends on the customer's name, and it would put the endpoint in the business of returning identity fields "because they're harmless", which is the disposition this ADR exists to prevent.

**Reuse `JobDetailResponse` with its existing redaction and skip the new schemas.** Rejected. It would work, and it would make the privacy rule conditional on a flag computed at runtime — so the guarantee would hold only as long as nobody passed the wrong actor into that computation. `PartnerOfferJob` cannot leak an owner's phone number because it has no field for one. A shape that cannot express the mistake is stronger than a branch that avoids it, and it also stops this endpoint from inheriting every future addition to the owner's view by default.

**Flatten the job's fields into the offer.** Rejected for a non-privacy reason, recorded here because the nesting is visible in the contract: the offer's fields are frozen at offer time and never change, while the job's keep moving. Nesting keeps "what was offered to me" and "what the job is" visibly separate, so a client re-rendering on job movement does not invite the assumption that the distance was recomputed too.

## Consequence

A partner app cannot show a "call the customer" button, or a map pin, on an offer card. It shows the address line, the distance and the ETA, and both of the withheld things appear once the offer is accepted. `HANDOFF-frontend-contract.md` §10 records the shipped shape and names this explicitly, so it is not discovered as a missing field mid-build.

The list's filter — assignment `'offered'` **and** job `'matching'` — is the same predicate `respond_to_assignment` enforces under the job lock (ADR-015). Two copies of one rule in two modules is a drift risk, so `dispatch_repository.OFFER_ANSWERABLE_JOB_STATUS` and `dispatch_service.STATUS_MATCHING` are asserted equal by a unit test; if someone changes one, that test names the other.

**Evidence.** 8 unit tests (`tests/unit/test_partner_offers.py`), including one that asserts the two schemas' field names do not intersect a forbidden set (`owner_phone`, `pickup_latitude`, `pickup_location`, …) and one that compiles the statement and reads the `WHERE` clause. Failing-first was done by mutation, since this is a new feature with no buggy predecessor to revert: three deliberate mutations (widen the schema, break the shared constant, drop a predicate) produced exactly the three expected failures — 3 failed, 5 passed — and the originals were restored from `.bak`.

Live: **28 of 28** assertions in `tests/integration/check_partner_offers.py` against real Postgres and real Supabase tokens. The privacy section asserts against the owner's actual phone number and the job's actual coordinates read out of the database, not against a list of field names, so a field nobody thought to forbid still fails it. One section is worth naming: it puts an `'offered'` assignment row onto a `'cancelled'` job by hand — the remnant a lost cancel-vs-accept race leaves behind — and asserts the list hides it, which is the `jobs.status` half of the filter, and the half that stops a mechanic being sent to a job the customer already called off. Another takes the `assignment_id` from the HTTP response and answers the offer with it, never touching Postgres, because that round trip is the entire reason the endpoint exists.

The control run (`--reverted`) removes the route from the router before the app is built — literally the state of the repository before this task — and scores **9 of 28**. Four of those nine passes are vacuous under the control (a 404 body trivially contains no phone number); they are meaningful only because the positive assertion in the same section fails. Noted rather than counted as coverage.

Full regression: **205 unit tests** (197 + 8) and **520 live assertions** across eleven harnesses, database returned to baseline.

*(Figure corrected 2026-09-29. This line originally read 492, which was the ten-harness total from before this task; when `check_partner_offers` and its 28 assertions were appended to the per-harness list the headline total was not recomputed. The eleven harnesses named here sum to 520. The current figure is 564 across twelve — see ADR-018.)*

---

# ADR-018: The Stored Partner Rating is Maintained by the Service and Recomputed From Source — the Trigger That Was Meant To Do It Could Never Have Fired Correctly

**Status:** Accepted
**Date:** 2026-09-29

## Decision

Ratings are written through `POST /api/v1/jobs/{job_id}/ratings`, one row per side per job, with the direction (`rated_by`) taken from the verified token and never from the body.

`partners.rating_avg` and `partners.rating_count` are maintained by `rating_service.submit_rating`, in the same transaction as the rating insert, by **recomputing both values from the `ratings` table** — not by incrementing them. The recompute resolves "which partner does this job's rating belong to" by importing `job_repository.RESPONSIBLE_ASSIGNMENT_STATUSES`, the same tuple ADR-012 defined for that question everywhere else. The partner row is locked `FOR UPDATE` before the insert when, and only when, there is an aggregate to update.

The Postgres trigger `trg_update_partner_rating` and its function `update_partner_rating()` are **dropped** (`db/migrations/004_drop_rating_trigger.sql`); the block in `db/schema.sql` is replaced by a pointer to this ADR.

Two core principles are deliberately departed from here, both flagged in the code and argued below: **principle 1** (derived data is never stored) and **principle 7** (concurrency-sensitive mutations take the locking read).

## Context

ADR-009's matching score has four weighted inputs. `rating_score` is one of them at `W_RATING = 0.2`, and it reads exactly these two columns, Bayesian-smoothed against `PRIOR_MEAN = 3.5` with `PRIOR_WEIGHT = 5.0`, falling back to `UNRATED_PARTNER_RATING_SCORE = 0.7` when `rating_count` is zero.

Nothing in the system could write those columns. `rating_count` was therefore zero for every partner, permanently, so every candidate scored an identical 0.7 on that dimension and ranking was decided entirely by distance, load and skill. A fifth of the dispatch algorithm was a constant, and nothing anywhere said so — not a log line, not a test, not a comment. That is the reason this task was pulled ahead of the rest of the backlog: the gap was not in the ratings feature, it was in the engine.

A trigger existed in `schema.sql` and looked like the answer, which is most of why the gap went unnoticed.

## Rationale

**The trigger's resolution rule was impossible, not merely fragile.** It found the rated partner through `job_assignments.status = 'accepted'`. But `TERMINAL_ASSIGNMENT_STATUS` in `job_service` maps `"completed" → "completed"`: the act that makes a job rateable is the same act that moves its assignment out of `'accepted'`. The subquery was guaranteed to be empty at the only moment the trigger could legally fire. Its `UPDATE` matched zero rows and reported success — no error, no warning, no row count anyone reads. A trigger that silently does nothing is worse than a missing trigger, because the missing one gets noticed.

This is measured, not reasoned. A probe inserted ratings against a genuinely completed job with the trigger still installed and the columns did not move; and the live harness's `--reverted` arm is a faithful port of the trigger's own predicate, which fails every aggregate assertion with `('0.0', 0)`.

**It was also a second copy of ADR-012's rule, written in a different language.** `RESPONSIBLE_ASSIGNMENT_STATUSES = ("accepted", "completed", "cancelled")` is the single definition of whose job a job is. The trigger restated a narrower version of it in PL/pgSQL and drifted the instant the lifecycle grew a terminal assignment status — which it did, in the same task that made completion possible. The service version *imports* the tuple, so the next status added to it is picked up without anyone having to remember that an aggregate depends on it. The bug was not the predicate being wrong; it was the predicate being duplicated at all.

**Service rather than trigger, as a general matter.** The transaction boundary, the lock ordering, the structured log line that reports the new aggregate, and the seam the tests substitute at all live in Python. A trigger is invisible to the layering contract, cannot be unit tested alongside the rule it implements, and fires inside a transaction it did not open and does not know the shape of.

**Recompute, not increment.** Two arguments, and the weaker one is the one usually given first. The *primary* argument is self-healing: a recompute-from-source is correct after any event that changes the underlying rows — a rating deleted for abuse, a mis-set assignment repaired later, a job backfilled — with no backfill step and no reconciliation job. This is measured: §10 of the harness deletes one rating directly in Postgres, and the next rating written brings the aggregate to `('4.0', 2)`, matching the rows that actually exist. An incremental writer would report three ratings forever, and nothing would ever contradict it. The *secondary* argument is arithmetic: `rating_avg` is `NUMERIC(2, 1)`, so a recompute's error is bounded by a single rounding (±0.05) no matter how many ratings accumulate, whereas a read-modify-write reads back the rounded value and folds it forward as if it were exact, compounding. The cost is one aggregate query per rating submitted — on a human-paced path, not the dispatch path.

**The principle-1 exception, on the record.** `rating_avg` is stored derived data, which principle 1 exists to prevent. It is stored because `get_eligible_partners` reads it inside the dispatch SQL, for every candidate, on every job creation; an aggregate subquery there lands in the one code path that already holds a pooled connection for 1198 ms against 15 shared session-mode Supavisor connections. The contrast with `active_job_count`, which is computed live and must be, is the useful part: that value changes *without any write to the partner row* — some other job the partner never touched reaching a terminal status changes it — so there is no invalidation event to hang a column on. `rating_avg` has exactly one writer and exactly one invalidation event: a `ratings` row. One writer, one event, one place to get it wrong. That is the test to apply to any future candidate for this exception, and `active_job_count` still fails it.

**The partners row is locked; the jobs row deliberately is not.** Two owners rating two *different* jobs of the same mechanic share no job row, so nothing serialises them: both would recompute against a snapshot taken before the other's insert was visible, both would write the same count, and one rating would vanish from the aggregate while remaining in the table. The partner row is the only thing the two racers have in common, so that is where the lock goes, before the insert; under READ COMMITTED the recompute runs as a later statement and takes a fresh snapshot that includes whichever insert committed first. Same mechanism and same reasoning as the accept-time capacity check (ADR-015). Lock ordering `jobs → partners → job_assignments` is preserved by vacuity — this path takes the partners lock and no other. The partner→owner direction takes no lock, because there is no aggregate on that side; `UNIQUE (job_id, rated_by)` is the whole of its concurrency control and is sufficient.

**The principle-7 deviation.** The jobs row is read with `get_job_by_id`, not `get_job_by_id_for_update`. `'completed'` is terminal, so a read that sees it cannot stop being true, and a read that sees anything else yields a 409 that was truthful at the instant it was taken. Locking would place a write lock on the jobs row of every finished job for the duration of a rating and buy nothing. It is pinned by `test_jobs_row_is_read_without_a_lock`, which replaces `get_job_by_id_for_update` with a function that raises, so reintroducing the lock fails a test that names this ADR in its message.

**Duplicate submissions are refused by the constraint, not by a pre-check.** A `SELECT` before the `INSERT` lets two concurrent submits both past the check, and the second then fails at the database as a 500. Catching `IntegrityError` on `ratings_job_id_rated_by_key` turns the real race into the 409 it actually is — which is the case that matters, because the way this happens in the field is one person tapping submit twice on a bad connection.

## Alternatives considered

**Fix the trigger's subquery and keep it.** Widening `= 'accepted'` to the three responsible statuses would have worked, and this was the closest call by a distance. Rejected because it repairs the symptom and preserves the cause: two copies of one rule, one of them in a language the test suite cannot reach, with no import to hold them in step. The next terminal assignment status would break it again, silently, in exactly the same way.

**Store nothing and compute the aggregate inside the dispatch query.** The principle-1-pure option, and genuinely the more correct design. Rejected on the measured cost of the dispatch path above. Recorded deliberately: if the connection ceiling stops being the binding constraint — transaction-mode pooling, a read replica, a larger connection budget — this is the version to come back to, and the only thing standing in its way is a number that is expected to change.

**A background recompute over all partners on a schedule.** Rejected twice over: background workers are explicitly out of scope for this phase, and it would trade an exact number available for free at write time against a staleness window nobody asked for.

**Add `rating_avg` / `rating_count` to `users` for symmetry.** Rejected as building columns nothing reads — which is principle 1 in its plainest form. Recorded as a stated gap below instead.

**Treat a repeat submission as idempotent and return 200.** Rejected. A rating is a judgement, not a state to converge on: accepting the second one either overwrites the first without saying so or discards the second without saying so, and both are indistinguishable from a working submit button to the person pressing it.

## Consequence

ADR-009's rating dimension is live for the first time, so dispatch ranking now genuinely varies by reputation. Any dispatch ranking *produced by the application* before 2026-09-29 was computed with `rating_score` pinned at 0.7 for every candidate. The evaluation write-up must say so rather than comparing results across that line as though one algorithm produced both.

**Corrected 2026-09-30 — this consequence originally read "including the load-test figures", and that clause was false.** `tests/load/seed_dispatch_load.py` sets `rating_avg` and `rating_count` with a direct `UPDATE`, precisely because no endpoint existed to set them; its own comment says so. The load harness was therefore the one place in the system where this dimension *did* work, and it worked by bypassing the writer that was broken. Every matching-accuracy figure in `docs/load-test-dispatch-concurrency.md` §4 and §8.1 is a rating-live figure. Production was the rating-blind system; the harness never was. The distinction is not cosmetic: it means a plain re-run of the load test after this fix measures no change, and the question "what was this dimension worth" needed a controlled experiment instead of a re-run. That experiment was run on 2026-09-30 and is §4.2 of the load-test report — the rating-blind arm diverges from a pure-nearest baseline on **0.0 %** of decisions against **70.0 %** with real ratings, i.e. with this dimension dead the weighted engine was not merely degraded but provably identical to the naive baseline ADR-009 exists to beat, for every candidate set in which load and skill are constant.

**A stated gap.** The partner→owner direction is stored and returned but aggregated nowhere: `users` has no rating columns and nothing in dispatch reads an owner's reputation, so there is no truthful number to compute yet. The rows are kept because they are the evidence a later feature would be built from. This is recorded here rather than as a TODO in code, because a TODO would suggest someone is expected to remove it.

**A dormant schema asymmetry, named so it is not rediscovered as a hole.** `ratings.job_id` is nullable while `UNIQUE (job_id, rated_by)` treats NULLs as distinct, so unlimited job-less ratings per side could coexist. It is inert: the only writer is this endpoint, and it always supplies `job_id` from the path. Left unmigrated rather than fixed, because a `NOT NULL` migration on a live table is a larger change than the risk it removes.

**The principle-7 deviation above stays in this ADR** rather than getting one of its own, per the rule that a consequence of an existing decision extends that decision — the locking half of it belongs to ADR-015, which this cross-references.

**A bug in my own code, found by this task's own harness, kept in the record because the class of it generalises.** Both `except` blocks in `submit_rating` logged `str(job.id)` *after* `await db.rollback()`. `Session.rollback()` expires every object in the identity map unconditionally — unlike `commit()`, which `AsyncSessionLocal` opts out of with `expire_on_commit=False`. Reading an attribute off an expired object emits a lazy `SELECT`, and on an `AsyncSession` an implicit lazy load is not a slow query, it is a `MissingGreenlet`. The failure handler therefore raised out of itself, the `ConflictError` was never constructed, and a duplicate rating would have been served as a 500 instead of a 409 — a defect that exists only in the branch least likely to be tried by hand, and that no amount of happy-path testing can surface. Fixed by binding `job_uuid` and `job_status` out of the ORM object before the transaction opens. The rule is general and worth applying to every `except` block in this codebase that logs an ORM attribute after a rollback.

**Evidence.** 43 unit tests in `tests/unit/test_rating_service.py`. Failed-first was done by reverting exactly one line — `job_uuid` back to `job.id` in the `IntegrityError` handler — giving 1 failed, 42 passed, and failing with `sqlalchemy.exc.MissingGreenlet`, the same exception class the live run produced. The stub that makes that reproducible without an event loop, `ExpirableJob`, raises `MissingGreenlet` from `__getattr__` once `expire()` has been called, and `FakeSession.rollback()` calls it — so the test models the actual SQLAlchemy behaviour rather than asserting on a message. One test pins the exact repository call sequence (`get_job_by_id`, `get_responsible_assignment`, `lock_partner`, `create_rating_row`, `recompute`); one asserts the partner→owner direction never touches the partner aggregate; and one pair asserts that the same data fault — a completed job with no responsible assignment — is tolerated for an owner (stored, logged, no aggregate) and refused for a partner (403), which is the asymmetry the two roles' evidence actually justifies.

Live: **44 of 44** assertions in `tests/integration/check_ratings.py`, against real Postgres and real Supabase tokens, in QA phone namespace `+91900000099`. The control (`--reverted`) substitutes a faithful port of the dropped trigger's predicate for `recompute_partner_rating` and scores **38 of 44**, where the six failures are all and only the aggregate assertions and every one of them reads `('0.0', 0)` — precisely the behaviour that was live in this database until migration 004. The three decisive lines of the real arm: `('0.0', 0) → ('5.0', 1)` on the first rating, `('4.5', 2)` after a second, and `('4.0', 2)` after one rating is deleted directly in SQL, which is the self-healing property an incremental writer cannot produce.

Full regression: **248 unit tests** and **564 live assertions** across twelve harnesses, every harness exiting 0, database returned to baseline — 8 tables at documented counts, `ratings` at 0, trigger and function both absent.

---

# ADR-019: Notifications are written in the transaction that caused them, and address the party that did not act

**Status:** Accepted

**Date:** 2026-10-01

## Decision

In-app notifications, six parts, in the order they matter:

1. **A notification is written inside the same transaction as the status change that caused it.** No savepoint, no separate transaction, no best-effort `try/except: pass`. The repository stages the row with `db.add()` and deliberately does not flush, so the `INSERT` rides the caller's existing flush and commit. If the notification cannot be written, the status change does not happen either.
2. **The recipient is the party that did not act.** The owner cancels → the partners holding open assignments are told. A partner accepts, moves or cancels → the owner is told. The actor is never notified of their own action.
3. **`requested` and `matching` are silent.** Both are written to `job_status_history`, neither produces a notification.
4. **Message text contains no names, no phone numbers, no coordinates, no addresses, no prices and nothing copied from a request body.** Every message is one of eight fixed strings keyed by event.
5. **`event` is the contract; `message` is prose.** Clients branch on `event`, which is a closed vocabulary owned by one module-level table in `app/services/notification_service.py`. `message` may be reworded at any time.
6. **The feed is offset-paginated, ordered `sent_at DESC, id DESC`, and marking read is idempotent.** A second mark-read is `200` with `updated: 0`, not `409`. A notification belonging to another account returns `404 NOTIFICATION_NOT_FOUND` — the same status and the same code as one that never existed.

Four seams write notifications: the dispatch offer (`job_offered`, to the partner), the accept (`job_accepted`, to the owner), every partner-driven lifecycle transition, and the owner's cancellation. Nothing else notifies, and nothing is delivered anywhere — `channel` is `'in_app'` and the client polls.

## Context

The feature as specified is "job status change alerts", and the `notifications` table had existed since the original schema with zero rows and no writer. That combination made almost every decision here free to take and expensive to defer, which is why this ADR is longer than the feature is large.

The hard part is not the four read endpoints. It is that the writer is called from inside four other services' transactions, each of which already had a correctness story — ADR-015's row locks, principle 4's history rows, ADR-017's contact-release rules — and a notification is a *second* effect that has to fit inside each of those stories without weakening any of them.

## Rationale

**Same transaction (1).** The alternative everyone reaches for is to notify after the commit, so that a notification failure cannot fail the user's request. That trade is wrong here, and the reason is specific rather than aesthetic: the system has no retry, no outbox and no worker. A notification dropped after commit is dropped permanently and silently — the owner's job moves to `completed` and their feed never says so, and nothing anywhere records that a message was owed. Inside the transaction, the only possible failure is one that also rolls the status change back, which leaves the system in a state the client can see and retry. Given two choices, "the status change and the notification are both absent" is recoverable and "the status change happened and the notification is gone" is not.

This also makes the notification inherit, for free, every guarantee the surrounding transaction already bought: the `jobs` row lock from ADR-015 means two racing transitions cannot both notify, and the history row and the notification are either both present or both absent, so the feed can never disagree with `job_status_history`.

**The non-actor rule (2).** Stated as "notify the other party" rather than "notify the owner" because the two are indistinguishable in five of the six events and differ in exactly one. A partner accepting, progressing or cancelling all notify the owner; only the owner's own cancellation notifies the partner. So the naive version — the owner is the one who cares about their job — is right 5/6 of the time and wrong in the single case where a mechanic is driving to a job that no longer exists. That ratio is the reason the rule is written as a function of `actor_role` and the reason the live control run attacks precisely that branch (see Evidence).

**Silence on `requested` and `matching` (3).** Both statuses are written during `POST /jobs`, synchronously, before the response is returned. Notifying on them would mean the owner's feed gains two rows describing the request the client is still rendering the response to — a notification is for something that happened while you were not looking. Principle 4 is about the audit trail, not about mail, and this is where the two deliberately diverge.

**No PII in message text (4).** This is the one rule in the list that is a privacy decision rather than a correctness one. ADR-017 settled that contact details follow the assignment, not the role, and `GET /jobs/{id}` enforces that at read time. A notification message is a *stored string in a different table that nothing re-gates*. Anything baked into it at write time sits permanently outside ADR-017's gate and would still be sitting there if those rules were tightened. The safe version of a feature like that is one with nothing in it to leak, so the messages carry no identity at all and the client joins on `job_id` for anything it wants to display — through the endpoint that does the gating.

**`event` over `message` (5), and no CHECK constraint on it.** Exactly the split the error envelope already makes: `code` is what clients branch on, `message` is for humans (`app/schemas/common.py`). A client cannot pick an icon or a deep-link target by matching English, and matching English breaks the first time the wording improves. The column is left unconstrained in the database on the reasoning recorded in migration 005: the vocabulary grows with every feature that notifies, a CHECK means a migration per new kind, and the predictable result of that friction is somebody reusing an almost-right existing value — which corrupts the column's meaning far worse than an unconstrained string does. The vocabulary's integrity is enforced where it is cheap: one writer, one table, asserted by unit test and by a live assertion that no unknown value reached the column.

**Offset pagination and the tie-break (6).** Offset, not cursor, because the feed is small, bounded by one account's activity, and the client needs `total` for a "4 of 12" affordance that a cursor does not give. `sent_at DESC` alone is not a stable sort, and the instability is not theoretical: `now()` is transaction-start time, so an owner cancelling a job with two open offers writes two notifications whose `sent_at` are identical to the microsecond. Under an unstable sort, offset pagination does not merely reorder — page 1 and page 2 can show the same row twice and omit another entirely. `id DESC` is the tie-break; the live harness manufactures the tie in SQL and asserts the pages are disjoint and complete.

**`updated: 0` rather than 409 (6).** The client's intent — "this should be read" — holds whether or not the row was already read, so a retry of a request that succeeded is not a conflict. Returning 409 would make an idempotent retry, which is the normal consequence of a dropped response on a phone network, look like a failure the UI has to explain. The response reports what changed (`updated`) and the resulting badge, so a client that cares can tell the difference without being told it did something wrong.

**404, not 403, for somebody else's notification (6).** Principle 6, applied unchanged. The live harness asserts that marking another account's notification read and marking a random UUID read are indistinguishable: same status, same code.

## Alternatives considered

**Notify after commit, in a `try/except` that swallows.** Rejected for the reason above: with no outbox and no worker, every failure is silent and permanent. This becomes the right answer the day a delivery worker exists, because then "failed to notify" is a retryable state rather than a lost message — and the `channel` column already carries `'push'` and `'sms'` so that worker has somewhere to land.

**A `SAVEPOINT` around the notification write.** This is the sophisticated version of the same mistake. It would let the status change commit while the notification rolled back, which is exactly the unrecoverable half of the trade, and it adds a round trip to every status change to buy it.

**Notify both parties on every event.** Tempting because it deletes the `actor_role` parameter. Rejected because it makes every actor's feed a log of their own button presses, and because it does not actually simplify: the owner's cancellation would still need the partner list from the assignments, so the branch stays and only the rule gets vaguer.

**A CHECK constraint on `event`.** Covered in Rationale and migration 005. Rejected for the friction it creates, with the vocabulary enforced in the application instead.

**Cursor pagination.** Rejected: no `total`, and a cursor is for feeds that grow faster than they are read. This one does not.

**A `Literal` type for `event` in the response schema.** Rejected for the same reason as the CHECK — a schema change would gate every new notification kind — and recorded as a comment on `NotificationBase` so the omission reads as a decision rather than an oversight.

## Consequence

**Migration 005 made the table writable: five changes to a table with no rows.** `channel` gained `'in_app'` (its CHECK permitted only `'push'` and `'sms'`, neither of which exists anywhere in the system — writing `'push'` for a row nothing pushes is ADR-018's dropped-trigger defect again, a stored value asserting a behaviour that does not happen). `recipient_type`, `recipient_id` and `channel` became `NOT NULL`, because both CHECKs pass on `NULL` and the table as shipped would have accepted a notification addressed to nobody — a row invisible to every query the endpoints can issue, written and stored and never delivered or reported. A composite index on `(recipient_type, recipient_id, sent_at DESC)` serves both the filter and the ordering, on what will be the fastest-growing table in the schema. A partial index on the same pair `WHERE is_read IS NOT TRUE` serves the badge, which is the most frequent read in the feature and shrinks as users read their mail. And the `event` column was added, immediately `NOT NULL` — only safe because the table is empty; against rows there would have been no honest value to backfill, since an event kind cannot be recovered from prose.

**Migration 006 added `ON DELETE CASCADE` to `notifications.job_id`, and how it was found is the part worth keeping.** Not by reading the schema. The FK as originally written had no `ON DELETE` clause, which means `NO ACTION`, which means a job with notifications attached cannot be deleted at all. Nine of the thirteen `check_*.py` harnesses create jobs and delete them again in `purge()`, so the hour notifications started being written, every one of those deletes began failing — *inside cleanup*, which runs before the first assertion and again in `finally`. A purge that raises leaves its own rows behind, so each harness then failed at its next start, having run no checks at all. Fifteen jobs, forty-three notifications, seven partners and six users were stranded across five namespaces before the cause was clear. The new harness passed 79/79 throughout, because it was written knowing the FK had no cascade and deletes notifications before jobs; only the harnesses that could not have known broke. The generalisable shape: **adding a child table is a change to the parent's delete path, and it surfaces somewhere other than the new feature's tests.**

The cascade is also the right answer on the merits, not merely the convenient one. The schema already splits the five children of `jobs` consistently — `job_assignments` and `job_status_history` cascade, `ratings` (evidence feeding the score, ADR-018) and `payments` (money) do not — and notifications are on the first side: a notification stores no fact not already recoverable from the job and its history, and every row deep-links to `job_id`, so one outliving its job is not an orphaned record but an unrenderable one. The privacy argument settles it: per decision 4 above, a message is text about a job sitting outside that job's access gate, so if a job were ever removed, leaving its notifications would leave feed entries referring to a job whose access rules no longer exist to consult. Nothing in production deletes a job — cancellation is a status — so this constraint governs test cleanup and whatever retention job eventually exists, which is exactly why it was cheap now. Recorded here rather than in its own ADR, per the rule that a consequence of a decision extends that decision.

**A second `MissingGreenlet` of the class ADR-018 recorded, in code this task touched.** `dispatch_service._transition` logged `job_id=str(job.id)` in its `except` block *after* `await db.rollback()`. Same mechanism as the rating one: rollback expires every object in the identity map unconditionally, the attribute read emits a lazy `SELECT`, and on an `AsyncSession` that is a `MissingGreenlet` raised out of the error handler — so a mapped 409 would have been served as a 500. Fixed by binding `job_id` before the `try`. The rule ADR-018 stated has now caught its second instance, which is the argument for it being a rule rather than an anecdote.

**The unit suite's test doubles had silently stopped resembling the rows they stand for.** Adding the writer broke 18 existing tests across four files: `FakeJob` in `test_job_lifecycle.py` had no `user_id`, and `FakeSession` in four files had no `add()`. Both are honest gaps rather than production defects — the real `Job` has the column and the real `Session` has the method — but the 18 failures were worth more than the fix, because the newly-added `session.added` list is an assertion target that did not exist before. Two test classes now use it: `TestTheOwnerIsToldWhatThePartnerDid` (6 tests) and `TestThePartnerIsToldTheJobIsOff` (6 tests). They are deliberately *not* in `test_notification_service.py`: that file proves the recipient *rule*, these prove the *wiring* at each seam, and a rule that is correct and never invoked is the failure mode neither file alone would catch. `TestThePartnerIsToldTheJobIsOff` lives in the cancellation file because that is the only seam in the system where a partner is the recipient — a bug that always addressed the owner would pass every other test in the suite and fail only there.

**Stated gaps, so none is rediscovered as a hole.** There is no delivery: nothing pushes, nothing sends SMS, and `channel` is always `'in_app'`, which is why no row claims a delivery that did not happen. There is no real-time transport — the client polls, so a notification's latency is the client's poll interval, and WebSockets/SSE remain unbuilt. There is still no offer-expiry mechanism (deferred before this task and unchanged by it), so `job_offered` has no deadline and no countdown should be rendered against it. `job_no_match_found` is defined and wired but is the one event of the eight this task's live harness does not exercise, because producing it requires a job no partner is eligible for, which is `check_dispatch_flow.py`'s territory. And nothing marks a notification read automatically — opening the feed does not clear the badge; the client must call the endpoint.

**Evidence.** 40 unit tests in `tests/unit/test_notification_service.py` covering the recipient rule, the silent statuses, the event vocabulary and the message text, plus the 12 wiring tests described above, in the files whose seams they test.

Live: **79 of 79** assertions in `tests/integration/check_notifications.py`, against real Postgres and real Supabase tokens, in QA phone namespace `+91900000095`. The control (`--reverted`) removes the actor check from `recipients_for` so it always answers `("user",)` — the plausible wrong version, right for the accept, right for every lifecycle step, right for a partner's cancellation — and scores **71 of 79**. All eight failures are the owner's-cancellation branch and the one downstream assertion that reads the owner's whole feed: the mechanic holding the cancelled job is never told, and the owner receives a notification about the button they just pressed. A control that deleted the routes would have failed everything and proved only that the routes exist.

The decisive live assertions are the ones no unit test can reach, because each needs two accounts' feeds read after one event: an offer notifies the partner while the owner's feed stays empty (the only live proof that `requested` and `matching` are silent, asserted against the two `job_status_history` rows that *were* written); the accept notifies the owner and not the accepting partner; three lifecycle steps add exactly three owner rows, newest first, one per non-silent history row; four rows forced to share a `sent_at` in SQL page disjointly and completely; another account's notification and a random UUID are both `404 NOTIFICATION_NOT_FOUND`; and no message among the 11 the run writes contains a name, a phone number, an address, a digit at all, or the free-text cancellation reason the owner typed.

Full regression: **307 unit tests** and **646 live assertions** across thirteen harnesses, every harness exiting 0, database returned to the documented baseline (`users` 1, `vehicles` 1, `jobs` 2, `job_status_history` 2, everything else 0). One harness, `check_dispatch_capacity.py`, failed once mid-regression on a transport stall — a Redis `TimeoutError` and `asyncpg.ConnectionDoesNotExistError` in the same second — and passed 49/49 on re-run; its leftover rows are what prompted the fail-fast precondition now at the top of `check_notifications.py`, which refuses to start if the shared QA owner already has notifications and says which harness's mess to clear, rather than reporting eighteen mystery assertion failures about feed lengths.

---

# ADR-020: An admin is a row in one of our own tables, and there is deliberately no way to claim one

**Status:** Accepted

**Date:** 2026-10-01

## Decision

Admin identity, five parts:

1. **An admin is a row in `admins` with a Supabase `sub` in `admins.auth_user_id`.** Not a role claim on the JWT, not a flag on `users`. `resolve_identity` resolves it by the same mechanism as the other two roles — an indexed lookup on our own column (ADR-010, ADR-011) — and `Role` is now `Literal["user", "partner", "admin"]`.
2. **There is no admin link-auth endpoint.** Provisioning is `UPDATE admins SET auth_user_id = '<sub>' WHERE email = 'ops@sahayak.in';` run by whoever already holds database access. The absence is the security property, not an unfinished edge.
3. **More than one local row for one `sub` is an `InternalError`, not a precedence rule.** The pre-existing user+partner case plus the two the third table adds all answer 500.
4. **All three places an account gets bound to a local row check all three tables.** `register_user`, `link_user_auth`, `link_partner_auth`. These checks are the only thing preventing the state in (3), because no UNIQUE index spans two tables.
5. **`require_admin` is the entire authorization boundary for the analytics routes,** and `admins.role` (`'ops'` vs `'super_admin'`) is not consulted.

## Context

The admin analytics endpoints read across every partner, every job and every offer in the system — including the matching-strategy comparison data the evaluation rests on. They are the first routes in the API with no owner to scope them to, so they are also the first that need a third role. `admins` had existed since the original schema with two seeded rows, an `email`, a `role` column, and nothing in the codebase that read it.

## Rationale

**Why a local column and not a role claim (1).** Supabase can carry arbitrary `app_metadata` into the token, and reading `claims["app_metadata"]["role"] == "admin"` would have cost one lookup less than the column does. Rejected on three grounds. It makes granting fleet-wide read access *an edit in the Supabase dashboard* — invisible to this repository, absent from code review, and impossible to express as a migration, so the answer to "who can read every customer's jobs, and since when" would live in a web console's audit log rather than in the schema. It splits the identity model: users and partners resolve to one of our rows, and a third role that resolves to a string in a token means `Identity.local_id` has no meaning for one of the three values of `Identity.role`. And it leaves `admins` unread forever — a table in the schema that nothing consults is a table that drifts until someone discovers it is decorative.

**Why no link-auth endpoint (2), which is the decision this ADR exists for.** The obvious move was to copy `link_partner_auth`. Reading it first is what stopped that: **neither existing link-auth endpoint matches the token against the target row.** `link_user_auth` and `link_partner_auth` check that the row exists, that its `auth_user_id` is `NULL`, and that the calling account owns nothing else. No phone claim is compared to `users.phone` or `partners.phone`. Their entire authority is the premise *an unlinked profile is unclaimed*.

For a profile that premise is a defensible trade. A `partners` row before link-auth is inert — unverified, off-shift, bound to nothing — so the worst case is a stranger claiming an un-onboarded mechanic's empty profile, which surfaces immediately because the real mechanic then cannot link and calls ops. For a **privilege grant** the same premise is not a trade, it is a hole: any logged-in customer who learned an `admins` row's UUID would acquire read access to every job, every partner and the divergence data, and the only thing standing in the way would be the secrecy of a UUID — a value that appears in no response but does exist in the database, in backups, and in any log line that ever touches that row.

**Why matching the email claim was also rejected.** The natural repair is to require `claims.email == admins.email` before linking. It fails for a reason specific to this stack: whether that claim is *verified* depends on Supabase's "Confirm email" project setting, which this code cannot read and cannot assert. An authorization check whose correctness lives in a dashboard toggle is not a check — it is the same objection as (1), arriving by a different route. It is also the claim this project exercises least: auth is phone-OTP throughout, and `TokenClaims.email` is `Optional` precisely because most tokens here do not carry one.

So there is no endpoint. Provisioning an admin requires database access, which is the privilege level appropriate to granting fleet-wide read access, and it leaves a statement someone can review rather than a self-service call someone can make.

**Why ambiguity is a 500 and not a precedence rule (3).** Both tie-breaks are worse than the fault. Preferring the admin row hands admin to whoever created the second row — the escalation this whole ADR is about, arrived at by a sort order. Preferring the user row silently demotes a real admin, who then sees 403s on routes that worked yesterday and no reason why. A 500 with `auth_identity_ambiguous` logged at ERROR, naming both matched ids, is loud, is fixable from the log line alone, and fails closed.

**Why the three binding guards are load-bearing and the database cannot help (4).** `users.auth_user_id`, `partners.auth_user_id` and `admins.auth_user_id` are three separate UNIQUE indexes, and **each one guards only its own table**. Nothing at the database level stops a `sub` that is already an admin's from also appearing in `users`. The consequence is not a duplicate row to clean up later: it is the state in (3), which that account then receives *on every request it ever makes*, because the failure is in identity resolution and so precedes every route. The constraint cannot catch this; only these checks can. All three binding sites were found by audit rather than assumption — partner registration binds nothing, so there are exactly three.

**Why `admins.role` is not checked (5).** It grades admins against each other, and no endpoint yet distinguishes `'ops'` from `'super_admin'`. Checking it would be a check nothing could fail, which is worse than no check: it reads like a privilege boundary while enforcing nothing, and the first endpoint that genuinely needs the distinction would inherit the appearance of already having it.

## Alternatives considered

**`is_admin` boolean on `users`.** Collapses the privilege grant into a profile row, which makes the cross-table ambiguity problem vanish — along with the distinction between a person who uses the platform and a person who can read everyone else's data. It also discards two seeded rows and an `email`/`role` schema that already models exactly this.

**A cross-table trigger or EXCLUDE constraint enforcing one local row per `sub`.** This is the honest fix for (4) — it would put the guarantee where the guarantees belong. Rejected for now because it needs a trigger on each of three tables each querying the other two, it converts a clean 409 into a constraint violation the service must then re-map, and the failure is already prevented by three checks that produce a better error. Recorded here as the thing to build if a fourth identity table ever appears, because three application checks scale as *n(n−1)* and the next one would make six.

**An admin link-auth endpoint gated on a shared secret or a one-time provisioning token.** Correct in principle and genuinely more usable than a SQL statement. Rejected as scope: it needs a token table, an expiry, and a way to issue one, which is more machinery than two pilot admins justify — and the SQL statement is not a placeholder for it, it is the right answer at two admins.

## Consequence

**Every authenticated request now costs a third indexed lookup**, against a table with two rows that will almost always miss. That is the standing price of the local-row identity model, and it is paid on the hot path of every endpoint in the API. Accepted rather than optimised, because the alternative being avoided is reading a role off a claim; if it ever matters, the repair is to collapse the three lookups into one `UNION ALL`, not to move the answer into the token.

**An unlinked admin can never reach the `IDENTITY_NOT_LINKED` branch**, which is load-bearing for the honesty of its message. That message names the two link-auth endpoints, and `_find_unlinked_profile` searches by phone — `admins` has no phone column, so an admin row cannot surface there and the API cannot advertise a route that does not exist. The return type is narrowed to `Optional[Literal["user", "partner"]]` to say so in the signature, and `TestNoAdminLinkPath` pins it, because "be helpful and look admins up too" is the obvious change and it would be wrong.

**Migration 007 is three non-comment lines and a long comment**, and the comment is where the no-endpoint decision is written down at the point someone would act on it. It was applied three times — twice to prove idempotency, once after the comment was rewritten when the design reversed — and `db/schema.sql` carries the same note on the column. The migrations README's Log table was backfilled in the same pass: 004, 005 and 006 had shipped unrecorded, and its "Applying" section still described `psql`, which does not exist on this machine. It now describes `backend/tools/apply_migration.py`, written for this migration and reusable — one transaction per file, so a mid-file failure leaves nothing half-applied, and credentials masked to a character count rather than printed.

**Evidence.** 17 unit tests in `tests/unit/test_admin_identity.py`. They are unit tests on purpose: two of the three behaviours under test are states the database cannot be driven into through the API, so a harness going through the endpoints can only observe the guard working and never show what the guard is for.

Each of the four guards was reverted in turn and the suite re-run, restoring in a `finally`: baseline **17 passed** → ambiguity check reverted **5 failed** → registration guard reverted **1 failed** → both link guards reverted **2 failed** → `require_admin` reverted **3 failed** → restored **17 passed**. Every guard broke exactly the tests that name it and nothing else. Full unit suite **324 passed** (307 before this task).

---

# ADR-021: An analytics number is either defensible or absent — the reports carry their own caveats instead of being read alongside them

**Status:** Accepted

**Date:** 2026-10-03

## Decision

The three analytics reports never substitute a number they cannot support, and every limit on a number they do report travels **in the response**, as a `notes[]` array of `{code, detail}` with a fixed code vocabulary. Nine applications of that rule:

1. **`eta_accuracy` is `null`**, with `ETA_ACCURACY_NOT_COMPUTABLE` stating that no code path has ever written an arrival estimate and citing the count from the requested window ("0 of 8 offers carry one"). `work_started` is reported next to it as the observable half, named for the transition it actually measures and carrying `WORK_STARTED_IS_NOT_ARRIVAL`.
2. **A `no_match_found` caused by our own outage leaves *both* sides of the no-match rate**, not just the numerator; `rate_including_outages` is published beside it so the exclusion is auditable rather than invisible, and `OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE` says which jobs moved and why.
3. **Two acceptance rates, always both.** `acceptance_rate_of_answered` and `acceptance_rate_of_all`, with `UNANSWERED_OFFERS_HAVE_NO_EXPIRY` naming the count that differs between them.
4. **An offer's outcome is read from `accepted_at` / `responded_at`, never from `job_assignments.status`.**
5. **Every number in `/matching` is restricted to `assignment_rank = 1`,** declared by `FIRST_OFFERS_ONLY`.
6. **A score component that did not vary cannot be the driver of anything** — it is listed in `constant_components`, excluded from `driver`, and explained by `CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE`. `ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL` states what `driver` is not.
7. **Percentiles over a thin sample are labelled**, not withheld: `SAMPLE_TOO_SMALL_FOR_PERCENTILES` names the observation count and says the mean is usable and p50/p95 are not.
8. **An inverted window is `400 INVALID_DATE_RANGE`**, not a report of zeros. Equal bounds are allowed.
9. **The `partners` block ignores the window** and says so with `PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL` whenever a window was supplied.

## Context

These three endpoints produce the numbers that go into the final evaluation document and get defended in a viva: pilot conversion, dispatch latency, offer acceptance, the no-match rate, and above all the divergence rate — how often weighted scoring picked somebody other than the nearest eligible partner, which is the claim the whole matching design exists to support.

That makes the failure mode here different from the rest of the API. A route that returns the wrong job is a bug someone notices. A report that returns `eta_accuracy: 0.0` because nothing ever wrote an estimate is a *finding*, and it is the kind of finding that gets copied into a document, quoted in a presentation, and only questioned by whoever is asking the hardest question in the room.

## Rationale

**Why the caveats are in the response and not in the documentation.** A caveat in `HANDOFF-frontend-contract.md` or in this ADR protects a reader who went looking for it. The person who will misquote these numbers is the person who did not. Putting `notes[]` in the payload means the limit arrives attached to the number, in the same JSON, at the same moment — a dashboard can render it, and a screenshot of the response contains its own disclaimer. The `code` is there so a frontend can branch; the `detail` is there because the sentence a human needs is longer than any code.

**Why `eta_accuracy` is null rather than omitted or zero (1).** Three options, and the two rejected ones both lie. Reporting `0.0` claims a measurement of perfect accuracy. Omitting the field claims the metric was never part of the design — but it was, `job_assignments.estimated_arrival_min` is in the schema, and the gap is that no code path populates it. `null` plus a note is the only answer that distinguishes *we measured and got nothing* from *we did not measure*, and the note names which half is missing: **the estimate side, not the actual side**. That matters, because "we cannot measure ETA accuracy" sounds like a tracking failure and the truth is that the system never promises an ETA in the first place.

**Why an outage leaves the denominator too (2).** This is the decision most likely to be challenged, because excluding unfavourable data from a rate is exactly what a dishonest report does. The distinction is that the no-match rate answers *how often did we fail to find a partner for a job* — and a job whose dispatch never executed, because Redis was unreachable, produced no evidence either way. Leaving it in the numerator overstates the supply problem; moving it to the denominator only (counting it as a success) understates it. Both are wrong in a specific direction, and no honest third option exists other than removing the job from the question. `rate_including_outages` is published so the choice is checkable: a reader who disagrees can see both numbers and the count that separates them. ADR-016 is why the two causes share a status at all and why the history note is the only thing that distinguishes them.

**Why both acceptance rates ship together (3).** There is no offer timeout in the system — deferred deliberately, see ADR-012 — so an unanswered offer is still open and will stay open forever. `accepted / answered` is the real measure of partner willingness. `accepted / all` treats every unopened offer as a refusal and is therefore a floor, not a measurement. Publishing one and not the other invites the reader to treat whichever they got as *the* acceptance rate; publishing both, with the gap named, makes the open offers visible as the thing they are.

**Why the offer classification reads timestamps and not status (4).** `job_assignments.status` is rewritten when the job ends: completing a job moves its accepted assignment to `'completed'`, and cancelling a job moves its still-open offer off `'offered'`. Classifying outcomes by that column therefore *loses history in proportion to how much work actually got finished* — the more successful the pilot, the lower the measured acceptance rate. `accepted_at` and `responded_at` are append-only facts about what the partner did, and they survive everything that happens to the job afterwards. The live harness has a job in each trap for this reason (§6), and the reverted control run swaps in the status-based query to show the partition breaking: 5 accepted becomes 3, 2 unanswered becomes 1, and the three outcomes stop summing to the number of offers.

**Why divergence is rank-1 only (5).** `was_baseline_choice` is written on every assignment, so including later offers would roughly double the sample. It would also change the question halfway through it. On a first offer the flag means *this partner was also the nearest eligible one*. On a rank-2 offer, made after the nearest partner declined, it means *also the nearest of those still eligible* — a baseline computed over a smaller candidate set that no longer contains the partner the weighted strategy would most plausibly have been compared against. One definition per sample; the larger sample is the wrong sample.

**Why constant components are excluded from `driver` (6).** `skill_score` is constant **by construction**: skill is a hard filter applied before scoring (ADR-009), so every candidate that reaches the ranking matches, and `skill_score()` takes no arguments and returns 1.0. `rating_score` is constant for any window in which no partner was rated, because an unrated partner takes a fixed prior. A mean-difference attribution run over those columns will still produce a number, and that number will be noise with a confident name on it. The report names them as constants instead, and `driver` is chosen only among components that actually varied. The companion admission is that even for the varying components, `driver` is a difference of *group means* — diverged picks versus agreed picks — and not a per-job comparison against the specific partner who was passed over. The stronger version is not computable from what is stored: `score_components` is written for the partner who received the offer and never for the runner-up, so there is no row to subtract. That is written down as the thing recording the baseline candidate's components at dispatch time would fix.

**Why thin samples are labelled rather than suppressed (7).** Withholding p50 and p95 under a threshold would be defensible, and was rejected for being unhelpful in the only situation this project is ever in: nine jobs, or ninety. The pilot's whole dataset is a thin sample. Labelling keeps the number available to someone who understands what it is, and tells the reader who does not that the mean is the figure to quote.

**Why an inverted window is refused (8).** An inverted range has an honest answer — no jobs match — and returning zeros would be defensible. Refused anyway, for the reason this whole ADR exists: a report full of zeros reads as a finding about the pilot. A `400` names the mistake at the point it was made. Equal bounds are a different thing and are allowed: the window is half-open, so `from == to` is an empty range someone asked for deliberately, and its zeros mean what they say.

**Why the roster is current and says so (9).** `partners` holds no history — `is_available` is a current flag, `rating_avg` a running aggregate — so there is no honest way to report the roster as it stood during a past window. Rather than silently applying the window to the job blocks and not the partner block, the response admits the asymmetry whenever a window was supplied. The note is absent on an unwindowed request, because then there is nothing to warn about.

## Alternatives considered

**A single `caveats: string[]`.** Simpler, and unusable by a frontend that wants to render the ETA refusal differently from a thin-sample warning. The `code`/`detail` split costs one field and makes the vocabulary a contract rather than prose.

**Computing `eta_accuracy` against `work_started` as a proxy.** This is the tempting one: there is a real timestamp for work starting, so a number could be produced. It would be a measurement of *our own two timestamps agreeing with each other*, presented under a name that claims the system's promises to customers were accurate. The field name would be doing the lying, which is harder to catch than a wrong number.

**Suppressing the whole `no_match` block when any outage falls in the window.** Honest, and it discards the genuine no-match data in the same window for no reason. Excluding the specific jobs and publishing both rates keeps everything and hides nothing.

**Leaving all of this to the frontend.** The caveats are judgments about what the data can support, and they are made by the code that knows which queries ran and over what. Shipping raw numbers and expecting the consumer to reconstruct the limits guarantees that whoever consumes them second does not.

## Consequence

**`notes[]` is now part of the response contract** for all three routes, and the nine codes are a vocabulary the frontend can switch on — documented in `HANDOFF-frontend-contract.md` §14. Codes can be added; the existing nine should not change meaning, because a dashboard that renders a specific caveat for `OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE` is relying on what it means.

**Every analytics read is logged at INFO** with the admin's own id, the endpoint, the window and the note codes emitted. These three routes are the only ones in the system that return data about every partner and every customer at once, and "nothing was modified" is not an answer to "who looked".

**Evidence.** 47 unit tests in `tests/unit/test_admin_analytics_service.py` and 99 live assertions in `tests/integration/check_admin_analytics.py`, which drives nine jobs through the real endpoints — offered, declined, re-offered, accepted, completed, cancelled, unmatched — and then asks the reports to describe what happened. Two of those nine exist only to catch (4), and one is an injected Redis outage that makes the shipped failure path write its own `Dispatch unavailable:` note rather than seeding that row with SQL, which is what proves the string the evaluation query matches on is the string the failure path emits.

The divergence in (5)–(6) is arranged rather than hoped for: one partner 0.99 km from the pickup holding a live job, another 2.12 km away and free, so weighted scoring must pick the further one. The harness asserts `was_baseline_choice = false`, that `load_score` is the sole eligible component, and that `driver == "load_score"` and not `distance_score` — the component that was overridden is not the component that paid for it. Reverted control (`--reverted`, swapping the status-based offer classification back in) fails 5 of 99, all in the two sections that depend on the classification, and nothing else.

Full regression after this task: **371 unit/api tests** and **745 live assertions across fourteen harnesses** (646 across thirteen before it), database verified back to baseline.

## Implementation note: raw SQL parameters must be explicitly cast, because the driver is asyncpg

Worth recording where someone will search for it, because it cost two shipping-blocker bugs and it will recur in the next feature that writes a windowed query.

Nine of the twelve analytics queries — every one taking the window — were unexecutable when first written, failing with `asyncpg.exceptions.AmbiguousParameterError: could not determine data type of parameter $1`. The cause is protocol-level: **asyncpg uses the extended query protocol, so every statement is PREPAREd before any value is bound**, and Postgres must infer each parameter's type from the SQL text alone. A bare `:from_ts IS NULL` carries no type information, so the statement is refused — on the unbounded call *and* on a call with both timestamps supplied, because the value never gets a chance to help. `CAST(:from_ts AS timestamptz) IS NULL` resolves it.

This is specifically an asyncpg property. psycopg2 interpolates client-side and never sees the problem, which means the identical SQL pasted into a psql session, or run through the psycopg2 connection every integration harness in this repo uses to verify its own results, works fine. Checking a query by hand through that path proves nothing about whether the app can run it.

The second bug was blunter: `partner_supply` filtered on `p.is_verified`, a boolean that has never existed on `partners` — verification is `verification_status`, a four-value enum, and `'rejected'` and `'suspended'` are both not-verified without being pending, which a boolean could not have carried. A third, latent, was found while fixing it: `sum(p.rating_count)` returns `NULL` on an empty `partners` table while the schema types the field `int`, so a fresh database would have produced a Pydantic validation error; now `COALESCE(..., 0)`.

**All three endpoints returned 500 on every call while the 47 unit tests were green**, and that is the part worth keeping. The unit fixture monkeypatches every function in `analytics_repository`, which is the right design for testing the service's arithmetic and its refusal to invent numbers, and it makes those tests *structurally incapable* of noticing that no query in the module could execute. Same class of lesson as the escaped-exception-before-cleanup bug in `check_dispatch_capacity.py`: a suite that passes while telling you nothing about the thing you care about. The repair was not more unit tests — it was a 50-line throwaway that ran all twelve queries against the live schema, which surfaced all ten failures in one pass and was deleted once both causes were fixed.


