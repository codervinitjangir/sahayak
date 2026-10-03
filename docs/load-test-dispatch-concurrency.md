# Dispatch Engine — Concurrency Load Test

**Date:** 2026-09-24 · **re-measured at the reduced connection pool 2026-09-27 (§8.1)** · **matching accuracy re-measured as a controlled experiment 2026-09-30 (§4.2), which also corrects §4**
**Target:** `POST /api/v1/jobs` (dispatch runs synchronously inside the request)
**Tool:** k6 v2.2.0 for load generation, Python for seeding, response simulation and post-run analysis
**Environment:** single uvicorn worker on `127.0.0.1:8010`, Windows 11, Python 3.12.10 → Supabase PostgreSQL 17.6 + PostGIS via the `aws-0-ap-south-1` **session-mode** pooler; Redis 7 in Docker Desktop
**Connection pool:** the four runs of §2 ran at `pool_size=5, max_overflow=10` (**15**), which was the default at the time. **The app now runs `pool_size=3, max_overflow=2` (5)** — §9.1 explains the change and §8.1 measures the same baseline scenario at it. Where the two disagree, §8.1 is the current system.

> **If you are quoting one throughput number from this report, quote §8.1's.** §2's headline
> table describes a configuration that is no longer deployed. Nothing in §3, §6 or §7 is
> affected — the algorithm, the round-trip analysis, the ceiling *mechanism* and both bugs
> reproduced identically at the new pool. **If you are quoting one matching-accuracy number,
> quote §4.2's**, and read §4.2's first three paragraphs before quoting anything from §4.

Scripts: [`tests/load/`](../backend/tests/load/) — `seed_dispatch_load.py`, `dispatch.js`,
`responder_dispatch_load.py`, `collect_dispatch_load.py`, `profile_dispatch.py`,
`check_pool_exhaustion.py`, `measure_matching_accuracy.py` (added 2026-09-30, §4.2). Raw
artefacts in `tests/load/results/`; the 2026-09-27 re-run is tagged `*_pool5` and sits
alongside the originals rather than replacing them.

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
4. **Zero deadlocks in every run, at both pool sizes.** The three race fixes (ADR-015) hold
   under real concurrent load, not just targeted trials — including the 2026-09-27 run in
   which 57 % of requests failed at the connection layer while all four invariants stayed at
   0 (§8.1).
5. **The real ceiling is a connection limit, not a job rate** — and at the time of these runs
   there were *two* ceilings, both equal to 15, which is why the system had no headroom at
   all. See §6. The pool has since been cut to 5 per worker, which moves the binding limit
   off the pooler and into the app: see §8.1.
6. **Two new bugs found**, one a genuine correctness defect (`MAX_CONCURRENT_JOBS` is never
   enforced at accept time) and one a visibility defect (a job stranded in `requested` by a
   Redis timeout). Both were flagged here and **both were fixed on 2026-09-25**, together
   with row 1 of §9. The findings below are left as they were measured; each carries a dated
   closure. See §7 and §9.
7. **Match accuracy is 73 % under create-only load and 22 % once the fleet saturates.** Both
   numbers are real and both belong in the write-up: the spread is the candidate set
   changing as `MAX_CONCURRENT_JOBS` caps out the near partners, not the algorithm making
   worse choices. See §4.
8. **Added 2026-09-27 — one worker's honest throughput is 2 creations/s, not 10.** Re-running
   the baseline scenario at the current 5-connection pool settles the one number the
   2026-09-25 config change invalidated. At the specified 10/s the worker accepts 3.14 jobs/s
   and returns 500s for 57.1 % of requests after a full 30 s `pool_timeout` wait; 2/s runs
   clean. Finding 1 survives intact — dispatch p50 moved from 858.3 ms to 871.9 ms and 100 %
   of jobs matched while more than half the requests were failing. See §8.1.
9. **Added 2026-09-30 — the rating term is worth 70 percentage points, and without it the
   engine was provably identical to the baseline it exists to beat.** A two-arm controlled
   experiment (ratings live vs. ratings zeroed, load and skill held constant) measured 70.0 %
   divergence from pure-nearest with real ratings and **exactly 0.0 %** without — the second
   figure predicted from the arithmetic before the run and confirmed by it. This also
   **corrects §4 and ADR-018**: the load harness seeds ratings directly via SQL, so every
   earlier figure in this report is a *rating-live* number. Production, not this harness, was
   the rating-blind system. See §4.2.

