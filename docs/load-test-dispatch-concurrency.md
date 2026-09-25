# Dispatch Engine — Concurrency Load Test

**Date:** 2026-09-24
**Target:** `POST /api/v1/jobs` (dispatch runs synchronously inside the request)
**Tool:** k6 v2.2.0 for load generation, Python for seeding, response simulation and post-run analysis
**Environment:** single uvicorn worker on `127.0.0.1:8010`, Windows 11, Python 3.12.10 → Supabase PostgreSQL 17.6 + PostGIS via the `aws-0-ap-south-1` **session-mode** pooler; Redis 7 in Docker Desktop

Scripts: [`tests/load/`](../backend/tests/load/) — `seed_dispatch_load.py`, `dispatch.js`,
`responder_dispatch_load.py`, `collect_dispatch_load.py`, `profile_dispatch.py`,
`check_pool_exhaustion.py`. Raw artefacts in `tests/load/results/`.

---

## 1. Summary of findings

1. **The dispatch algorithm is not the bottleneck and never became one.** Across every
   scenario, including one that failed 82 % of its requests, the matching pipeline's own
   latency stayed between 736 ms and 1049 ms at p50. Nothing that broke was matching.
2. **The system is round-trip-bound against Postgres.** ~32 sequential round trips per
   dispatch, of which 16 are transaction control doing no work. Latency tracks
   `RTT × 32` within 10 % across a 1.6× change in network conditions.
3. **Redis is not the bottleneck by three orders of magnitude.** 0.047 ms of Redis-side
   work per dispatch against ~950 ms of Postgres round trips.
4. **Zero deadlocks in all four runs.** The three race fixes (ADR-015) hold under real
   concurrent load, not just targeted trials.
5. **The real ceiling is a connection limit, not a job rate** — and there are *two*
   ceilings, both equal to 15, which is why the system has no headroom at all. See §6.
6. **Two new bugs found**, one a genuine correctness defect (`MAX_CONCURRENT_JOBS` is never
   enforced at accept time) and one a visibility defect (a job stranded in `requested` by a
   Redis timeout). Both were flagged here and **both were fixed on 2026-09-25**, together
   with row 1 of §9. The findings below are left as they were measured; each carries a dated
   closure. See §7 and §9.
7. **Match accuracy is 73 % under create-only load and 22 % once the fleet saturates.** Both
   numbers are real and both belong in the write-up: the spread is the candidate set
   changing as `MAX_CONCURRENT_JOBS` caps out the near partners, not the algorithm making
   worse choices. See §4.

---

## 2. Results

Four runs. Three are the specified scenarios; the fourth is a calibration run added
because the specified mixed scenario failed, which bounds the ceiling from above but not
from below — without a rate that runs clean, §8 could only have quoted a range.

### 2.1 Headline table

| | **baseline** | **spike** | **mixed** | *mixed-calib* |
|---|---|---|---|---|
| Offered load | 10 creations/s, 2 min | 10→100/s over 30 s, hold 1 min, ramp down | 10 creations/s + concurrent responses, 2 min | 4 creations/s + responses, 90 s |
| Jobs created | 1201 | 1275 | 826 | 351 |
| **Throughput accepted** | **9.97 /s** | **8.58 /s** | **6.72 /s** | **3.90 /s** |
| **Errors** | **0** | **5630** (82 %) | **525** (31 % of creations) | **43** (3.7 % of requests) |
| Dropped by generator | 0 | 2090 | 0 | 0 |
| **Dispatch latency p50** (DB clock) | **858.3 ms** | **966.4 ms** | **1048.9 ms** | **736.0 ms** |
| **p95** | **1430.1 ms** | **2401.2 ms** | **1526.3 ms** | **946.8 ms** |
| **p99** | 2598.1 ms | 3327.2 ms | 1837.9 ms | 1050.5 ms |
| max | 4755.0 ms | 6565.7 ms | 2307.3 ms | 1098.1 ms |
| End-to-end HTTP p50 | 1422.0 ms | 27795.4 ms | 4697.6 ms | 1075.2 ms |
| End-to-end HTTP p95 | 3608.7 ms | 32590.2 ms | 16480.2 ms | 1303.8 ms |
| **Differed from pure-nearest** | **73.1 %** | **73.1 %** | **63.1 %** | **22.0 %** |
| Eligible partners used | 2 of 11 | 2 of 11 | 6 of 11 | **11 of 11** |
| **Deadlock delta** | **0** | **0** | **0** | **0** |
| Failure mode | — | app `QueuePool` timeout | Supavisor `EMAXCONNSESSION` | Supavisor `EMAXCONNSESSION` |

