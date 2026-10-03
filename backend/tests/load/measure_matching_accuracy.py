"""
Matching accuracy vs the naive nearest-partner baseline, measured as a controlled
two-arm experiment.

    python tests/load/measure_matching_accuracy.py --arm rating-live
    python tests/load/measure_matching_accuracy.py --arm rating-blind
    python tests/load/measure_matching_accuracy.py --both        # runs A then B

WHY THIS EXISTS SEPARATELY FROM collect_dispatch_load.py
--------------------------------------------------------
collect_dispatch_load.py reports divergence from whatever run just happened. That
is the right tool for "what did the system do under load" and the wrong one for
"what does the rating dimension contribute", because a saturating k6 run varies
three things at once: distance (jittered pickup), load (responders accepting and
completing), and rating (seeded). A divergence figure from that run cannot be
attributed to any one term.

This script holds two of the three still. It creates jobs sequentially at a rate
the pool serves cleanly, and runs no responders at all — so no partner ever
reaches `accepted`, every partner's active_job_count stays 0, and load_score is a
constant 1.0 for the whole run. skill_score is already constant by construction
(find_candidates only returns exact-service matches). That leaves distance and
rating as the only varying terms, and the two arms differ in exactly one of them.

WHAT THE TWO ARMS ARE
---------------------
  rating-live    partners keep the ratings seed_dispatch_load.py gave them: a
                 deliberate spread in which the *nearest* partner (p01, 0.5 km)
                 is rated 3.10 from 4 reviews and is labelled "the trap" in the
                 fixture, while p02 at 0.9 km holds 4.80 from 55.

  rating-blind   every QA partner is set to rating_avg 0.0, rating_count 0 for
                 the duration and restored afterwards. This is not a synthetic
                 condition: it is what every row in `partners` actually held
                 until 2026-09-29, because the trigger meant to maintain those
                 columns could never fire (ADR-018). It is what production
                 scoring really did, and it had never been measured.

The prediction the code makes for rating-blind is strong and worth stating before
the run rather than after: rating_score(0.0, 0) is PRIOR_MEAN / MAX_RATING = 0.7
for every candidate, so with load and skill also constant the only term left that
varies is distance_score, which is monotonically decreasing in distance. argmax of
the weighted score is then necessarily argmin of distance — the same partner
`baseline_pick` returns. Divergence must be exactly 0.0 %. If it is not, either
the arm did not apply or something else in the pipeline is not what this file
claims, and the number is a bug report rather than a measurement.

WHAT THIS DOES NOT MEASURE
--------------------------
Throughput, latency and failure rate. Those come from the k6 runs and are
unchanged by this script, which deliberately runs far below the ceiling so that a
queue timeout cannot silently drop a job out of the denominator.

SAFETY
------
Reads the fixture from load-context.json; never creates or deletes a partner or
owner. It writes to `partners.rating_avg` / `rating_count` for the blind arm and
restores the exact prior values from a snapshot in a `finally` block, so a crash
mid-run does not leave the fixture altered. Its own jobs are tagged with a
per-run id and purged at the end unless --keep is passed.
"""
import argparse
import json
import math
import random
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import httpx
import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.config.settings import get_settings  # noqa: E402
from app.utils.scoring import (  # noqa: E402
    MAX_RATING,
    PRIOR_MEAN,
    W_DISTANCE,
    W_LOAD,
    W_RATING,
    W_SKILL,
)

S = get_settings()

CONTEXT_PATH = Path(__file__).resolve().parent / "load-context.json"
RESULTS_DIR = Path(__file__).resolve().parent / "results"

KM_PER_DEG_LAT = 111.32

ARMS = ("rating-live", "rating-blind")

dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def db():
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def rows(conn, sql, params=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params or {})
        return cur.fetchall()


def one(conn, sql, params=None):
    got = rows(conn, sql, params)
    return got[0] if got else None


def exec_sql(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params or {})