---

## 2. Results

Four runs. Three are the specified scenarios; the fourth is a calibration run added
because the specified mixed scenario failed, which bounds the ceiling from above but not
from below — without a rate that runs clean, §8 could only have quoted a range.

**All four ran at the old 15-connection pool.** §8.1 re-runs the baseline column at the
current 5-connection pool; read the two together, not one instead of the other.

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

> **Pool=15 (2026-09-24).** The baseline column re-measured at the current pool of 5 reads
> **3.14 /s accepted, 621 errors (57.1 %), DB-clock p50 871.9 ms, end-to-end p50 17009 ms** —
> §8.1. The dispatch-latency rows barely move; the throughput and error rows change
> completely.

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
baseline load of 10 concurrent creations per second. *(Re-measured at the 5-connection pool on
2026-09-27: p50 **871.9 ms**, p95 2034.7, p99 2762.5 — see §8.1. The algorithm's own latency is
insensitive to the pool size; only the queueing in front of it changes.)*

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

A third, later corroboration: re-profiling on 2026-09-27 for §8.1 measured **16 statements
client-timed against 32.1 counted by `pg_stat_database`** — the same 16 unattributed round
trips, costing **506.2 ms of a 1198.3 ms handler**. The finding is stable across three weeks
and two network conditions, and it is the reason a dispatch holds its connection for ~1.2 s
rather than the ~860 ms §3's headline suggests.

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

> **Read §4.2 before quoting anything from this section.** Everything below was measured with
> ratings seeded directly into `partners` by the harness, which — unknown at the time of
> writing — was the *only* working path to those columns in the entire system. These are
> rating-live figures. They are not "before the ratings fix" figures, and §4.2 supersedes this
> section as the defensible accuracy measurement.

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

**Applied 2026-09-27, result: the adjustment is empty.** §8.1's three runs are the first
traffic measured on post-2026-09-25 code, so the filter was run against them. `no_match_found`
was **0** in all three — 469 of 469 jobs in the 10/s run reached `matching`, and likewise at
3/s and 2/s — so there are no `Dispatch unavailable:` rows to subtract and **§8.1's 100 %
matched and 72.3 % divergence are unadjusted because the adjustment has nothing in it.** That
is stated rather than skipped: "the filter returned zero" and "the filter was never applied"
look identical in a final number, and only one of them is defensible. The reason it is zero is
also worth keeping — Redis was healthy throughout (isolated GEOSEARCH p50 0.43 ms), and a
worker accepting 3 jobs/s cannot hold enough jobs concurrently to exhaust 11 eligible
partners the way §5's mixed run did.

### 4.2 What the rating term is actually worth, measured 2026-09-30 — and a correction to §4

Ratings endpoints shipped 2026-09-29. Until then nothing in the application could write
`partners.rating_avg` or `rating_count`: the columns existed, were readable, and were wired
into the scoring function, but the only thing that ever set them was a database trigger that
could not fire (ADR-018). Every partner row in production held `0.0` / `0`.

**The correction first, because it changes how every figure in §4 must be read.** When
ADR-018 was written it said no ranking produced before 2026-09-29 exercised the rating
dimension at all, *"the load-test numbers included"*. That last clause is **wrong**.
`seed_dispatch_load.py` sets ratings directly with SQL (`UPDATE partners SET rating_avg = …`,
lines 374–383), explicitly because no endpoint existed to do it. So this harness was the one
place in the whole system where the rating dimension *did* work — it worked precisely because
it bypassed the writer that was broken. Every number in §4 and §8.1 is a **rating-live**
number. Production, over the same period, was rating-blind, and had never been measured.

The consequence is that simply re-running the load test after the fix proves nothing: the
seeder was already doing what the fix now makes the application do, so the re-run returns the
same ~72 % and answers a question nobody asked. The number that was missing is what the
engine did when the rating term was dead — the production condition.

**Method — a two-arm controlled experiment, not a re-run.**
`tests/load/measure_matching_accuracy.py`. A saturating k6 run varies three things at once
(jittered distance, fleet load, seeded rating), so its divergence figure cannot be attributed
to any single term. This script holds two of the three still: it runs **no responders**, so no
assignment ever reaches `accepted`, every `active_job_count` stays 0 and `load_score` is a
constant 1.0; `skill_score` is already constant because `find_candidates` only returns exact
service matches. Distance and rating are then the only varying terms, and the two arms differ
in exactly one of them:

- **rating-live** — partners keep the seeded spread, in which the *nearest* eligible partner
  (p01, 0.5 km) is rated 3.10 from 4 reviews and is labelled `# nearest, and badly rated: the
  trap` in the fixture, while p02 at 0.9 km holds 4.80 from 55.
- **rating-blind** — every QA partner is set to `rating_avg 0.0, rating_count 0` for the
  duration and restored afterwards from a snapshot, with the round-trip asserted. Not a
  synthetic condition: it is what every row actually held until 2026-09-29.

**The prediction was written into the script's docstring before the run, not after.** With
load and skill constant, `rating_score(0.0, 0)` collapses to `PRIOR_MEAN / MAX_RATING = 0.7`
for *every* candidate, because the Bayesian smoothing has nothing but the prior to work with.
The only term left that varies is `distance_score = max(0, 1 − d/10000)`, which is
monotonically decreasing in distance. Therefore `argmax(score) ≡ argmin(distance) ≡
baseline_pick()`. Divergence must be **exactly 0.0 %** — not approximately. Anything else
would mean the arm failed to apply or the pipeline is not what the code says it is, making the
number a bug report rather than a measurement.

**Results — 2026-09-30, 60 jobs per arm, seed 20260930 (identical pickup jitter in both arms),
11 eligible partners, create-only.** Raw output:
`tests/load/results/matching-accuracy-20260930T114915Z.json`

| | **rating-live** (post-fix: what production does now) | **rating-blind** (pre-fix: what production actually did) |
|---|---|---|
| rank-1 offers measured | 60 | 60 |
| differed from pure-nearest | 42 | **0** |
| **divergence rate** | **70.0 %** | **0.0 %** |
| distinct `rating_score` values | 2 (0.9383 … 0.9635) | **1** (0.7 … 0.7) |
| distinct `load_score` values | 1 (held still) | 1 (held still) |
| `matching_score` p50 | 0.9498 | 0.9204 |
| distance offered at p50 | 947 m | 491 m |
| who won the work | p02 **58** (96.7 %), p04 2 (3.3 %) | p01 **42** (70.0 %), p02 18 (30.0 %) |

**Prediction confirmed exactly.** Rating-blind divergence is 0.0 %, and `rating_score` took
exactly one distinct value across all 60 offers. The rating dimension is worth **70.0
percentage points** of divergence from a pure distance sort, holding load and skill constant.

The single sentence this produces, and it is a stronger claim than "the rating term was a
constant": **with the rating term dead, the weighted scoring engine was provably identical to
the naive nearest-partner baseline it exists to beat.** Not similar to it — identical, on all
60 of 60 decisions, for the arithmetic reason above. The project's headline differentiator was
not partially degraded in production before 2026-09-29; it was not operating.

The fixture's own trap makes the same point without any arithmetic: **p01 — nearest at 0.5 km,
rated 3.10 from 4 reviews — won 0 of 60 jobs with ratings live, and 42 of 60 with ratings
blind.** It was seeded specifically to catch a distance-only matcher, and in the blind arm it
caught this one. (p02's 30 % share of the blind arm is not a rating effect: the ±0.6 km pickup
jitter genuinely puts p02 nearer than p01 on some jobs, and the engine correctly follows.)

**Cross-check against the existing figures.** 70.0 % here sits alongside §4's 73.1 % and
§8.1's 72.3 %, all three measured create-only with the same seeded fixture. They agree within
three points, which is the corroboration worth having: this script's rating-live arm is
reproducing the earlier harness, so the 0.0 % in the other column is a property of the
condition and not of a different measurement method. The residual gap is sample size (60
against 469–1200) and one jitter draw, not a change in the engine.

**One incidental corroboration of §8.1.** The script asked for 2.0 creations/s and achieved
0.81/s, because it creates jobs strictly sequentially and each `POST /api/v1/jobs` spends
~1.2 s of it holding a connection. That is §6's measured 1198 ms connection-hold time showing
up again from a completely different tool — a sequential client cannot exceed ~1/1.198 ≈
0.83/s no matter what rate it is asked for. The 2/s clean ceiling in §8.1 is a *concurrent*
figure and remains the one to quote.

**What to put in the final evaluation document.** These are two different regimes, not a
before/after improvement in the algorithm — the code of `scoring.py` is unchanged between the
arms, and was unchanged by the ratings fix. State it as:

> The weighted matching engine diverges from a pure-nearest baseline on **70.0 %** of
> dispatch decisions once real rating data reaches it (measured 2026-09-30, n=60,
> create-only, load and skill held constant). Before ratings could be written
> (pre-2026-09-29), the same engine on the same fixture diverged on **0.0 %** of decisions —
> provably reducing to the naive baseline, because an unrated candidate set gives every
> partner the identical prior-only rating score of 0.7 and leaves distance as the sole
> varying term.

Do **not** quote §4's 73.1 % / 63.1 % / 22.0 % spread as "pre-fix" figures. They were
rating-live throughout, for the reason at the top of this section, and the fleet-contention
explanation in §4 is still the correct reading of them.

---

## 5. Throughput and behaviour under surge

**Baseline (10/s, 2 min): clean.** 1201 jobs, 9.97/s accepted, zero errors, zero dropped
iterations, 99.9 % matched. The predicted 15-connection wall was *not* hit, because sessions
release their connection between the 8 `BEGIN`/`COMMIT` cycles rather than holding one for
the whole request. *(At the current pool of 5 this same scenario is the opposite of clean —
57.1 % errors, 3.14/s. The clean rate is now 2/s. §8.1.)*

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

**Resolved 2026-09-25, and re-measured 2026-09-27.** Row 1 of that table is now 3 + 2
overflow = **5 per worker**, so the two limits are no longer the same number and the app no
longer consumes the entire shared budget on its own. Which limit binds first is now
unambiguous, and §8.1 confirms it empirically: in a 10/s run at the new pool, **all 621
failures carry the app's `QueuePool` message and none carry `EMAXCONNSESSION`** — one worker
can no longer reach the pooler at all.

One clause of that closure was wrong, though, and §8.1 corrects it: *"it queues rather than
500s"* holds only for a bounded burst. Under a sustained arrival rate above the service rate
the queue never drains, every waiter eventually hits the 30 s `pool_timeout`, and the
`TimeoutError` is unhandled — so the observed behaviour is **a 30-second wait followed by a
500**, which is row 3 of §9's table made concrete. The failure mode did not become gentler
when the pool shrank; it became the app's own, and it arrives later.

The section heading remains "two limits, both 15" because that is what was measured on
2026-09-24 and it is the mechanism worth understanding. In the deployed configuration the
values are 5 and 15.

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