Two latencies are reported because they answer different questions and neither is a
substitute for the other. **Dispatch latency (DB clock)** is
`job_assignments.offered_at − jobs.requested_at` on the rank-1 row — literally the spec's
"time from job creation to first assignment offered", and the right number for judging the
*algorithm*. **End-to-end HTTP** is what a caller experiences, and includes queueing for a
database connection, which under load is most of it. The gap between the two columns in the
spike run — 966 ms of dispatch inside a 27.8 s response — *is* the finding.

### 2.2 Invariants

These are not performance metrics. They ask whether the system stayed *correct* while it
was busy; a dispatcher that keeps latency down by offering jobs to partners 12 km away is
not fast, it is broken and quick.

| Invariant | baseline | spike | mixed | calib |
|---|---|---|---|---|
| Offers outside the 10 km radius | 0 | 0 | 0 | 0 |
| Offers to a partner not offering the service | 0 | 0 | 0 | 0 |
| Accepted assignment on a cancelled job (Task M/N race) | 0 | 0 | 0 | 0 |
| **Partners over `MAX_CONCURRENT_JOBS`** | 0 | 0 | **6** | **1** |

The first three hold everywhere. The fourth does not, and is a new bug — §7.1. It shows up
only in the two scenarios where partners actually accept, which is exactly why create-only
load never found it.

### 2.3 Error accounting

Every failure is accounted for exactly, from the server's own log rather than inferred
from the client's view:

| Run | Requests answered | No response at all | Reconciliation |
|---|---|---|---|
| baseline | 1201 × 201 | 0 | — |
| spike | 1275 × 201 | 5630 `TimeoutError` | 11 260 `QueuePool` log lines = 5630 × 2 ✓ |
| mixed | 826 × 201 + 2163 × 200 | 521 `InternalServerError` + 4 `TimeoutError` | 374 seen by k6 + 151 seen by the responder = 525 ✓ |
| calib | 351 × 201 + 781 × 200 | 43 `InternalServerError` | 86 log lines = 43 × 2 ✓ |

The exhaustion message appears twice per failure because asyncpg raises it and SQLAlchemy
re-raises the same text wrapped, so line counts are exactly double failure counts.

---

## 3. Dispatch latency, and where it goes

The core evaluation metric is **p50 858 ms / p95 1430 ms / p99 2598 ms** under the specified
baseline load of 10 concurrent creations per second.

That is slow for what it computes, and the reason is not computation. Profiling
(`profile_dispatch.py`, using SQLAlchemy cursor events and `pg_stat_statements`) shows
**~32 sequential Postgres round trips per dispatch, 16 of which are transaction control**
— 8 `BEGIN`, 5 `ROLLBACK`, 3 `COMMIT` — that do no work. The model was then validated
against two independently-measured network conditions:

| | Postgres RTT | 32 round trips predicts | observed |
|---|---|---|---|
| profiling session | 47.3 ms | 1514 ms | 1653 ms (profiler median) |
| load-test session | 29.8 ms | 954 ms | 1050 ms (smoke p50) |

Within 10 % across a 1.6× change in RTT. Independent corroboration from the transaction
counters: baseline logged 5985 rollbacks over 1201 jobs (4.98 per dispatch) and the spike
6375 over 1275 (exactly 5.00) — matching the 5 no-op `ROLLBACK`s per request the profiler
counted.

**This is the single highest-value optimisation available**, and it is a code change rather
than a capacity purchase: the same work in fewer round trips would cut p50 roughly in
proportion. It is not done here — this task measures, it does not tune.

### Redis is exonerated

The spec asks specifically whether Redis is the bottleneck. It is not, and the margin is
not close:

| | value |
|---|---|
| Redis-side `GEOSEARCH` | 38.69 µs per call |
| Redis-side `MGET` | 8.20 µs per call |
| **Redis work per dispatch** | **≈ 0.047 ms** |
| Postgres round trips per dispatch | ≈ 950 ms |
| `redis-cli --latency` inside the container | avg 0.46 ms |

