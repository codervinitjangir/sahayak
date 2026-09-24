"""Partner and owner behaviour for the mixed-load scenario.

    python tests/load/responder_dispatch_load.py --duration 150     # alongside k6

Run this concurrently with `k6 run -e SCENARIO=mixed`. k6 creates jobs; this
answers them, at the ratios the load-test specification asks for:

    60 %  partner accepts
    25 %  partner rejects
    10 %  owner cancels before the partner responds
     5 %  nobody responds at all

The last one is simulated by doing nothing, deliberately. Unanswered-offer expiry
is not implemented in this system (it is on the deferred list along with the
background worker), so a "timeout" here means the offer simply sits in `offered`
forever. Building the expiry feature to make this scenario tidier would be adding
a product feature inside a measurement task.

WHY THE OFFERS ARE READ FROM POSTGRES AND NOT FROM THE API
----------------------------------------------------------
A real partner client cannot do what this script does. Two gaps make it
impossible today, and both are reported rather than worked around quietly:

  * CurrentAssignmentResponse exposes partner_id but not assignment_id, and
    POST /api/v1/job-assignments/{assignment_id}/respond needs the assignment_id;
  * there is no "list my offers" endpoint at all.

So a partner has no API path from "I have been offered a job" to "here is the id
I must answer". Every *response* below goes over real HTTP against the real
server — only the discovery of which id to answer is done by querying the
database, because the API cannot currently answer that question.

WHY ACCEPTED JOBS ARE DRIVEN TO COMPLETION
------------------------------------------
This is an addition to the specified ratios, and it is a necessary one. Capacity
is held by *accepted* assignments on live jobs: ACTIVE_ASSIGNMENT_STATUSES is
("accepted",) and MAX_CONCURRENT_JOBS is 2, over an eligible pool of 11 partners.
That is a ceiling of 22 simultaneously-held jobs. At 10 jobs/s with 60 % accepted,
the fleet fills in under four seconds, after which every further job legitimately
matches nobody and the scenario stops measuring dispatch and starts measuring an
empty candidate pool.

Completing jobs recycles that capacity, which is what happens in the real world.
The saturation point is itself a finding and is reported as one; this just stops
it from consuming the whole run.
"""
import argparse
import asyncio
import hashlib
import json
import random
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx  # noqa: E402
import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

S = get_settings()
HERE = Path(__file__).resolve().parent
CONTEXT_PATH = HERE / "load-context.json"
RESULTS = HERE / "results"

ACCEPT, REJECT, CANCEL, IGNORE = "accept", "reject", "owner_cancel", "no_response"

# Cumulative thresholds over [0, 1). Expressed this way rather than as four
# random draws so the split is exact and auditable.
BANDS = [(0.60, ACCEPT), (0.85, REJECT), (0.95, CANCEL), (1.00, IGNORE)]

POLL_INTERVAL_S = 0.4
MAX_INFLIGHT = 12          # below the server's 15-connection pool on purpose:
                           # the responder is meant to contend with the job
                           # creators, not to starve them on its own.


def outcome_for(assignment_id: str) -> str:
    """Deterministic per-assignment outcome.

    Hash-derived rather than random.random() so a re-run against the same
    assignment ids makes the same choices. When a run produces a surprising
    number the first question is always "was that the scenario or the dice";
    this removes the dice from the answer.
    """
    h = hashlib.sha256(assignment_id.encode()).digest()
    x = int.from_bytes(h[:8], "big") / 2**64
    for edge, name in BANDS:
        if x < edge:
            return name
    return IGNORE


