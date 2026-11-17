# Sahayak: system design work log

What was done in the system design pass of 2026-11-17, why, and what is still open. The design
itself is in [system-design.html](system-design.html) (open it in a browser). Decisions are in
[adr/ADR.md](adr/ADR.md), ADR-032 onward.

## 1. The system design document

`docs/system-design.html` describes the system as it is, with every claim tied to an ADR or a
measurement:

| Section | Contents |
|---|---|
| Requirements and targets | Functional scope; measured vs **proposed** targets (time to first offer, creation rate, location freshness, availability, RPO/RTO). Targets need team sign-off before they are quoted |
| Architecture | Container diagram (clients, Supabase Auth, FastAPI, Postgres + PostGIS, Redis GEO, Expo push) and why each piece was chosen |
| Data model | Core relations; job vs assignment vs append-only history; derived data never stored |
| Dispatch | Scoring weights (distance 0.4, load 0.2, skill 0.2, rating 0.2), sequence diagram, why no lock is held across Redis |
| Job lifecycle | State machine, including escalation and staff reassign |
| Capacity model | Measured numbers plus an interactive calculator of connection-seconds per second |
| Failure modes | What happens today when each dependency or actor fails |
| Roadmap | Seven changes ranked by the capacity model and the failure table |

### What the capacity model showed

The shared limit is 15 Supavisor connections (3 workers at a pool of 5). A job creation holds a
connection for 1198 ms (about 32 round trips, 16 of them no-op transaction control). A polled
read is **estimated** at 3 round trips × 30 ms RTT; this estimate is not yet measured.

With 300 online partners and 60 live jobs, the model puts the system at about a third of the
budget, and **job creation is under 1 %** of it. Idle partners polling for offers use most of it.
So:

* the 1.2 s dispatch hold time is a **latency** problem (time to first offer, bursts);
* polling is the **capacity** problem, and server-sent updates or push are its fix.

## 2. Built: the dispatch worker (ADR-032)

The failure table had two red gaps, both of which depended on someone's app being open:

1. **An offer nobody answered sat forever.** Dispatch offers one partner at a time, so the owner
   waited until they gave up.
2. **The wider search (ADR-023) stopped when the owner's app closed.** Only the searching screen
   drove it, and iOS suspends background timers.

What was built:

| Piece | What it does |
|---|---|
| `app/services/dispatch_worker.py` | `sweep_once` every 15 s, started in the FastAPI lifespan of each API process. Times out stale offers first, then widens searches. One session per item; a failure is logged and skipped |
| `dispatch_service.expire_offer` | Locks the job, re-reads the offer, times it out only if it is still `offered`, its job is `matching` and it is older than 60 s; commits, then offers the next partner |
| `dispatch_service.widen_search_for_job` | The ADR-023 widening without an owner check; the owner route and the worker share `_widen_search` |
| `respond_to_assignment` | **Re-reads the offer after taking the job lock.** Without this, a partner accepting while the worker times their offer out would get a job already passed to someone else |
| `OFFER_TTL_S = 60`, `DISPATCH_WORKER_ENABLED`, `DISPATCH_WORKER_INTERVAL_S` | Config. The existing `timed_out` status is reused, so no migration |
| `expires_at` on `GET /partners/me/offers` | offered_at + 60 s, so clients count down from the server's deadline |

No leader election: every item is re-checked under the job's row lock, so overlapping sweeps,
an owner's poll and a partner's answer queue on the lock and the loser does nothing.

ADR-023 point 2 ("if nobody is watching, nobody is searched for") is reversed, with the reasons
in ADR-032.

## 3. Bugs found and fixed along the way