Host-side measurement initially read **78.62 ms** p50 against a Redis-side mean of
0.039 ms — a ~2000× gap that is entirely Docker Desktop's Windows loopback proxy, and fell
to 3.28 ms once warm. **That number is a local artefact and must not be quoted as a
property of the system**; it would not exist on Render, where Redis is reached over a real
socket. Redis contributes about 0.005 % of dispatch latency.

Call counts reconcile exactly: 1292 `GEOSEARCH` = 1232 dispatches + 60 collector samples,
and 1231 `MGET` = 1232 − 1, independently confirming that exactly one dispatch lost its
Redis call (§7.2).

---

## 4. Matching accuracy vs the naive baseline

`was_baseline_choice` is written on the rank-1 assignment when the weighted engine picks
the same partner that pure-nearest would have. The rate at which the engine **differs** is
the spec's accuracy metric:

| baseline | spike | mixed | calib |
|---|---|---|---|
| **73.1 %** (877/1200) | **73.1 %** (931/1274) | **63.1 %** (521/826) | **22.0 %** (55/250) |

Two things matter here, and reporting a single number would have hidden both.

**Accuracy does not degrade under load.** baseline and spike are identical to three
significant figures — 73.1 % under 10/s with zero errors, and 73.1 % under a surge that
failed 82 % of its requests. Whatever else breaks, the engine never starts making worse
choices; the requests that survive get the same quality of match.

**The metric is a function of fleet contention, not of the algorithm.** The spread from
73.1 % to 22.0 % is not the engine getting worse — it is the candidate set changing:

- In create-only runs nothing ever accepts, so no partner ever consumes capacity, and the
  *same* partner (p02, 0.9 km, rating 4.80·55) wins 98 % of all rank-1 offers. The engine
  is repeatedly overruling pure-nearest in favour of one well-rated partner slightly
  further out. High differentiation, but from a degenerate, static candidate pool.
- Once partners accept and complete (mixed, calib), `MAX_CONCURRENT_JOBS` starts capping the
  near partners out. The nearest *eligible* partner is then further away and usually also
  the best-scoring one — so the engine agrees with the nearest-available baseline more
  often, and the differentiation rate falls.

The calibration run is the honest picture of the algorithm in service: **all 11 eligible
partners received work**, ranging from p01 at 442 m to p14 at 9558 m, with scores from
0.9431 down to 0.5121. The engine is exercising its whole candidate set and the weights are
differentiating — p01 is the *nearest* partner in the dataset and received only 3.6 % of
offers, because its 3.10·4 rating is a deliberate trap seeded to catch a distance-only
matcher. A pure-nearest system would have sent it 100 %.

**The defensible headline is therefore "73 % under create-only load, falling to 22 % as the
fleet saturates"**, with the explanation above — not a single figure.

### 4.1 Metric hygiene, added 2026-09-25 — exclude dispatch outages before computing any rate

Since 2026-09-25 a Redis failure during dispatch no longer strands the job in `requested`;
it moves to `no_match_found` with the note `Dispatch unavailable: ...` (ADR-016). That is
the right product behaviour and the wrong raw input for evaluation: **an infrastructure
outage now looks exactly like "no partners were nearby" unless the query separates them.**

Any figure quoted in the final report must therefore be computed over dispatches that
actually ran. Two metrics are affected, both defined in the PRD:

- **No-match rate** (`no_match_found` jobs / requested jobs) — inflates directly. An outage
  counts as a coverage failure the fleet never had.
- **Matching accuracy / divergence** (`was_baseline_choice`) — deflates its denominator. A
  job that never reached scoring produces no rank-1 assignment at all.

The exclusion, which is the whole reason the cause was kept separable in the note text:

```sql
-- how many "no matches" were actually outages
SELECT count(*) FROM job_status_history
 WHERE status = 'no_match_found'
   AND note LIKE 'Dispatch unavailable:%';

-- genuine no-match rate: subtract the above from the no_match_found count
```

Everything in §4 above predates the change and is unaffected — those runs were measured on
code that had no such status, and the one dispatch that did lose its Redis call (§7.2) was
identified by hand. **The first evaluation run that includes post-2026-09-25 traffic is the
one that has to apply this filter**, and a number quoted without it should be treated as
unverified. Same class of error as the three false zeros in §10: a metric that silently
absorbs its own infrastructure failures reports good news it has not earned.