def pct(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return ordered[int(k)]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def jittered_pickup(ctx, rng):
    """Same geometry k6 uses, so the two tools' job sets are comparable."""
    r = ctx["jitter_km"] * math.sqrt(rng.random())
    bearing = rng.random() * 2 * math.pi
    lat = ctx["pickup"]["lat"] + (r * math.cos(bearing)) / KM_PER_DEG_LAT
    lng = ctx["pickup"]["lng"] + (r * math.sin(bearing)) / (
        KM_PER_DEG_LAT * math.cos(math.radians(ctx["pickup"]["lat"]))
    )
    return lat, lng


# --------------------------------------------------------------- the two arms
def snapshot_ratings(conn, partner_ids):
    got = rows(
        conn,
        "SELECT id::text AS id, rating_avg, rating_count FROM partners "
        "WHERE id::text = ANY(%(ids)s)",
        {"ids": partner_ids},
    )
    return {r["id"]: (r["rating_avg"], r["rating_count"]) for r in got}


def apply_blind(conn, partner_ids):
    exec_sql(
        conn,
        "UPDATE partners SET rating_avg = 0.0, rating_count = 0 "
        "WHERE id::text = ANY(%(ids)s)",
        {"ids": partner_ids},
    )


def restore_ratings(conn, snap):
    for pid, (avg, cnt) in snap.items():
        exec_sql(
            conn,
            "UPDATE partners SET rating_avg = %(avg)s, rating_count = %(cnt)s "
            "WHERE id = %(pid)s",
            {"avg": avg, "cnt": cnt, "pid": pid},
        )


# ------------------------------------------------------------------ the run
def create_jobs(ctx, tag, n, rate, rng):
    """Create n jobs sequentially at `rate` per second over real HTTP."""
    owners = ctx["owners"]
    interval = 1.0 / rate if rate > 0 else 0.0
    created, failed = 0, []
    t0 = time.perf_counter()

    with httpx.Client(base_url=ctx["base_url"], timeout=60.0) as c:
        for i in range(n):
            owner = owners[i % len(owners)]
            lat, lng = jittered_pickup(ctx, rng)
            body = {
                "vehicle_id": owner["vehicle_id"],
                "service_code": ctx["service_code"],
                "pickup_lat": lat,
                "pickup_lng": lng,
                "pickup_address_text": "CG Road, Ahmedabad",
                "issue_description": f"{tag} i{i:04d}",
            }
            try:
                r = c.post(
                    "/api/v1/jobs",
                    json=body,
                    headers={"Authorization": f"Bearer {owner['token']}"},
                )
                if r.status_code == 201:
                    created += 1
                else:
                    failed.append((i, r.status_code, r.text[:160]))
            except Exception as exc:  # noqa: BLE001
                failed.append((i, "exc", repr(exc)[:160]))

            target = t0 + (i + 1) * interval
            slack = target - time.perf_counter()
            if slack > 0:
                time.sleep(slack)

    return created, failed, time.perf_counter() - t0


def analyse(conn, ctx, tag):
    """Everything this experiment claims, read back from what was stored."""
    like = tag + "%"
    by_id = {p["id"]: p for p in ctx["partners"]}
    nearest_label = min(
        (p for p in ctx["partners"] if p["eligible"]), key=lambda p: p["intended_km"]
    )["label"]

    base = one(
        conn,
        "SELECT count(*) AS n, "
        "       count(*) FILTER (WHERE a.was_baseline_choice) AS agreed "
        "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(t)s AND a.assignment_rank = 1",
        {"t": like},
    )
    n = int(base["n"] or 0)
    agreed = int(base["agreed"] or 0)

    # Unmatched jobs are excluded from the accuracy denominator and reported
    # separately — a job nobody could serve is not a ranking decision, and
    # folding it in would move the rate without the engine having chosen
    # anything. Same exclusion the load-test report applies at §4.1.
    unmatched = one(
        conn,
        "SELECT count(*) AS n FROM jobs j WHERE j.issue_description LIKE %(t)s "
        "AND j.status = 'no_match_found'",
        {"t": like},
    )

    winners = rows(
        conn,
        "SELECT a.partner_id::text AS pid, count(*) AS n "
        "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(t)s AND a.assignment_rank = 1 "
        "GROUP BY a.partner_id ORDER BY n DESC",
        {"t": like},
    )

    comps = rows(
        conn,
        "SELECT a.matching_score, a.score_components, a.distance_at_offer_m "
        "FROM jobs j JOIN job_assignments a ON a.job_id = j.id "
        "WHERE j.issue_description LIKE %(t)s AND a.assignment_rank = 1 "
        "AND a.score_components IS NOT NULL",
        {"t": like},
    )
    ratings = [float(r["score_components"]["rating_score"]) for r in comps]
    loads = [float(r["score_components"]["load_score"]) for r in comps]

    return {
        "n_rank1": n,
        "agreed": agreed,
        "differed": n - agreed,
        "divergence_pct": (100.0 * (n - agreed) / n) if n else 0.0,
        "unmatched": int(unmatched["n"] or 0),
        "nearest_label": nearest_label,
        "winners": [
            {
                "label": by_id.get(w["pid"], {}).get("label", "?"),
                "n": int(w["n"]),
                "share_pct": 100.0 * int(w["n"]) / max(n, 1),
                "km": by_id.get(w["pid"], {}).get("intended_km"),
                "rating_avg": by_id.get(w["pid"], {}).get("rating_avg"),
                "rating_count": by_id.get(w["pid"], {}).get("rating_count"),
            }
            for w in winners
        ],
        "rating_score_min": min(ratings) if ratings else None,
        "rating_score_max": max(ratings) if ratings else None,
        "rating_score_distinct": len({round(x, 6) for x in ratings}),
        "load_score_distinct": len({round(x, 6) for x in loads}),
        "matching_score_p50": pct([float(r["matching_score"]) for r in comps], 50),
        "distance_p50_m": pct([float(r["distance_at_offer_m"]) for r in comps], 50),
    }


def purge(conn, tag):
    like = tag + "%"
    exec_sql(
        conn,
        "DELETE FROM job_assignments WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(t)s)",
        {"t": like},
    )
    exec_sql(
        conn,
        "DELETE FROM job_status_history WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(t)s)",
        {"t": like},
    )
    exec_sql(conn, "DELETE FROM jobs WHERE issue_description LIKE %(t)s", {"t": like})


def run_arm(conn, ctx, arm, n, rate, seed, keep):
    run_id = uuid.uuid4().hex[:6]
    tag = f"{ctx['job_tag']} ACC-{arm}-{run_id}"
    rng = random.Random(seed)
    eligible_ids = [p["id"] for p in ctx["partners"] if p["eligible"]]
    all_ids = [p["id"] for p in ctx["partners"]]

    print(f"\n{'=' * 72}")
    print(f"ARM: {arm}    jobs={n}  rate={rate}/s  seed={seed}  tag={tag!r}")
    print("=" * 72)

    snap = snapshot_ratings(conn, all_ids)
    try:
        if arm == "rating-blind":
            apply_blind(conn, all_ids)
            check = one(
                conn,
                "SELECT count(*) AS n FROM partners WHERE id::text = ANY(%(ids)s) "
                "AND (rating_avg <> 0 OR rating_count <> 0)",
                {"ids": all_ids},
            )
            print(f"  ratings zeroed; rows still carrying a rating: {check['n']}")
            assert int(check["n"]) == 0, "blind arm did not apply"
        else:
            spread = sorted(
                (p["rating_avg"], p["rating_count"], p["label"])
                for p in ctx["partners"]
                if p["eligible"]
            )
            print(f"  seeded ratings in play across {len(spread)} eligible partners: "
                  f"{spread[0][0]:.2f}/{spread[0][1]} … {spread[-1][0]:.2f}/{spread[-1][1]}")

        created, failed, elapsed = create_jobs(ctx, tag, n, rate, rng)
        print(f"  created {created}/{n} jobs in {elapsed:.1f}s "
              f"({created / max(elapsed, 1e-9):.2f}/s achieved)")
        if failed:
            print(f"  !! {len(failed)} creations failed — first: {failed[0]}")

        # The dispatch write happens inside the request, so a 201 means the
        # assignment row is already there. Brief settle only for the last one.
        time.sleep(1.5)
        result = analyse(conn, ctx, tag)
        result.update(
            {"arm": arm, "tag": tag, "created": created, "requested": n,
             "failed": len(failed), "rate_target": rate, "seed": seed,
             "elapsed_s": round(elapsed, 2), "eligible_pool": len(eligible_ids)}
        )
        report(result)
        return result
    finally:
        restore_ratings(conn, snap)
        after = snapshot_ratings(conn, all_ids)
        assert after == snap, "rating restore did not round-trip"
        print("  fixture ratings restored and verified")
        if not keep:
            purge(conn, tag)
            left = one(
                conn,
                "SELECT count(*) AS n FROM jobs WHERE issue_description LIKE %(t)s",
                {"t": tag + "%"},
            )
            print(f"  purged this arm's jobs; remaining: {left['n']}")


def report(r):
    print(f"\n  matching vs pure-nearest baseline (rank-1 offers, n={r['n_rank1']})")
    print(f"    engine differed from nearest   {r['differed']:>6}   {r['divergence_pct']:5.1f} %")
    print(f"    engine agreed with nearest     {r['agreed']:>6}   "
          f"{100 - r['divergence_pct']:5.1f} %")
    if r["unmatched"]:
        print(f"    excluded, no candidate at all  {r['unmatched']:>6}")
    print(f"\n  score component variance across those offers")
    print(f"    rating_score  distinct values {r['rating_score_distinct']:>3}   "
          f"range {r['rating_score_min']} … {r['rating_score_max']}")
    print(f"    load_score    distinct values {r['load_score_distinct']:>3}   "
          f"(1 means no partner was ever busy — held still on purpose)")
    print(f"    matching_score p50 {r['matching_score_p50']:.4f}   "
          f"offered at p50 {r['distance_p50_m']:.0f} m")
    print(f"\n  who won the work (nearest eligible partner is "
          f"{r['nearest_label']})")
    for w in r["winners"]:
        print(f"    {w['label']:<5} {w['n']:>5}  {w['share_pct']:5.1f} %   "
              f"seeded {w['km']:>4.1f} km / rating {w['rating_avg']:.2f}·{w['rating_count']}")


def compare(a, b):
    """a = rating-live, b = rating-blind."""
    print(f"\n{'=' * 72}")
    print("SIDE BY SIDE")
    print("=" * 72)
    print(f"  {'':<34}{'rating-live':>16}{'rating-blind':>16}")
    print(f"  {'rank-1 offers measured':<34}{a['n_rank1']:>16}{b['n_rank1']:>16}")
    print(f"  {'differed from pure-nearest':<34}{a['differed']:>16}{b['differed']:>16}")
    print(f"  {'divergence rate':<34}{a['divergence_pct']:>15.1f}%{b['divergence_pct']:>15.1f}%")
    print(f"  {'distinct rating_score values':<34}"
          f"{a['rating_score_distinct']:>16}{b['rating_score_distinct']:>16}")
    print(f"  {'distinct load_score values':<34}"
          f"{a['load_score_distinct']:>16}{b['load_score_distinct']:>16}")
    print()
    print(f"  weights in force: distance {W_DISTANCE} / load {W_LOAD} / "
          f"skill {W_SKILL} / rating {W_RATING}")
    print(f"  unrated partner rating_score = {PRIOR_MEAN}/{MAX_RATING} = "
          f"{PRIOR_MEAN / MAX_RATING}")
    blind_ok = b["divergence_pct"] == 0.0 and b["rating_score_distinct"] == 1
    print(f"\n  prediction: rating-blind divergence is exactly 0.0 % — "
          f"{'CONFIRMED' if blind_ok else 'NOT CONFIRMED, investigate'}")
    if a["n_rank1"] and b["n_rank1"]:
        print(f"  the rating dimension is worth {a['divergence_pct'] - b['divergence_pct']:.1f} "
              f"percentage points of divergence from a pure distance sort,")
        print("  holding load and skill constant.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", choices=ARMS, help="run a single arm")
    ap.add_argument("--both", action="store_true",
                    help="run rating-live then rating-blind and compare")
    ap.add_argument("--jobs", type=int, default=60)
    ap.add_argument("--rate", type=float, default=2.0,
                    help="creations per second; 2.0 is the measured clean ceiling")
    ap.add_argument("--seed", type=int, default=20260930,
                    help="same seed in both arms so the pickup jitter is identical")
    ap.add_argument("--keep", action="store_true", help="leave the jobs in place")
    args = ap.parse_args()

    if not args.arm and not args.both:
        ap.error("pass --arm or --both")
    if not CONTEXT_PATH.exists():
        print(f"!! {CONTEXT_PATH.name} missing — run seed_dispatch_load.py first")
        return 2

    ctx = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
    conn = db()
    print(f"matching-accuracy experiment   {datetime.now(timezone.utc).isoformat()}")
    print(f"fixture generated {ctx['generated_at']}   "
          f"eligible pool {sum(1 for p in ctx['partners'] if p['eligible'])}")

    results = []
    try:
        arms = ARMS if args.both else (args.arm,)
        for arm in arms:
            results.append(
                run_arm(conn, ctx, arm, args.jobs, args.rate, args.seed, args.keep)
            )
        if len(results) == 2:
            compare(results[0], results[1])
    finally:
        conn.close()

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"matching-accuracy-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    out.write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    print(f"\nwrote {out.relative_to(Path(__file__).resolve().parents[2])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
