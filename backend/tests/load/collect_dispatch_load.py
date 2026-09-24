"""Post-run analysis for the dispatch load test.

    python tests/load/collect_dispatch_load.py --mark   baseline   # before the run
    k6 run -e SCENARIO=baseline tests/load/dispatch.js
    python tests/load/collect_dispatch_load.py --report baseline   # after the run

Every metric the spec asks for that k6 cannot see comes from here, and the split
is not arbitrary. k6 knows how long a request took; it does not know which partner
was chosen, whether that partner was also the nearest one, whether Postgres
deadlocked, or how long the Redis leg took inside the handler. Those are
properties of the data the run left behind, so they are read out of the data.

The --mark / --report split exists because two of the metrics are deltas on
cumulative counters. pg_stat_database.deadlocks counts every deadlock since the
last stats reset, so its absolute value is meaningless — a reading of 4 says
nothing unless you know it was also 4 before the run started. That mistake was
already made once on this project, on this exact counter, which is why the
bracketing is enforced here rather than left to whoever is running the test.

The invariant checks at the end are the part worth reading. They are not
performance metrics: they ask whether the system stayed *correct* while it was
busy. A dispatcher that keeps its latency down by quietly offering jobs to
partners 12 km away, or to partners who do not perform the service, is not a fast
dispatcher — it is a broken one that happens to be quick.
"""
import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402
import redis as sync_redis  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

S = get_settings()
HERE = Path(__file__).resolve().parent
CONTEXT_PATH = HERE / "load-context.json"
RESULTS = HERE / "results"

dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql: str, params=None):
    r = rows(sql, params)
    return r[0] if r else None


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def resolve_server_log() -> Path | None:
    """Locate the uvicorn log without trusting the shell's idea of /tmp."""
    candidates = [
        Path(os.environ.get("SAHAYAK_LOAD_LOG", "")),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Temp" / "sahayak-load-uvicorn.log",
        Path(tempfile.gettempdir()) / "sahayak-load-uvicorn.log",
        Path("/tmp/sahayak-load-uvicorn.log"),
    ]
    for c in candidates:
        if str(c) and c.is_file():
            return c
    return None


def snapshot() -> dict:
    d = one(
        "SELECT deadlocks, xact_commit, xact_rollback, blks_read, "
        "       numbackends, conflicts, temp_files "
        "FROM pg_stat_database WHERE datname = current_database()"
    )
    return {
        "taken_at": datetime.now(timezone.utc).isoformat(),
        "deadlocks": int(d["deadlocks"]),
        "xact_commit": int(d["xact_commit"]),
        "xact_rollback": int(d["xact_rollback"]),
        "numbackends": int(d["numbackends"]),
        "jobs": int(one("SELECT count(*) AS n FROM jobs")["n"]),
        "assignments": int(one("SELECT count(*) AS n FROM job_assignments")["n"]),
    }


def redis_geosearch_latency(ctx: dict, n: int = 60) -> dict:
    """The Redis leg on its own, against the same key the engine searches.

    Measured after the run rather than during it. That is a real limitation and
    is stated as one: it gives the cost of the command on an unloaded Redis, which
    is the right figure for answering "is Redis the bottleneck" (it bounds Redis's
    contribution from below) but not for "what did Redis cost at peak". The
    in-handler measurement in profile_dispatch.py covers the second question.
    """
    r = sync_redis.Redis.from_url(S.REDIS_URL, decode_responses=True)
    samples = []
    for _ in range(n):
        t = time.perf_counter()
        r.geosearch(
            "sahayak:partner_locations",
            longitude=ctx["pickup"]["lng"], latitude=ctx["pickup"]["lat"],
            radius=ctx["radius_km"], unit="km", withdist=True,
        )
        samples.append((time.perf_counter() - t) * 1000)
    info = r.info("commandstats") if hasattr(r, "info") else {}
    r.close()
    geo = info.get("cmdstat_geosearch", {}) if isinstance(info, dict) else {}
    return {
        "n": n,
        "p50_ms": pct(samples, 50), "p95_ms": pct(samples, 95),
        "p99_ms": pct(samples, 99), "max_ms": max(samples),
        "server_calls_total": geo.get("calls"),
        "server_usec_per_call": geo.get("usec_per_call"),
    }