---

## 5. Throughput and behaviour under surge

**Baseline (10/s, 2 min): clean.** 1201 jobs, 9.97/s accepted, zero errors, zero dropped
iterations, 99.9 % matched. The predicted 15-connection wall was *not* hit, because sessions
release their connection between the 8 `BEGIN`/`COMMIT` cycles rather than holding one for
the whole request.

**Spike (10→100/s): congestion collapse.** The system accepted **8.58 jobs/s — fewer than
baseline's 9.97/s while being offered ten times the load.** It did less work by trying to do
more. 5630 requests never produced a response at all; the server emitted 1275 × 201 and
nothing else — *zero* 5xx, because these requests failed before any handler could answer.
The HTTP p95 of 32.6 s matches the pool's 30 s checkout timeout.

Honesty about the generator: k6 recorded **2090 dropped iterations** and saturated at
maxVUs 2489, so the true offered load was capped below the nominal 100/s. The spike
therefore shows *that* the system collapses and *how*, but the exact rate at which it began
to is bounded by the generator, not measured precisely.

**Mixed (10/s + responses): the specified scenario failed, and that is the result.** At the
identical creation rate as baseline, adding realistic partner and owner traffic cost
**374 of 1200 creations (31 %)**, with end-to-end p50 rising from 1422 ms to 4698 ms.
Dispatch latency itself barely moved (858 → 1049 ms p50). The added load was not
computational, it was *connections*.

Response mix achieved, against the specified 60/25/10/5:

| | accept | reject | owner-cancel | no response |
|---|---|---|---|---|
| mixed | 62.7 % | 22.4 % | 9.0 % | 5.9 % |
| calib | 60.8 % | 24.3 % | 10.8 % | 4.1 % |

---

## 6. The ceiling mechanism — two limits, both 15

This was proved rather than inferred, because three different libraries in this stack raise
an exception whose class name is exactly `TimeoutError` (`sqlalchemy.exc`,
`redis.exceptions`, `builtins`) and the unhandled-exception handler records only the class
name. Guessing was not acceptable.

Redis was eliminated by reasoning: a Redis timeout is *caught* in the dispatch path and
answered with a 201 (§7.2 is the proof — it happened, and produced a 201). The remaining
candidate was then confirmed positively with `check_pool_exhaustion.py`, which exhausts a
deliberately one-connection pool and prints what SQLAlchemy actually raises:
`type(exc).__name__ == 'TimeoutError'`, message `QueuePool limit of size 1 overflow 0
reached, connection timed out`.

The mixed run then revealed a **second, different** ceiling — `asyncpg.exceptions.
InternalServerError: (EMAXCONNSESSION) max clients reached in session mode - max clients
are limited to pool_size: 15`.

| Limit | Value | Scope | Failure mode |
|---|---|---|---|
| SQLAlchemy `AsyncAdaptedQueuePool` | 5 + 10 overflow = **15** | this app process | request waits up to `pool_timeout` 30 s, then raises, returns **nothing** |
| **Supavisor session-mode client cap** | **15** | **every client of this database, all processes** | immediate **HTTP 500** |
| Postgres `max_connections` | 60 | server | never reached (peak observed: 22 backends) |

**The app's pool is sized exactly at the pooler's cap, leaving zero headroom for any other
client.** Measured directly while the server sat idle: 15 Supavisor sessions, 14 of them
held by the application. One slot for everything else in the system.

That explains why the two runs failed differently. In the spike, nothing else held a pooler
slot, so the app's own 15-connection pool bound first and requests *queued* for 30 s. In the
mixed run, the load harness held one slot, so the pooler's cap was breached first and
requests got an immediate **500**. Same root cause, two symptoms, and which one appears
depends on whether anything else is connected — a second uvicorn worker, a migration, a
monitoring probe, an admin session.

**Resolved 2026-09-25.** Row 1 of that table is now 3 + 2 overflow = **5 per worker**, so
the two limits are no longer the same number and the app no longer consumes the entire
shared budget on its own. Which limit binds first is now unambiguous: the app's own pool
always does, and it queues rather than 500s. §9.1 has the decision and its cost.

---

## 7. New bugs found