class Responder:
    def __init__(self, ctx: dict, duration: float, scenario: str = "mixed") -> None:
        self.ctx = ctx
        self.scenario = scenario
        self.deadline = time.monotonic() + duration
        self.partner_token = {p["id"]: p["token"] for p in ctx["partners"]}
        self.owner_token = {o["user_id"]: o["token"] for o in ctx["owners"]}
        self.seen: set[str] = set()
        self.tally: Counter = Counter()
        self.http_status: Counter = Counter()
        self.latencies: list[float] = []
        self.sem = asyncio.Semaphore(MAX_INFLIGHT)

        dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        self.conn = psycopg2.connect(dsn)
        self.conn.autocommit = True

    # -- discovery ---------------------------------------------------------
    def poll(self) -> list[dict]:
        q = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        q.execute(
            """
            SELECT a.id::text   AS assignment_id,
                   a.partner_id::text AS partner_id,
                   j.id::text   AS job_id,
                   j.user_id::text AS user_id
            FROM job_assignments a
            JOIN jobs j ON j.id = a.job_id
            WHERE a.status = 'offered'
              AND j.status = 'matching'
              AND j.issue_description LIKE %(tag)s
            ORDER BY a.offered_at
            LIMIT 400
            """,
            {"tag": f"{self.ctx['job_tag']} {self.scenario} %"},
        )
        return [r for r in q.fetchall() if r["assignment_id"] not in self.seen]

    # -- the four behaviours ----------------------------------------------
    async def call(self, c: httpx.AsyncClient, method: str, url: str,
                   token: str, json_body=None) -> httpx.Response | None:
        start = time.perf_counter()
        try:
            r = await c.request(
                method, url, json=json_body,
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
            )
        except httpx.HTTPError as exc:
            self.http_status[f"transport:{type(exc).__name__}"] += 1
            return None
        self.latencies.append((time.perf_counter() - start) * 1000)
        self.http_status[r.status_code] += 1
        return r

    async def handle(self, c: httpx.AsyncClient, row: dict) -> None:
        async with self.sem:
            aid, pid = row["assignment_id"], row["partner_id"]
            jid, uid = row["job_id"], row["user_id"]
            what = outcome_for(aid)

            if what == IGNORE:
                self.tally[IGNORE] += 1
                return

            if what == CANCEL:
                token = self.owner_token.get(uid)
                if token is None:
                    self.tally["owner_token_missing"] += 1
                    return
                r = await self.call(c, "POST", f"/api/v1/jobs/{jid}/cancel", token,
                                    {"cancellation_reason": "LOAD-QA owner changed mind"})
                self.tally[CANCEL if r is not None and r.status_code == 200
                           else f"{CANCEL}_failed"] += 1
                return

            token = self.partner_token.get(pid)
            if token is None:
                self.tally["partner_token_missing"] += 1
                return

            body = {"action": "accept"} if what == ACCEPT else {
                "action": "reject", "rejection_reason": "LOAD-QA too far"}
            r = await self.call(c, "POST",
                                f"/api/v1/job-assignments/{aid}/respond", token, body)
            if r is None or r.status_code != 200:
                # A 409 here is a correct outcome, not an error: the owner
                # cancelled, or the job was taken, between the poll and the call.
                # That is precisely the race this scenario exists to create, so it
                # is counted separately rather than lumped in with failures.
                key = (f"{what}_conflict" if r is not None and r.status_code == 409
                       else f"{what}_failed")
                self.tally[key] += 1
                return
            self.tally[what] += 1

            if what == ACCEPT:
                await self.drive_to_completion(c, jid, token)

    async def drive_to_completion(self, c: httpx.AsyncClient, job_id: str,
                                  token: str) -> None:
        """assigned -> partner_en_route -> in_progress -> completed.

        Each step is a separate call because the state machine forbids skipping;
        that is also what a real partner app does. A failure part-way is counted
        and abandoned rather than retried — a stuck job is data about the run, and
        retrying would hide it.
        """
        for status in ("partner_en_route", "in_progress", "completed"):
            body = {"status": status}
            if status == "completed":
                body["price_final"] = round(random.uniform(250, 900), 2)
            r = await self.call(c, "POST", f"/api/v1/jobs/{job_id}/status", token, body)
            if r is None or r.status_code != 200:
                self.tally[f"lifecycle_stopped_at_{status}"] += 1
                return
        self.tally["completed"] += 1

    # -- main loop ---------------------------------------------------------
    async def run(self) -> None:
        limits = httpx.Limits(max_connections=MAX_INFLIGHT * 2,
                              max_keepalive_connections=MAX_INFLIGHT)
        async with httpx.AsyncClient(base_url=self.ctx["base_url"], timeout=60.0,
                                     limits=limits) as c:
            tasks: set[asyncio.Task] = set()
            last_report = time.monotonic()
            while time.monotonic() < self.deadline:
                try:
                    fresh = await asyncio.to_thread(self.poll)
                except psycopg2.Error as exc:
                    print(f"  ! poll failed: {type(exc).__name__}", flush=True)
                    await asyncio.sleep(1.0)
                    continue

                for row in fresh:
                    self.seen.add(row["assignment_id"])
                    t = asyncio.create_task(self.handle(c, row))
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)

                if time.monotonic() - last_report >= 10:
                    last_report = time.monotonic()
                    left = int(self.deadline - time.monotonic())
                    print(f"  t-{left:>3}s  seen {len(self.seen):>4}  "
                          f"accepted {self.tally[ACCEPT]:>4}  "
                          f"rejected {self.tally[REJECT]:>4}  "
                          f"cancelled {self.tally[CANCEL]:>3}  "
                          f"completed {self.tally['completed']:>4}  "
                          f"in flight {len(tasks):>3}", flush=True)

                await asyncio.sleep(POLL_INTERVAL_S)

            if tasks:
                print(f"\n  draining {len(tasks)} in-flight responses...", flush=True)
                await asyncio.gather(*tasks, return_exceptions=True)

    def summary(self) -> dict:
        answered = sum(self.tally[k] for k in (ACCEPT, REJECT, CANCEL, IGNORE))
        lat = sorted(self.latencies)

        def p(q: float) -> float:
            if not lat:
                return 0.0
            return lat[min(int(len(lat) * q / 100), len(lat) - 1)]

        print(f"\noffers seen            {len(self.seen)}")
        print("outcomes")
        for k, n in self.tally.most_common():
            share = f"{100 * n / answered:5.1f} %" if answered and k in (
                ACCEPT, REJECT, CANCEL, IGNORE) else "       "
            print(f"  {k:<28} {n:>5}  {share}")
        print("\nHTTP status codes returned to the responder")
        for k, n in sorted(self.http_status.items(), key=lambda kv: -kv[1]):
            print(f"  {str(k):<28} {n:>5}")
        if lat:
            print(f"\nresponder request latency (n={len(lat)})")
            print(f"  p50 {p(50):8.1f} ms   p95 {p(95):8.1f} ms   "
                  f"p99 {p(99):8.1f} ms   max {lat[-1]:8.1f} ms")

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "offers_seen": len(self.seen),
            "outcomes": dict(self.tally),
            "http_status": {str(k): v for k, v in self.http_status.items()},
            "request_latency_ms": {"n": len(lat), "p50": p(50), "p95": p(95),
                                   "p99": p(99), "max": lat[-1] if lat else None},
            "target_ratios": {"accept": 0.60, "reject": 0.25,
                              "owner_cancel": 0.10, "no_response": 0.05},
        }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=150.0,
                    help="seconds to keep answering (cover the k6 run plus a drain)")
    ap.add_argument("--scenario", default="mixed",
                    help="which k6 scenario's jobs to answer; 'smoke' is used to "
                         "prove this script works before the measured run")
    args = ap.parse_args()

    if not CONTEXT_PATH.exists():
        raise SystemExit("seed first: python tests/load/seed_dispatch_load.py")
    ctx = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))

    print(f"answering {ctx['job_tag']} {args.scenario} offers for {args.duration:.0f}s "
          f"(60/25/10/5 accept/reject/cancel/ignore, {MAX_INFLIGHT} in flight)")
    r = Responder(ctx, args.duration, args.scenario)
    try:
        await r.run()
    finally:
        RESULTS.mkdir(exist_ok=True)
        out = RESULTS / f"responder-{args.scenario}.json"
        out.write_text(json.dumps(r.summary(), indent=1, default=str), encoding="utf-8")
        print(f"\nwrote {out.name}")
        r.conn.close()


if __name__ == "__main__":
    asyncio.run(main())