| Bug | Effect | Fix |
|---|---|---|
| Accept racing the worker's timeout | Two partners could hold one job | Re-read under the lock (above). Proven by a deterministic lock-hold check, and by the control run failing without it |
| Analytics read every timeout as a decline | `acceptance_rate_of_answered` would fall with every timeout | New `timed_out` bucket; declines exclude it; note code renamed `UNANSWERED_OFFERS_ARE_NOT_REFUSALS` |
| Timeline order under lock waits (older than this work) | `job_status_history.changed_at` was `now()`, the transaction start, so a cancel that waited behind an accept sorted before it (`matching → cancelled → assigned`); `check_dispatch_race` failed on it in 2 of 3 runs on the old code | `changed_at` is written as `clock_timestamp()`, the time of the write |

## 4. Client changes (web and mobile)

Made at the user's request, an exception to the usual rule that Adarsh owns the frontends.
Every file is listed in `HANDOFF-frontend-contract.md` section 21.

* **Partner offer cards** (web dashboard and offers page, mobile offer screen and home list):
  "Respond within 0:42", orange under 15 s; at zero "Time is up", Accept disabled, list refetched.
* **Owner**: a `no_match_found` job under 10 minutes old counts as in flight. Web keeps polling
  it; the mobile request bar shows "Still searching wider…" instead of "No partner found".
* **Admin dispatch panel**: a "Timed out" segment; "never answered" counts both kinds.
* **Docs** that said "build no countdown" now describe the 60 s expiry.

## 5. Tests and evidence

| Suite | Result |
|---|---|
| Backend unit | 621 pass (18 dispatch-worker tests, analytics, offers payload, history timestamp) |
| Live harnesses | 18 of 18, including the new `check_dispatch_worker.py` (28 checks, range 81x) |
| Web | 153 pass; `tsc` and `check:rule-a` clean |
| Mobile | 65 pass; `tsc` and `check:rule-a` clean |
| CI lint | `ruff check backend/ --select E,F --ignore E501` clean |

Every fix was shown failing on the old code before passing on the new:
* the race unit test failed on the pre-worker `dispatch_service.py`;
* the harness control run (re-read removed) failed its lock-hold section with HTTP 200 on a
  timed-out offer;
* the history timestamp test failed on `now()`.

## 6. Still open

| Item | Why it is open |
|---|---|
| Jobs stuck in `requested` after a crash are not swept | `dispatch_job` assumes it is the only writer of `requested`; making it sweep-safe is its own change |
| The polled-read cost in the capacity model is estimated | Measure one `GET /jobs/{id}` and one offers poll under the harness before quoting the model |
| Roadmap items 2 to 7 | Fewer dispatch round trips, server-sent updates, push outbox, idempotency keys and `/metrics`, staging and backups, scale-out |
| No browser or device run of the countdown and owner changes | Needs an owner and a partner sign-in and a real request; covered by component tests only |
| Proposed SLO targets | Need team sign-off |

## 7. Note for Adarsh (paste-ready)

> Hi Adarsh, backend change on 2026-11-17 (ADR-032), and I also changed some of your client code
> to match. Details in HANDOFF section 21.
>
> 1. Offers now expire 60 s after they are made. The job goes to the next partner, and a late
>    accept gets 409 ASSIGNMENT_ALREADY_ANSWERED. Offer items have a new `expires_at` field.
> 2. A `no_match_found` job keeps being searched for, server-side, for 10 minutes after it was
>    raised, even with the owner's app closed. It can come back as `matching` or `assigned`.
> 3. Admin analytics has a new `offers.timed_out` count; declines no longer include timeouts.
>    The note code `UNANSWERED_OFFERS_HAVE_NO_EXPIRY` is now `UNANSWERED_OFFERS_ARE_NOT_REFUSALS`.
>
> Client changes I made: offer countdown on web (dashboard, offers page) and mobile (offer
> screen, home list), Accept disabled at zero; owner polling of `no_match_found` inside the
> window (web `useJob`, mobile `useMyJobs` and the request bar); a "Timed out" segment on the
> admin dispatch panel; docs that said "no countdown". Tests pass on both apps, but nobody has
> seen it on a device yet. Please review and run it once on a phone.