Per the task instruction these were described and not fixed *by this task*. Both were then
fixed the following day, on 2026-09-25, in a separate task with its own reverted-first
tests; each subsection keeps its original finding and ends with a dated closure. The
distinction matters for reading the numbers: everything measured above was measured against
the *unfixed* code.

### 7.1 `MAX_CONCURRENT_JOBS` is never enforced when an offer is accepted — *correctness defect*

**What.** `MAX_CONCURRENT_JOBS = 2` appears in exactly one place in the codebase: the
candidate-eligibility filter in `dispatch_repository.py:198`. `assignment_service.py` never
references it. Capacity is checked when deciding *who to offer a job to*, and never again.

**Why that is exploitable.** An `'offered'` assignment costs no capacity — only `'accepted'`
ones do (`ACTIVE_ASSIGNMENT_STATUSES = ("accepted",)`, ADR-008). So a partner can accumulate
any number of outstanding offers while appearing completely idle to the filter, then accept
all of them. Nothing checks.

**Observed, not theorised.** Partner `cc2316d6` (p02) accepted four jobs and held all four
simultaneously against a cap of 2 — two of them 0.9 ms apart, two more seconds later. The
mixed run produced **6 partners over cap**; the calibration run, at only 4 creations/s,
produced **1**. It is not a load-dependent race: it is a missing check that concurrency
merely makes easy to hit.

**Two sub-cases, needing different fixes.** Sequential accepts of stale offers need only a
check. Near-simultaneous accepts need a check *plus* a lock, under the existing
`jobs` → `job_assignments` ordering from ADR-015, or they will reintroduce a race.

**Not trivial, so not fixed here.** It needs a decision on what a capacity-refused accept
returns (409 vs 422), what happens to the partner's other outstanding offers, and whether
the surplus offers are auto-rejected or left to expire — which touches the deferred
offer-timeout feature. It warrants its own task with its own reverted-first test.

This is a consequence of the "filter, not a score" decision, so it is also recorded inside
[ADR-009](adr/ADR.md) rather than as a new ADR, per the one-ADR-per-search-term rule.

**Closed 2026-09-25.** The three open decisions were answered as: **409
`PARTNER_AT_CAPACITY`** (its own code — the remedy differs from
`ASSIGNMENT_ALREADY_ANSWERED`: that offer is gone, this one may be acceptable in ten
minutes); the refused offer is **left `'offered'`** and is never written `'rejected'`, since
being full is not declining and charging a mechanic's acceptance rate for a platform limit
repeats the mistake ADR-012 already rejected; and the job is **re-dispatched to the next
candidate** so that from the driver's side a capacity refusal is indistinguishable from a
decline.

One claim in the paragraph above turned out to be wrong, and it is the useful part of the
story: the fix does **not** sit under the existing `jobs` → `job_assignments` ordering. Two
accepts by the same partner for two *different* jobs lock two different `jobs` rows, so
neither transaction ever waits for the other and both read the same pre-accept count. The
partner row is the only row the two transactions share, so the check has to take
`partners` `FOR UPDATE` — making the lock order `jobs` → `partners` → `job_assignments`
(verified acyclic; before the change `with_for_update()` existed in exactly one module).
A re-check written to this section's own assumption would have passed every sequential test
and closed nothing.

Two further additions the flagging did not anticipate: the locks are committed *before*
`_offer_next()` runs, because that call reaches Redis and this module holds no lock across
another service; and a rank guard suppresses re-dispatch when the refused offer has already
been superseded, without which every repeat tap on a stale offer card burns another
candidate.

Evidence: the same 12-job replay against the same fleet, reverted → **12 accepted, 0
refused, six partners ending on 3 active jobs against a cap of 2**; fixed → **8 accepted, 6
refused with `PARTNER_AT_CAPACITY`, every partner ending at exactly 2**. Deadlocks 4 → 4.
Full detail in [ADR-009](adr/ADR.md)'s closure; the lock order itself is recorded in
ADR-015 where a future caller would look it up.

### 7.2 A job can be silently stranded in `requested` with no assignments and no retry path

**What.** When Redis `GEOSEARCH` times out during dispatch, the handler logs
`dispatch_location_store_unavailable` and `dispatch_after_create_failed` — and then returns
**201 Created**. The job row exists, has zero assignments, and nothing will ever retry it.
The caller is told their request succeeded.

