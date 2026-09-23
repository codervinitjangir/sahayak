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