> **⚠️ The per-worker throughput figures in this section were measured at the old pool of 15
> and were superseded on 2026-09-27. The current single-worker numbers are in §8.1. This box
> is left as it was measured; read it as "what one worker did at `pool_size=5,
> max_overflow=10`", which is a configuration the app no longer runs.**

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

Practical reading **at pool=15**: 10 jobs/s create-only, ~4 jobs/s under realistic mixed
traffic. The last clause of the box is the part that survived the config change unchanged,
and it is the one that matters: **every ceiling in this report is a connection-capacity
ceiling, not an algorithmic one.** §8.1 re-measures the capacity; it does not revise the
algorithm.

Two honest caveats on that 4/s figure. The load harness holds one of the fifteen pooler
slots itself, so some of the 3.7 % error rate at 4/s is attributable to the harness rather
than the system — though that is precisely the condition any second client creates. And at
4/s, **33 % of jobs returned `no_match_found`** because the 11-partner eligible test fleet
genuinely saturated at 22 concurrent held jobs; that is a property of the test dataset's
size, not a system limit, and it is why the calibration run's partner spread is the most
realistic one in this report.

**A third caveat, added 2026-09-25, settled 2026-09-27.** Every figure in the box above was
measured with the app pool at 15 — i.e. with one worker holding the entire pooler budget. The
pool has since been reduced to 5 per worker (§9.1). When that change was made, this caveat
predicted a single worker would sustain "roughly 5–6 creations/s rather than 10". **That
prediction was wrong in both directions and has been replaced by a measurement** — see §8.1.
The per-worker number in the box above should be read as "what one worker did at pool=15",
never as the current single-worker figure.

### 8.1 Re-measured 2026-09-27 at the current pool of 5 — the real single-worker ceiling

> **On a single uvicorn worker with `pool_size=3, max_overflow=2` (5 connections), the same
> baseline scenario — 10 job creations/s for 2 minutes — does not degrade gracefully. It
> accepts **3.14 jobs/s** and **fails 57.1 % of requests** (621 of 1088), every failure an
> HTTP 500 from the app's own `QueuePool` checkout timing out after 30 s. The modal user
> experience at that offered rate is a 30-second wait followed by a 500: client-observed p50
> is **17.0 s** and `http_req_duration` p50 is exactly **30.00 s**. The rate one worker
> sustains **cleanly** — zero errors, p50 1.5 s — is **2 creations/s**; at 3/s errors appear
> (3.0 %) and p95 reaches 18.9 s. Throughout all of this the dispatch algorithm was
> untouched: DB-clock dispatch p50 **871.9 ms** against 858.3 ms at pool=15, **100 % of jobs
> matched**, all four invariants 0, and **0 deadlocks** — in a run where more than half the
> requests failed.**

Same scenario, same 18-partner dataset, same seeded placements (14 in-radius, 4 out, 8 m max
placement error, 11 eligible), separate `RUN_ID`s so no 2026-09-24 artefact was overwritten:

| | pool 15 (2026-09-24) | **pool 5 (2026-09-27)** |
|---|---|---|
| offered rate | 10 creations/s, 2 min | 10 creations/s, 2 min |
| k6 iterations issued | 1201 | 1088 (+111 dropped by the generator) |
| jobs created | 1201 | 467 (469 rows in DB) |
| **jobs accepted /s** | **9.97** | **3.14** |
| **errors** | **0** | **621 = 57.1 %** |
| failure mode | — | app `QueuePool` timeout; **0** Supavisor `EMAXCONNSESSION` |
| client p50 / p95 / max | 1422 / 3609 / — ms | **17009 / 31252 / 33642 ms** |
| `http_req_duration` p50 | 1422 ms | **30002 ms** (= `pool_timeout`) |
| **DB-clock dispatch p50** | **858.3 ms** | **871.9 ms** |
| DB-clock p95 / p99 / max | 1430.1 / 2598.1 / 4755.0 ms | 2034.7 / 2762.5 / 3151.2 ms |
| matched | 99.9 % | **100.0 %** |
| differed from pure-nearest | 73.1 % | 72.3 % |
| eligible partners used | 2 of 11 | 2 of 11 |
| deadlocks / invariant violations | 0 / all 0 | 0 / all 0 |

The 3.14/s is a **saturated ceiling, not a transient**. Per 15-second bucket the accepted
rate was 3.60, 3.73, 3.00, 3.73, 3.93, 2.53, 3.67, 2.93, 1.67, 2.47 /s — flat from the first
bucket to the last. Nothing warmed up and nothing collapsed further; the worker found its
service rate immediately and held it.

**Calibration — the rate that is actually clean.** Two further runs, each `--mark`-bracketed:

| offered rate | created | accepted /s | errors | client p50 / p95 | DB-clock p50 | ceiling log lines |
|---|---|---|---|---|---|---|
| 10/s | 467 | 3.14 | **621 (57.1 %)** | 17009 / 31252 ms | 871.9 ms | 1242 |
| 3/s | 263 | 2.93 | 8 (3.0 %) | 3839 / 18876 ms | 833.0 ms | 16 |
| **2/s** | **181** | **2.01** | **0** | **1506 / 5146 ms** | **835.9 ms** | **0** |

At 2/s the p99 is 6.7 s and the max 8.9 s, so even the tail stays inside a plausible mobile
timeout. The smoke scenario (2/s, 15 s) also came back unchanged at p50 1268.4 ms against
1190 ms at pool=15 — **below 5 concurrent requests the pool size is invisible**, which is the
other half of why this change was safe for the regression suite (§9.1's sampler table).

**Why the 5–6/s prediction was wrong, in two independent ways.** Both matter more than the
number itself, because both are reusable mistakes:

1. **It used the wrong service time.** The prediction fed Little's law with 860 ms, which is
   §3's `requested_at → offered_at` dispatch window. That is not the connection-hold time —
   it excludes request parsing, auth, JWT verification, response serialisation, and the
   `BEGIN`/`COMMIT` round trips that bracket the work. Profiling the handler in-process
   (`tests/load/profile_dispatch.py`, median of 8, no HTTP hop) measures the real hold at
   **1198.3 ms**: 655.0 ms across 16 client-timed statements (54.7 %), 3.0 ms in 2 Redis
   commands (0.2 %), 540.3 ms in Python (45.1 %) — of which reconciliation against
   `pg_stat_database` statement counts attributes **~506.2 ms to 16.1 unattributed round
   trips** (transaction control and `pool_pre_ping`). So ~1.16 s of the 1.20 s is Postgres
   round-trip latency to ap-south-1, and **the connection is held for all of it.** Corrected,
   Little's law gives 5 ÷ 1.198 s ≈ **4.2/s**, not 5.8/s. The measured 3.14/s is lower still
   because under load the hold itself stretches (5 ÷ 3.14 = 1.59 s effective) — contention
   between 261 concurrent coroutines on one event loop, plus a pre-ping per checkout.
2. **It predicted queueing where the failure is actually erroring.** The caveat said the
   surplus would queue "on a 30 s checkout timeout rather than erroring". That is true of a
   *bounded burst* and false of a *constant arrival rate above capacity*: offered 10/s against
   a service rate of ~3/s, the checkout queue grows without bound, so waiters reach
   `pool_timeout` and raise
   `sqlalchemy.exc.TimeoutError: QueuePool limit of size 3 overflow 2 reached, connection
   timed out, timeout 30.00`, which nothing catches → HTTP 500. **`pool_timeout` does not
   absorb sustained overload; it converts it into 500s after a 30-second delay** — the worst
   of both, as row 3 of §9's table already warned in the abstract.

**The ceiling moved from the pooler into the app.** §6 described two limits that both happened
to be 15 — the app's QueuePool and Supavisor's `EMAXCONNSESSION` — and at pool=15 a single
worker could reach either. At pool=5 that symmetry is gone: all 621 failures are the app's own
`QueuePool` message and there are **zero** `EMAXCONNSESSION`, `too many connections` or
`max clients reached` lines in the server log. One worker can no longer touch the pooler cap,
which is exactly what the §9.1 change was for; §6's mechanism is still correct, but its "both
15" framing describes the old configuration only.

**Two reading notes on the raw artefacts**, so nobody mis-cites them later:

- The collector reports **"1242 connection-ceiling messages"** for the 10/s run. That is a
  *line* count, not a failure count: each timeout logs the `TimeoutError` line twice — once in
  the structlog `unhandled_exception` event and once in `Exception in ASGI application`.
  621 failures, 1242 lines. The same factor of 2 applies to the 3/s run (16 lines = 8
  failures).
- **§4.1's `Dispatch unavailable:%` exclusion is a no-op for every run in this section**, and
  that is stated rather than silently skipped: 469 of 469 jobs reached `matching` and
  `no_match_found` was **0** in all three runs, so there is nothing to exclude and the 100 %
  / 72.3 % match figures above are unadjusted because the adjustment is empty. Unlike §5's
  mixed run, the test fleet never saturated here — a worker that only accepts 3 jobs/s cannot
  generate enough concurrent held jobs to exhaust 11 eligible partners.

**What this does and does not change.** It does not change the deployment decision (§9.1),
which was about headroom and horizontal scaling, not about single-worker peak. It does not
change the algorithm's numbers. What it changes is **which figure may be quoted as the
system's throughput**: for the app as it is configured today, that figure is **2 creations/s
clean per worker, 3.14/s saturated**, and the ~10/s in §8's box is a historical measurement of
a configuration that is no longer deployed. Pilot load is a few jobs per *minute*, so 2/s
remains roughly two orders of magnitude of headroom — but 2/s is the honest number.

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
figure was measured at `pool_size=5, max_overflow=10`, and shrinking the pool to 5 costs most
of it.

**Measured 2026-09-27, replacing the prediction this section originally carried.** The
baseline scenario was re-run at `pool_size=3, max_overflow=2`; full numbers are in §8.1. One
worker accepts **3.14 jobs/s** at an offered 10/s while failing **57.1 %** of requests, and
sustains **2/s** cleanly with zero errors. The prediction made here on 2026-09-25 — "roughly
5–6/s, with the surplus queueing on a 30 s checkout timeout rather than erroring" — was wrong
twice over: it used §3's 860 ms dispatch window as the connection-hold time when the measured
hold is **1198.3 ms** (profiled: 655.0 ms in 16 statements, ~506.2 ms in transaction-control
and pre-ping round trips, 540.3 ms in Python, 3.0 ms in Redis), and it assumed a 30 s
`pool_timeout` would absorb the surplus when in fact a *sustained* arrival rate above capacity
grows the checkout queue without bound, so waiters hit the timeout and return 500s. Corrected
Little's law gives 5 ÷ 1.198 s ≈ 4.2/s as the ceiling and 3.14/s was measured, the gap being
hold-time stretch under contention.

The estimate was wrong by roughly 2× on the number and qualitatively wrong on the failure
mode, which is the more expensive error of the two: a system that queues under overload and
one that returns 500s after 30 s need different operational answers. **This is why the section
flagged it as a prediction rather than stating it as a result**, and it is the argument for
re-measuring anything derived from a service time rather than measured end to end.

The trade itself still stands, and §8.1 does not disturb it: the algorithm did not degrade at
any load tested (DB-clock p50 871.9 ms vs 858.3 ms, 100 % matched, invariants 0, deadlocks 0),
and the *system* ceiling has not moved. The binding limit was always the 15 shared pooler
slots, and before this change one worker consumed all 15, so the only way to serve more than
~10/s — a second worker — produced immediate 500s instead of more throughput. At 5 per worker,
three workers fit inside the same budget and reach the same ceiling horizontally. The change
trades single-worker peak throughput, which no pilot-scale deployment needs, for the ability
to scale out at all. Pilot load is on the order of a few jobs per *minute*; 2/s clean is still
two orders of magnitude above it.

What §8.1 *does* add to the trade is a cost that was previously only guessed at: the
single-worker figure fell further than expected, and it fails loudly rather than slowly. If
the pilot ever needed more than ~2 creations/s from one process, the answer is a second
worker (which now fits) or transaction-mode pooling (§9, Future Scope) — not a larger pool,
which would re-create the zero-headroom condition this change removed.

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

**A fourth tooling caution, from the 2026-09-27 re-run: the ceiling-message count is a *line*
count, not a failure count.** The collector reported "1242 connection-ceiling messages" for a
run with 621 failures, because each unhandled `TimeoutError` prints the matching line twice —
once inside the structlog `unhandled_exception` event and once inside uvicorn's `Exception in
ASGI application` traceback. Divide by two before comparing it to an HTTP error count, or
cross-check against k6's own counter as §8.1 does. The same factor applies to the 3/s run
(16 lines, 8 failures).

**Log hygiene for re-runs.** Because the scan has no upper time bound (see the limitation
below), the 128 MB log left by the 2026-09-24 runs was moved aside to
`sahayak-load-uvicorn.log.2026-09-24.bak` before the 2026-09-27 runs rather than appended to.
Reading a stale log is the same class of error as the three false zeros, inverted: it reports
bad news the run did not earn.

**Limitations, stated rather than buried.**

- The spike's offered load was capped by the generator (2090 dropped iterations), so the
  collapse point is bounded, not precisely measured. The same applies, more mildly, to the
  2026-09-27 10/s run: k6 dropped 111 iterations it could not start, so the offered rate
  there was marginally below the nominal 10/s. This does not affect the accepted-rate figure
  (3.14/s), which is counted from database rows, or the error percentage, which is counted
  over requests actually issued.
- Redis isolation timings are taken post-run on an unloaded Redis. They bound Redis's
  contribution from below, which is sufficient to answer "is Redis the bottleneck" (no, by
  ~2000×) but not "what did Redis cost at peak".
- In the mixed run at 10/s the responder itself fell behind — up to 365 queued responses —
  so offers were answered later than a real partner app would. The 4/s calibration run,
  where the responder kept up, is the more realistic picture of fleet dynamics, and is why
  it and not the 10/s run shows true capacity saturation.
- The log scan has no upper time bound: it reads everything after the `--mark`. Reports are
  therefore valid only when generated immediately after their run, which is how all seven
  runs here were produced. A report cannot be regenerated later against the same log.
- **The 2026-09-27 runs are create-only.** The mixed scenario was not re-run at pool=5, so
  §5's "~4 jobs/s under realistic mixed traffic" has no pool=5 counterpart. Given that
  create-only fell from 9.97 to 3.14/s, the mixed figure at pool=5 must be lower than 4/s,
  but *how much* lower is not measured and should not be estimated — the 5–6/s prediction
  §8.1 just retired was exactly this kind of arithmetic. If a mixed number at the current
  pool is ever needed, it has to be run.
- Single uvicorn worker, single client machine, ~30 ms RTT to the database. On Render the
  RTT will differ and, per §3, latency moves roughly linearly with it — which also means the
  2 creations/s clean rate is RTT-dependent, since the connection-hold time it derives from
  is ~97 % round-trip latency.