**Observed.** Job `6ef75b73-8559-48b5-b7c5-13f28808d929` in the baseline run, and one more
in the spike. Rate ≈ 2 / 2476 ≈ **0.08 %**.

**Trigger vs defect.** The trigger here was environmental (the Docker loopback proxy) and
would not occur the same way in production. The *handling* is the product gap, and it is
real: there is no state that says "this job needs dispatching again", so the only recovery
is the owner cancelling and re-booking. The natural fix — retry, or a background worker
sweeping `requested` jobs — is explicitly on the deferred list, which is why this is flagged
rather than patched.

**Closed 2026-09-25, without building either deferred thing.** The gap was visibility, not
retry, so the fix is visibility only: `find_candidates()` now raises a distinct type
(`DispatchUnavailableError`), `_try_dispatch()` catches that type specifically above its
existing catch-all, and the job is moved to **`no_match_found`** — the same status as
"nobody was eligible" — carrying the fixed note `"Dispatch unavailable: could not reach the
partner location service"`. The status is shared because from the driver's seat the two
situations are identical; the *cause* stays separable in `job_status_history.note`, which is
what lets the evaluation exclude outages from match-rate figures instead of counting an
infrastructure failure as a legitimate "no partners nearby":

```sql
SELECT count(*) FROM job_status_history
 WHERE status = 'no_match_found'
   AND note LIKE 'Dispatch unavailable:%';
```

Nothing retries inside the request, and the recording write is itself guarded — if it fails
the job stays in `'requested'`, exactly where it already was. `POST /jobs` still returns
**201**, measured at **782 ms** with the location store hard-timing-out on every call.
Reasoning, the rejected alternatives (a new status; a 503; an inline retry) and why this
deliberately overrides an earlier warning comment in `find_candidates()` are in
[ADR-016](adr/ADR.md).

### 7.3 Observability gap (minor, contributed directly to the cost of this task)

The unhandled-exception handler records `error_type` but discards the exception *message*.
Because three libraries here raise a class named `TimeoutError`, 5630 identical log lines
could not say which limit had been hit, and diagnosing it required writing a separate
experiment (`check_pool_exhaustion.py`). Logging `str(exc)` truncated would have answered it
in one grep. Cheap, but out of scope for a measurement task.

### Not a product bug — two API gaps that shaped the harness

`CurrentAssignmentResponse` exposes `partner_id` but no `assignment_id`, and there is no
"list my offers" endpoint. A partner therefore has **no API path** from "I have been offered
a job" to "here is the id I must answer". The load harness reads offered assignment ids
directly from Postgres for this reason; every *response* it sends goes over real HTTP.
Adarsh's partner client will hit this the moment it tries to build an offer screen.

---

## 8. The practical concurrent-load ceiling

> **On a single uvicorn worker against Supabase's ap-south-1 session-mode pooler, Sahayak's
> dispatch engine sustains 10 job creations per second indefinitely with zero errors, a p95
> dispatch latency of 1.43 s (p50 858 ms) and 99.9 % of jobs matched. That figure holds only
> while job creation is the sole traffic. Under the realistic mix — partners accepting and
> rejecting, owners cancelling — the same 10 creations/s becomes roughly 24 HTTP requests/s
> and 31 % of creations fail. The binding constraint is not a job rate but a hard limit of
> 15 concurrent database-using requests, which the system reaches at roughly 13 requests/s
> and beyond which it collapses rather than degrades: at ~100 creations/s it accepted fewer
> jobs per second (8.58) than it did at 10/s (9.97), while 82 % of requests received no
> response at all. Throughout, the matching algorithm itself never degraded — dispatch
> latency stayed near 1 s at p50 and match quality was identical at 10/s and at 100/s — so
> every ceiling measured here is a connection-capacity ceiling, not an algorithmic one.**

Practical reading for the MVP: **10 jobs/s create-only, ~4 jobs/s under realistic mixed
traffic**, which at a plausible 20-minute average job duration is on the order of 4800
concurrent live jobs — far beyond anything this project's pilot scope requires. The ceiling
is real but it is not close.

Two honest caveats on that 4/s figure. The load harness holds one of the fifteen pooler
slots itself, so some of the 3.7 % error rate at 4/s is attributable to the harness rather
than the system — though that is precisely the condition any second client creates. And at
4/s, **33 % of jobs returned `no_match_found`** because the 11-partner eligible test fleet
genuinely saturated at 22 concurrent held jobs; that is a property of the test dataset's
size, not a system limit, and it is why the calibration run's partner spread is the most
realistic one in this report.