def report(scenario: str) -> None:
    ctx = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
    mark_path = RESULTS / f"mark-{scenario}.json"
    if not mark_path.exists():
        raise SystemExit(
            f"no pre-run snapshot at {mark_path.name}. The deadlock and transaction "
            f"counters are cumulative, so a run without a --mark before it cannot "
            f"be reported on. Re-run with --mark first."
        )
    before = json.loads(mark_path.read_text(encoding="utf-8"))
    after = snapshot()
    tag = f"{ctx['job_tag']} {scenario} %"

    print(f"\n=== {scenario} ===")

    # ---- volume and outcome ------------------------------------------------
    by_status = rows(
        "SELECT status, count(*) AS n FROM jobs "
        "WHERE issue_description LIKE %(tag)s GROUP BY status ORDER BY n DESC",
        {"tag": tag},
    )
    total = sum(int(r["n"]) for r in by_status)
    print(f"\njobs created           {total}")
    for r in by_status:
        print(f"  {r['status']:<20} {r['n']:>6}  {100 * int(r['n']) / max(total, 1):5.1f} %")

    window = one(
        "SELECT min(requested_at) AS first, max(requested_at) AS last "
        "FROM jobs WHERE issue_description LIKE %(tag)s",
        {"tag": tag},
    )
    span = None
    if window and window["first"] and window["last"]:
        span = (window["last"] - window["first"]).total_seconds()
        print(f"\narrival window         {span:.1f} s"
              f"   → {total / max(span, 0.001):.2f} jobs/s accepted by the server")

    # ---- dispatch latency, measured by the database's own clock ------------
    # offered_at - requested_at on the rank-1 assignment: "time from job creation
    # to first assignment offered", which is the spec's definition. This is a
    # narrower window than k6's http_req_duration — it excludes the HTTP hop and
    # the pre-dispatch lookups (token, vehicle, service) and includes only the
    # matching pipeline, so the two numbers are both reported and neither is
    # presented as the other.
    lat = [
        float(r["ms"]) for r in rows(
            "SELECT EXTRACT(EPOCH FROM (a.offered_at - j.requested_at)) * 1000 AS ms "
            "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
            "WHERE j.issue_description LIKE %(tag)s AND a.assignment_rank = 1",
            {"tag": tag},
        ) if r["ms"] is not None
    ]
    if lat:
        print(f"\ndispatch latency, DB clock, rank-1 offer (n={len(lat)})")
        print(f"  p50 {pct(lat, 50):8.1f} ms    p95 {pct(lat, 95):8.1f} ms"
              f"    p99 {pct(lat, 99):8.1f} ms    max {max(lat):8.1f} ms")
    else:
        print("\ndispatch latency       no rank-1 assignments to measure")

    # ---- matching accuracy vs the naive baseline ---------------------------
    acc = one(
        "SELECT count(*) AS n, "
        "       count(*) FILTER (WHERE a.was_baseline_choice) AS agreed "
        "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(tag)s AND a.assignment_rank = 1",
        {"tag": tag},
    )
    n_rank1 = int(acc["n"] or 0)
    agreed = int(acc["agreed"] or 0)
    if n_rank1:
        print(f"\nmatching vs pure-nearest baseline (rank-1 offers, n={n_rank1})")
        print(f"  engine differed from nearest   {n_rank1 - agreed:>6}"
              f"   {100 * (n_rank1 - agreed) / n_rank1:5.1f} %")
        print(f"  engine agreed with nearest     {agreed:>6}"
              f"   {100 * agreed / n_rank1:5.1f} %")

    # ---- who actually got the work ----------------------------------------
    spread = rows(
        "SELECT a.partner_id::text AS pid, count(*) AS n, "
        "       round(avg(a.distance_at_offer_m)::numeric, 0) AS avg_m, "
        "       round(avg(a.matching_score)::numeric, 4) AS avg_score "
        "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(tag)s AND a.assignment_rank = 1 "
        "GROUP BY a.partner_id ORDER BY n DESC",
        {"tag": tag},
    )
    by_id = {p["id"]: p for p in ctx["partners"]}
    if spread:
        print(f"\nrank-1 offers by partner ({len(spread)} of "
              f"{sum(1 for p in ctx['partners'] if p['eligible'])} eligible received work)")
        for r in spread:
            p = by_id.get(r["pid"], {})
            print(f"  {p.get('label','?'):<5} {int(r['n']):>6}  "
                  f"{100 * int(r['n']) / max(n_rank1, 1):5.1f} %   "
                  f"seeded {p.get('intended_km', 0):>4.1f} km / "
                  f"rating {p.get('rating_avg', 0):.2f}·{p.get('rating_count', 0):<2}   "
                  f"avg offered at {int(r['avg_m'] or 0):>5} m   score {r['avg_score']}")

    # ---- correctness under load -------------------------------------------
    out_of_radius = [p["id"] for p in ctx["partners"] if not p["in_radius"]]
    wrong_service = [p["id"] for p in ctx["partners"]
                     if not p["offers_service"] and p["in_radius"]]
    breach_radius = one(
        "SELECT count(*) AS n FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(tag)s AND a.partner_id::text = ANY(%(ids)s)",
        {"tag": tag, "ids": out_of_radius},
    )
    breach_service = one(
        "SELECT count(*) AS n FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(tag)s AND a.partner_id::text = ANY(%(ids)s)",
        {"tag": tag, "ids": wrong_service},
    )
    over_cap = rows(
        "SELECT a.partner_id::text AS pid, count(*) AS n "
        "FROM job_assignments a JOIN jobs j ON j.id = a.job_id "
        "WHERE a.status = 'accepted' "
        "  AND j.status IN ('assigned','partner_en_route','in_progress') "
        "GROUP BY a.partner_id HAVING count(*) > 2"
    )
    orphan_offers = one(
        "SELECT count(*) AS n FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(tag)s "
        "  AND j.status = 'cancelled' AND a.status = 'accepted'",
        {"tag": tag},
    )
    print("\ninvariants")
    print(f"  offers to a partner outside the 10 km radius   {breach_radius['n']}"
          f"   (must be 0)")
    print(f"  offers to a partner not offering the service   {breach_service['n']}"
          f"   (must be 0)")
    print(f"  partners holding more than MAX_CONCURRENT_JOBS {len(over_cap)}"
          f"   (must be 0)")
    print(f"  accepted assignment on a cancelled job         {orphan_offers['n']}"
          f"   (must be 0 — the Task M/N race)")

    # ---- contention --------------------------------------------------------
    print("\ncontention (deltas across the run, not absolute counters)")
    print(f"  deadlocks                {after['deadlocks'] - before['deadlocks']:>8}"
          f"   (absolute now {after['deadlocks']})")
    print(f"  transactions committed   {after['xact_commit'] - before['xact_commit']:>8}")
    print(f"  transactions rolled back {after['xact_rollback'] - before['xact_rollback']:>8}")
    print(f"  backends now / max       {after['numbackends']:>8} / "
          f"{one('SHOW max_connections')['max_connections']}")

    # ---- Redis in isolation ------------------------------------------------
    geo = redis_geosearch_latency(ctx)
    print(f"\nRedis GEOSEARCH in isolation (n={geo['n']}, post-run, unloaded)")
    print(f"  p50 {geo['p50_ms']:.2f} ms   p95 {geo['p95_ms']:.2f} ms   "
          f"p99 {geo['p99_ms']:.2f} ms   max {geo['max_ms']:.2f} ms")
    if geo["server_usec_per_call"] is not None:
        print(f"  Redis-side mean {float(geo['server_usec_per_call']) / 1000:.3f} ms "
              f"over {geo['server_calls_total']} calls since server start")

    # ---- what the server itself reported, from its own log -----------------
    # The log path is resolved rather than hard-coded as "/tmp/...". Under Git
    # Bash on Windows /tmp is a mount alias for %LOCALAPPDATA%\Temp, but Python
    # resolves the same string to C:\tmp, which does not exist. The first version
    # of this function read the literal "/tmp/..." path, found nothing, and
    # printed "0 connection-pool complaints" — a clean-looking zero produced by
    # reading the wrong file. A metric that reports "no problems" when its input
    # is missing is worse than one that errors, so a missing log is now loud.
    log = resolve_server_log()
    codes: dict = {}
    unhandled: dict = {}
    pool_hits = 0
    if log is None:
        print("\n! server log not found — error taxonomy unavailable for this run")
    else:
        since = before["taken_at"][:19]
        # The log interleaves two kinds of line: structlog JSON, and raw Python
        # tracebacks printed by uvicorn. The exhaustion messages worth counting
        # live in the *tracebacks*, which carry no "timestamp" field — so the scan
        # cannot filter every line on its own timestamp. Instead it carries the
        # last timestamp it saw forward, which works because the log is written
        # chronologically, and lets a traceback be attributed to the run that
        # produced it.
        in_window = False
        with log.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"timestamp"' in line:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        d = None
                    if d is not None:
                        in_window = d.get("timestamp", "") >= since
                        if in_window:
                            if d.get("event") == "http_request":
                                c = d.get("status_code")
                                codes[c] = codes.get(c, 0) + 1
                            elif d.get("event") == "unhandled_exception":
                                k = d.get("error_type", "?")
                                unhandled[k] = unhandled.get(k, 0) + 1
                        continue
                if not in_window:
                    continue
                # Two distinct exhaustion ceilings exist here and they word
                # themselves differently. SQLAlchemy's own pool says "QueuePool
                # limit ... connection timed out"; Supabase's Supavisor pooler says
                # "(EMAXCONNSESSION) max clients reached in session mode". Only the
                # first was listed originally, so the mixed run — whose failures were
                # almost entirely the *pooler* limit — reported "0 pool-exhaustion
                # messages": a third reassuring zero from looking for a string that
                # was never going to be there.
                for needle in ("QueuePool limit", "connection timed out",
                               "too many connections", "EMAXCONNSESSION",
                               "max clients reached"):
                    if needle in line:
                        pool_hits += 1
                        break

        print(f"\nwhat the server returned (its own log, since the --mark)")
        for c, n in sorted(codes.items(), key=lambda kv: -kv[1]):
            print(f"  HTTP {c}   {n:>6}")
        print(f"  responses emitted in total  {sum(codes.values()):>6}")
        if unhandled:
            print("  requests that produced no response at all:")
            for k, n in sorted(unhandled.items(), key=lambda kv: -kv[1]):
                print(f"    {n:>6}  unhandled {k}")
        print(f"  connection-ceiling messages {pool_hits:>6}"
              f"   (app QueuePool + Supavisor EMAXCONNSESSION)")

    out = {
        "scenario": scenario,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "jobs_total": total,
        "jobs_by_status": {r["status"]: int(r["n"]) for r in by_status},
        "arrival_window_s": span,
        "accepted_per_s": (total / span) if span else None,
        "dispatch_latency_db_ms": {
            "n": len(lat), "p50": pct(lat, 50), "p95": pct(lat, 95),
            "p99": pct(lat, 99), "max": max(lat) if lat else None,
        },
        "matching": {
            "rank1": n_rank1, "agreed_with_nearest": agreed,
            "differed_from_nearest": n_rank1 - agreed,
            "differed_pct": (100 * (n_rank1 - agreed) / n_rank1) if n_rank1 else None,
        },
        "partner_spread": [
            {"label": by_id.get(r["pid"], {}).get("label"), "offers": int(r["n"]),
             "seeded_km": by_id.get(r["pid"], {}).get("intended_km"),
             "avg_offered_m": int(r["avg_m"] or 0), "avg_score": float(r["avg_score"] or 0)}
            for r in spread
        ],
        "invariants": {
            "offers_outside_radius": int(breach_radius["n"]),
            "offers_wrong_service": int(breach_service["n"]),
            "partners_over_capacity": len(over_cap),
            "accepted_on_cancelled_job": int(orphan_offers["n"]),
        },
        "contention": {
            "deadlock_delta": after["deadlocks"] - before["deadlocks"],
            "deadlocks_absolute": after["deadlocks"],
            "xact_commit_delta": after["xact_commit"] - before["xact_commit"],
            "xact_rollback_delta": after["xact_rollback"] - before["xact_rollback"],
        },
        "redis_geosearch": geo,
        "server_log": {
            "path": str(log) if log else None,
            "status_codes": {str(k): v for k, v in codes.items()},
            "unhandled_exceptions": unhandled,
            "pool_exhaustion_messages": pool_hits,
        },
        "before": before, "after": after,
    }
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"collected-{scenario}.json"
    path.write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    print(f"\nwrote {path.relative_to(HERE.parents[1])}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mark", metavar="SCENARIO", help="snapshot counters before a run")
    ap.add_argument("--report", metavar="SCENARIO", help="analyse a completed run")
    args = ap.parse_args()

    RESULTS.mkdir(exist_ok=True)
    if args.mark:
        snap = snapshot()
        (RESULTS / f"mark-{args.mark}.json").write_text(
            json.dumps(snap, indent=1), encoding="utf-8")
        print(f"marked {args.mark}: deadlocks={snap['deadlocks']} "
              f"jobs={snap['jobs']} assignments={snap['assignments']}")
    elif args.report:
        report(args.report)
    else:
        ap.error("pass --mark SCENARIO or --report SCENARIO")


if __name__ == "__main__":
    main()