**A third caveat, added 2026-09-25.** Every figure in the box above was measured with the
app pool at 15 — i.e. with one worker holding the entire pooler budget. The pool has since
been reduced to 5 per worker (§9.1). The *system* ceiling of 15 concurrent database-using
requests is unchanged, but it now takes three workers to reach it, and a single worker
should be expected to sustain roughly 5–6 creations/s rather than 10. The per-worker number
in this box should be read as "what one worker did at pool=15", not as the current
single-worker figure; §9.1 states what was measured and what is predicted.

---

## 9. Configuration that needs attention — flagged, not changed (row 1 applied 2026-09-25)

Config changes affect the deployed Render/Supabase environment, so nothing below was
altered *by this task*. Row 1 was decided and applied the following day; see the closure
after the table.

| # | Item | Current | Concern |
|---|---|---|---|
| 1 | `create_async_engine` in `app/config/database.py` | no `pool_size`/`max_overflow` given → defaults 5 + 10 = **15**, `pool_timeout` 30 s | Sized *exactly* at the Supavisor session-mode cap, leaving zero headroom. **This is the single most important config finding.** |
| 2 | Supavisor session-mode client cap | **15** for this project | Shared across *all* clients. Two uvicorn workers on Render cannot both run a 15-connection pool. This will produce 500s in production at loads that pass here. |
| 3 | `pool_timeout` | 30 s | A request that waits 30 s and then returns nothing is worse than one that fails in 2 s. The spike's p95 of 32.6 s is this value. |
| 4 | Postgres `max_connections` | 60 | Not a constraint; peak observed 22 backends. Do not tune this — it is not the limit. |
| 5 | Redis connection limits | default | No evidence of any Redis limit being approached. Do not tune. |

**Recommended direction (not applied):** the two limits in rows 1–2 must be decided
*together*, since the pooler cap is the real budget and the app pool must be sized to a
share of it. Moving to Supavisor's **transaction** mode instead of session mode would raise
the client cap substantially and is the likelier correct answer, but it forbids
session-scoped state (`SET`, session advisory locks, some prepared-statement usage) and so
needs verification against the dispatch engine's `FOR UPDATE` paths before it is adopted.
That is a decision with consequences, and when taken it should get its own ADR.

### 9.1 Decision taken 2026-09-25 — shrink the app pool, leave Supabase alone

Rows 1–2 were decided together, as this section asked, and the decision was to **shrink the
app's pool rather than touch the pooler**: `create_async_engine` in
`app/config/database.py` now passes `pool_size=3, max_overflow=2` — **5 connections total
per worker, down from the default 5 + 10 = 15** — with a comment recording that the
Supavisor session-mode cap is 15 *shared across all processes*, so the app must run as a
single Render worker until a transaction-mode migration is done.

The reason to act rather than keep flagging: zero headroom is a deployment risk, not a
benchmark artefact. A second worker — from autoscaling, or from someone bumping workers for
demo stability — would not degrade gracefully; it would take immediate 500s from the pooler
the moment both pools filled. At 5 per worker, three workers still fit under the cap with
room for a psql session.

Transaction-mode pooling was **not** adopted now, deliberately: it reopens the
`statement_cache_size=0` / asyncpg prepared-statement problem that this project avoided
earlier, which is not worth reopening at this scale.

**Future Scope.** *Production deployment with multiple workers would require migrating to
Supavisor transaction-mode pooling with statement_cache_size=0, deferred as out of scope
for single-worker MVP deployment.*

**The assumption behind the change was measured, not asserted.** §5 established that the
baseline scenario was nowhere near 15 concurrent connections, but "nowhere near 15" is not
the same as "under 5", and shrinking a pool below actual demand would turn a headroom fix
into a throughput regression. A sampler
(`tests/integration/check_dispatch_capacity.py` §10) polls
`engine.pool.checkedout()` every 10 ms across the regression harness and reports the peak:

| workload | peak connections checked out | of |
|---|---|---|
| sequential harness traffic | **1** | 5 |
| the two-way accept race | **2** | 5 |
| a 12-job concurrent burst | **5** | 5 |

Zero pool-exhaustion errors, and nothing left checked out at the end. Sequential usage has
an order of magnitude of headroom; the 12-job burst saturates the pool *exactly*, which is
the honest number to quote — it did not fail, but it had nothing spare. That is the real
cost of the change, and it is the right trade for an MVP whose measured ceiling (§8) is a
connection limit shared with every other client of the same database.

**Where the assumption does *not* hold, stated plainly.** It is true for the regression
suite and for pilot-scale traffic. It is **not** true for §8's headline 10 creations/s. That
figure was measured at `pool_size=5, max_overflow=10`, and the arithmetic says it will not
survive at 5: a dispatch spends roughly 860 ms of its life holding a connection, so
10 creations/s demands about **8.6 connections continuously** (Little's law). A 5-connection
pool cannot supply that, so a single worker's create-only throughput should fall to
roughly **5–6/s**, with the surplus queueing on a 30 s checkout timeout rather than
erroring.

That is a prediction from the measured service time, **not a measurement** — settling it
means re-running the k6 baseline scenario at the new pool size, which was not done as part
of this change. It is flagged rather than buried because it is the one number in this report
the config change invalidates.

It is still the right trade, for a reason that is easy to miss: the *system* ceiling has not
moved. The binding limit was always the 15 shared pooler slots, and before this change one
worker consumed all 15, so the only way to serve more than ~10/s — a second worker — produced
immediate 500s instead of more throughput. At 5 per worker, three workers fit inside the same
budget and reach the same ceiling horizontally. The change trades single-worker peak
throughput, which no pilot-scale deployment needs, for the ability to scale out at all.
Pilot load is on the order of a few jobs per *minute*; both figures are far above it.

---

## 10. Method, and what these numbers do not say

**Dataset.** 18 partners seeded around one pickup zone at 0.5–12 km: 14 inside the 10 km
radius and 4 outside, with ratings from 3.00·2 to 4.95·40 and three in-radius partners
deliberately *not* offering the test service. p01 is the nearest partner but badly rated, so
a distance-only matcher would over-serve it. p15–p18 sit outside the radius carrying the
*best* ratings, so a broken radius filter fails loudly rather than quietly. Largest
placement error after geocoding: **8 m**.

**Why measurements are bracketed.** `pg_stat_database.deadlocks` counts since the last stats
reset, so its absolute value is meaningless — a reading of 4 says nothing unless it was also
4 before the run. Every run is `--mark`ed before and `--report`ed after, and only deltas are
quoted. (That mistake was made once on this project, on this exact counter.)

**Three false zeros were found and fixed in the measurement tooling itself**, which is worth
recording because each looked like good news:

1. The collector read `/tmp/sahayak-load-uvicorn.log`. Under Git Bash `/tmp` is
   `%LOCALAPPDATA%\Temp`, but Python resolves the same literal to `C:\tmp`, which does not
   exist — so it reported "0 connection-pool complaints" from a file it never opened. A
   missing log is now loud.
2. The exhaustion scan searched for `"QueuePool limit"` only, so the mixed run — whose
   failures were *all* the pooler's differently-worded `EMAXCONNSESSION` — reported zero.
3. That same scan sat behind a JSON-parse filter, so it could never have matched the raw
   traceback lines the message actually appears in.

**Limitations, stated rather than buried.**

- The spike's offered load was capped by the generator (2090 dropped iterations), so the
  collapse point is bounded, not precisely measured.
- Redis isolation timings are taken post-run on an unloaded Redis. They bound Redis's
  contribution from below, which is sufficient to answer "is Redis the bottleneck" (no, by
  ~2000×) but not "what did Redis cost at peak".
- In the mixed run at 10/s the responder itself fell behind — up to 365 queued responses —
  so offers were answered later than a real partner app would. The 4/s calibration run,
  where the responder kept up, is the more realistic picture of fleet dynamics, and is why
  it and not the 10/s run shows true capacity saturation.
- The log scan has no upper time bound: it reads everything after the `--mark`. Reports are
  therefore valid only when generated immediately after their run, which is how all four
  here were produced. A report cannot be regenerated later against the same log.
- Single uvicorn worker, single client machine, ~30 ms RTT to the database. On Render the
  RTT will differ and, per §3, latency moves roughly linearly with it.
