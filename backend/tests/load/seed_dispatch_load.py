"""Seed the fixed dataset the dispatch load test runs against.

    python tests/load/seed_dispatch_load.py            # build the dataset
    python tests/load/seed_dispatch_load.py --refresh   # re-mint tokens only
    python tests/load/seed_dispatch_load.py --purge     # tear it all down

Not named test_*.py, same as the integration harnesses: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

Three things make this different from tests/integration/check_dispatch_flow.py,
and each one is forced by what a load test is:

  * **The server is a real process, over a real socket.** The integration
    harnesses drive the app in-process through ASGITransport, which is right for
    them — no port to collide with — but it also means a single Python event loop
    is doing both the requesting and the serving. That measures nothing useful
    about concurrency. Here the app runs under uvicorn on :8010 and every request
    crosses a TCP connection, so the connection pool, the socket accept queue and
    the GIL are all in the measurement.

  * **Redis is real.** fakeredis is defensible for asserting geohash maths; it is
    not defensible for reporting GEOSEARCH latency, which is the number this test
    exists to isolate. A fake would report the cost of a Python dict lookup and
    call it Redis.

  * **The dataset is fixed and re-usable.** The integration harnesses build and
    destroy their world inside one run. This one persists it and writes a context
    file, because the three load scenarios must run against *identical* candidate
    pools or their latency numbers cannot be compared to each other.

WHAT THE PLACEMENT IS FOR
-------------------------
18 partners at measured distances from one pickup point, of which:

  * 14 fall inside the 10 km dispatch radius, 4 outside it. The four outside are
    given the *best* ratings in the fleet on purpose — if the radius filter ever
    broke, they would immediately dominate the ranking and the collector's "no
    partner beyond 10 km was ever offered" check would fail loudly instead of the
    breakage hiding inside an aggregate.

  * 3 of the 14 inside do not offer the load test's service at all. Same logic
    one layer down: it puts the `partner_services` eligibility filter under load
    rather than trusting it, and one of the three is close enough to the pickup
    point that it would win often if the filter stopped working.

So the eligible candidate pool is 11 partners. That number matters twice over:
with MAX_CONCURRENT_JOBS = 2 it also fixes the fleet's theoretical ceiling at 22
simultaneously-held jobs, which is the capacity figure the report quotes.

Ratings run from "no ratings at all" to 4.95 with 40 reviews, and they are
interleaved with distance rather than correlated with it — the nearest partner is
one of the worst rated. Without that the weighted score and the pure-nearest
baseline would agree on every single job and the matching-accuracy metric would
be a constant, which measures the dataset rather than the algorithm.

CREDENTIALS
-----------
The context file holds live access tokens and the throwaway passwords behind
them, so it is gitignored and nothing here prints a token or a password — only
character counts. The accounts are on a .invalid domain that can never receive
mail and are deleted by --purge.
"""
import argparse
import json
import math
import sys
import time
import uuid
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
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

BASE_URL = "http://127.0.0.1:8010"

# Its own namespace, so it can never collide with a sibling harness. The phone
# block is distinct from every other QA harness's (901-903, 96x) and so is the
# domain and the job tag.
QA_DOMAIN = "sahayak-loadqa.invalid"
PARTNER_PHONE_BASE = 970          # +9190000097x .. +9190000098x
OWNER_PHONE_BASE = 940            # +9190000094x
JOB_TAG = "LOAD-QA"

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False
SERVICE_ID = 3
OTHER_SERVICES = ["flat_tyre", "minor_repair", "fuel_delivery"]

# Ahmedabad, near CG Road — the same pickup point the integration harness uses,
# so distances quoted in one file mean the same thing in the other.
PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600

# The load generator jitters each job's pickup point inside this radius. It is
# what the spec means by "roughly the same pickup area": identical coordinates on
# every request would freeze the distance ordering, so the nearest partner would
# be the same partner 1200 times and the baseline comparison would have nothing
# to vary. 600 m is small enough that the candidate pool barely changes and large
# enough to reshuffle the close-in ranking.
JITTER_KM = 0.6

RADIUS_KM = 10.0
KM_PER_DEG_LAT = 111.32

OWNER_COUNT = 8

# (label, distance_km, bearing_deg, rating_avg, rating_count, offers_the_service)
#
# Bearings are spread by the golden angle (137.5°) so no two partners sit on the
# same line out of the pickup point — a fleet strung along one bearing would make
# the jitter above push every partner nearer or further together, which is not
# how a city looks.
PLACEMENTS: list[tuple[str, float, float, float, int, bool]] = [
    ("p01",  0.5,   0.0, 3.10,  4, True),    # nearest, and badly rated: the trap
    ("p02",  0.9, 137.5, 4.80, 55, True),    # usually the engine's actual pick
    ("p03",  1.3, 275.0, 3.60, 30, False),   # close, and NOT eligible on service
    ("p04",  1.8,  52.5, 4.90, 80, True),
    ("p05",  2.4, 190.0, 3.00,  2, True),
    ("p06",  3.1, 327.5, 4.40, 18, True),
    ("p07",  3.9, 105.0, 4.95, 40, True),
    ("p08",  4.6, 242.5, 3.30,  9, False),   # mid-field service exclusion
    ("p09",  5.4,  20.0, 4.70, 25, True),
    ("p10",  6.2, 157.5, 3.80,  6, True),
    ("p11",  7.1, 295.0, 4.60, 70, True),
    ("p12",  8.0,  72.5, 3.40, 15, True),
    ("p13",  9.0, 210.0, 4.90, 33, False),   # far-field service exclusion
    ("p14",  9.7, 347.5, 4.20,  0, True),    # no ratings at all — prior only
    ("p15", 10.6, 125.0, 5.00, 50, True),    # --- outside the radius from here
    ("p16", 11.2, 262.5, 4.90, 44, True),
    ("p17", 11.7,  40.0, 5.00, 90, True),
    ("p18", 12.0, 177.5, 4.80, 60, True),
]

CONTEXT_PATH = Path(__file__).resolve().parent / "load-context.json"

dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True

TABLES = (
    "users", "vehicles", "partners", "partner_services",
    "jobs", "job_status_history", "job_assignments",
)


def counts() -> dict:
    q = conn.cursor()
    return {t: (q.execute(f"SELECT count(*) FROM {t}"), q.fetchone()[0])[1] for t in TABLES}


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def exec_sql(sql: str, params=None) -> None:
    q = conn.cursor()
    q.execute(sql, params or {})


def partner_phones() -> list[str]:
    return [f"+91900000{PARTNER_PHONE_BASE + i}" for i in range(len(PLACEMENTS))]


def owner_phones() -> list[str]:
    return [f"+91900000{OWNER_PHONE_BASE + i}" for i in range(OWNER_COUNT)]


# --------------------------------------------------------------------------
# Supabase. Retries only httpx.TransportError — a 4xx is an answer and must not
# be retried, but a dropped connection to a cloud endpoint mid-seed is noise.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}",
                  "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=30.0)


def _supa_call(method: str, url: str, **kw) -> httpx.Response:
    last = None
    for attempt in range(4):
        try:
            return _supa.request(method, url, **kw)
        except httpx.TransportError as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"Supabase unreachable after 4 attempts: {last!r}")


def purge_supabase_accounts() -> None:
    r = _supa_call("GET", "/auth/v1/admin/users",
                   headers=_admin_headers, params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    removed = 0
    for u in r.json().get("users", []):
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)
            removed += 1
    if removed:
        print(f"  removed {removed} leftover Supabase QA account(s)")


def supabase_identity(label: str) -> dict:
    """Create a real Supabase account and sign in.

    Returns the id, the email, the password and the access token. The password is
    kept so --refresh can re-mint an expired token an hour later without
    rebuilding the whole dataset; a load run plus its analysis outlives a
    Supabase access token, and a fleet of silent 401s would look exactly like a
    latency cliff.
    """
    email = f"loadqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa_call("POST", "/auth/v1/admin/users", headers=_admin_headers,
                   json={"email": email, "password": password, "email_confirm": True})
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]
    return {"auth_user_id": uid, "email": email, "password": password,
            "token": sign_in(email, password)}


def sign_in(email: str, password: str) -> str:
    r = _supa_call("POST", "/auth/v1/token", params={"grant_type": "password"},
                   headers={"apikey": PUB, "Content-Type": "application/json"},
                   json={"email": email, "password": password})
    if r.status_code != 200:
        raise SystemExit(f"could not sign in as {email}: {r.status_code} {r.text[:300]}")
    return r.json()["access_token"]


# --------------------------------------------------------------------------
# Geo
# --------------------------------------------------------------------------
def offset(lat: float, lng: float, km: float, bearing_deg: float) -> tuple[float, float]:
    """Move a point km kilometres along a bearing.

    Flat-earth approximation with the cos(lat) correction on longitude, which is
    accurate to well under 1% at these distances. The correction is the part that
    matters: dropping it puts a partner ~8% nearer than intended at this latitude,
    which is the difference between inside and outside a 10 km radius for the ones
    placed near the edge.
    """
    rad = math.radians(bearing_deg)
    d_lat = (km * math.cos(rad)) / KM_PER_DEG_LAT
    d_lng = (km * math.sin(rad)) / (KM_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + d_lat, lng + d_lng


# --------------------------------------------------------------------------
# Teardown
# --------------------------------------------------------------------------
def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by this harness's own phone block, auth domain and job tag — never by
    "rows created recently". A cleanup that works by timestamp deletes something
    real the first time it runs on a day somebody was using the app.
    """
    pphones = partner_phones()
    ophones = owner_phones()

    # Jobs first: they are reachable both by tag and by owner, and both routes
    # are used because a job whose issue_description was truncated or rewritten
    # would otherwise survive the tag sweep.
    job_filter = (
        "SELECT id FROM jobs WHERE issue_description LIKE %(tag)s "
        "   OR user_id IN (SELECT id FROM users WHERE phone = ANY(%(ophones)s))"
    )
    p = {"tag": JOB_TAG + "%", "ophones": ophones}
    exec_sql(f"DELETE FROM job_status_history WHERE job_id IN ({job_filter})", p)
    exec_sql(f"DELETE FROM job_assignments WHERE job_id IN ({job_filter})", p)
    exec_sql(f"DELETE FROM jobs WHERE id IN ({job_filter})", p)

    exec_sql(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = ANY(%(pphones)s))",
        {"pphones": pphones},
    )
    exec_sql(
        "DELETE FROM partner_services WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = ANY(%(pphones)s))",
        {"pphones": pphones},
    )
    exec_sql("DELETE FROM partners WHERE phone = ANY(%(pphones)s)", {"pphones": pphones})
    exec_sql(
        "DELETE FROM vehicles WHERE user_id IN "
        "(SELECT id FROM users WHERE phone = ANY(%(ophones)s))",
        {"ophones": ophones},
    )
    exec_sql("DELETE FROM users WHERE phone = ANY(%(ophones)s)", {"ophones": ophones})


def purge_redis() -> None:
    """Drop the seeded pins out of the live GEO set.

    Only this harness's members, by id — ZREM of specific members rather than a
    DEL of the key, because the key is shared with whatever else has reported a
    location and a load test has no business flushing it.
    """
    import redis as sync_redis

    from app.config.redis_client import PARTNER_LOCATIONS_KEY, location_updated_at_key

    ids = [r["id"] for r in rows(
        "SELECT id::text AS id FROM partners WHERE phone = ANY(%(p)s)",
        {"p": partner_phones()},
    )]
    if not ids:
        return
    try:
        r = sync_redis.Redis.from_url(S.REDIS_URL, decode_responses=True)
        r.zrem(PARTNER_LOCATIONS_KEY, *ids)
        r.delete(*[location_updated_at_key(i) for i in ids])
        r.close()
        print(f"  removed {len(ids)} pin(s) from Redis")
    except Exception as exc:                                  # noqa: BLE001
        print(f"  ! could not clean Redis ({exc!r}) — pins may remain")


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def data_of(r: httpx.Response) -> dict:
    try:
        return r.json().get("data") or {}
    except Exception:                                          # noqa: BLE001
        return {}


def require(r: httpx.Response, what: str, ok=(200, 201)) -> dict:
    if r.status_code not in ok:
        raise SystemExit(f"{what} failed: HTTP {r.status_code} {r.text[:300]}")
    return data_of(r)


def build(c: httpx.Client) -> dict:
    partners = []
    for i, (label, km, bearing, rating, rcount, offers) in enumerate(PLACEMENTS):
        ident = supabase_identity(label)
        phone = partner_phones()[i]
        lat, lng = offset(PICKUP_LAT, PICKUP_LNG, km, bearing)

        pid = require(
            c.post("/api/v1/partners",
                   json={"name": f"Load QA {label}", "phone": phone,
                         "primary_category_code": "mechanical"}),
            f"partner {label} registration",
        )["id"]
        require(c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(ident["token"])),
                f"partner {label} link-auth")

        # Verification and ratings have no endpoint — the verification workflow is
        # a separate task and ratings are written by a flow that does not exist
        # yet — so both are set directly. This is the only state the API cannot
        # create itself, and it is set here rather than pretended away.
        exec_sql(
            "UPDATE partners SET verification_status = 'verified', "
            "       rating_avg = %(avg)s, rating_count = %(cnt)s "
            "WHERE id = %(pid)s",
            {"avg": rating, "cnt": rcount, "pid": pid},
        )

        # Every partner gets a rotating second service whether or not they offer
        # the one under test, so partner_services is not a table where every row
        # has the same service_id — the eligibility subquery should be filtering
        # a realistic mix, not a single value.
        codes = ([SERVICE_CODE] if offers else []) + [OTHER_SERVICES[i % len(OTHER_SERVICES)]]
        require(c.post(f"/api/v1/partners/{pid}/services", json={"service_codes": codes},
                       headers=hdr(ident["token"])), f"partner {label} services")
        require(c.patch(f"/api/v1/partners/{pid}/availability", json={"is_available": True},
                        headers=hdr(ident["token"])), f"partner {label} availability")
        require(c.post(f"/api/v1/partners/{pid}/location", json={"lat": lat, "lng": lng},
                       headers=hdr(ident["token"])), f"partner {label} location")

        partners.append({
            "label": label, "id": pid, "phone": phone,
            "email": ident["email"], "password": ident["password"],
            "token": ident["token"],
            "intended_km": km, "bearing_deg": bearing, "lat": lat, "lng": lng,
            "rating_avg": rating, "rating_count": rcount,
            "offers_service": offers, "in_radius": km < RADIUS_KM,
            "eligible": offers and km < RADIUS_KM,
        })
        print(f"  partner {label}: {km:>5.1f} km  bearing {bearing:>5.1f}°  "
              f"rating {rating:.2f}/{rcount:<2}  "
              f"{'eligible' if partners[-1]['eligible'] else 'EXCLUDED'}")

    owners = []
    for i in range(OWNER_COUNT):
        ident = supabase_identity(f"owner{i:02d}")
        phone = owner_phones()[i]
        user = require(
            c.post("/api/v1/users",
                   json={"name": f"Load QA Owner {i:02d}", "phone": phone,
                         "email": f"owner{i:02d}@{QA_DOMAIN}"},
                   headers=hdr(ident["token"])),
            f"owner {i} registration",
        )
        vehicle = require(
            c.post("/api/v1/vehicles",
                   json={"vehicle_type": "four_wheeler", "make": "Maruti",
                         "model": "Swift", "vehicle_number": f"KA01LD{1000 + i}"},
                   headers=hdr(ident["token"])),
            f"owner {i} vehicle",
        )
        owners.append({
            "index": i, "user_id": user["id"], "vehicle_id": vehicle["id"],
            "phone": phone, "email": ident["email"], "password": ident["password"],
            "token": ident["token"],
        })
    print(f"  {len(owners)} owners, each with one vehicle")
    return {"partners": partners, "owners": owners}


def verify_placement(ctx: dict) -> None:
    """Check what Redis actually measures, not what the table intended.

    The whole dataset rests on 14 partners being inside the radius and 4 outside.
    That is an arithmetic claim about the offset() function, and it is cheap to
    confirm against the thing that will really decide it — so it is confirmed
    rather than assumed, the same way the integration harness confirmed
    fakeredis's geohash maths before relying on it.
    """
    import redis as sync_redis

    from app.config.redis_client import PARTNER_LOCATIONS_KEY

    r = sync_redis.Redis.from_url(S.REDIS_URL, decode_responses=True)
    hits = r.geosearch(PARTNER_LOCATIONS_KEY, longitude=PICKUP_LNG, latitude=PICKUP_LAT,
                       radius=RADIUS_KM, unit="km", withdist=True)
    r.close()

    measured = {member: float(dist) for member, dist in hits}
    seeded = {p["id"]: p for p in ctx["partners"]}
    worst = 0.0
    for pid, p in seeded.items():
        if pid in measured:
            worst = max(worst, abs(measured[pid] - p["intended_km"]))

    inside = [p for p in ctx["partners"] if p["in_radius"]]
    outside = [p for p in ctx["partners"] if not p["in_radius"]]
    mine_in_radius = [p for p in ctx["partners"] if p["id"] in measured]

    ok_in = all(p["id"] in measured for p in inside)
    ok_out = all(p["id"] not in measured for p in outside)
    print(f"  GEOSEARCH {RADIUS_KM:.0f} km returned {len(mine_in_radius)} of this "
          f"harness's {len(ctx['partners'])} partners "
          f"(intended {len(inside)} in / {len(outside)} out)")
    print(f"  largest intended-vs-measured distance error: {worst * 1000:.0f} m")
    if not (ok_in and ok_out):
        raise SystemExit(
            "placement is wrong: the radius split Redis measures does not match "
            "the one PLACEMENTS intends. Fix offset() before running the load test "
            "— every latency number depends on the candidate pool being what the "
            "report says it is."
        )
    eligible = [p for p in ctx["partners"] if p["eligible"]]
    print(f"  eligible candidate pool: {len(eligible)} partners "
          f"→ theoretical ceiling {len(eligible) * 2} simultaneously-held jobs")


def write_context(ctx: dict) -> None:
    ctx.update({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": BASE_URL,
        "service_code": SERVICE_CODE,
        "service_id": SERVICE_ID,
        "pickup": {"lat": PICKUP_LAT, "lng": PICKUP_LNG},
        "jitter_km": JITTER_KM,
        "radius_km": RADIUS_KM,
        "job_tag": JOB_TAG,
        "qa_domain": QA_DOMAIN,
        "partner_phones": partner_phones(),
        "owner_phones": owner_phones(),
    })
    CONTEXT_PATH.write_text(json.dumps(ctx, indent=1), encoding="utf-8")
    n_tok = len(ctx["owners"]) + len(ctx["partners"])
    print(f"  wrote {CONTEXT_PATH.name} — {n_tok} tokens "
          f"(~{len(ctx['owners'][0]['token'])} chars each, none printed)")


def refresh(ctx: dict) -> dict:
    """Re-mint tokens and re-push partner locations into Redis.

    The two halves of this dataset have very different lifetimes. Everything in
    Postgres — partners, services, verification, vehicles — survives anything
    short of a purge. Everything in Redis is ephemeral by construction: the load
    Redis runs with `--appendonly no`, so a container restart (or Docker Desktop
    shutting down between sessions) silently empties the GEO set while leaving
    every partner row in the database looking perfectly healthy.

    That failure mode is quiet and expensive. GEOSEARCH would return nothing, every
    job would come back 201 with status no_match_found, and the run would look like
    a matching-quality collapse rather than a missing cache. Re-pushing here makes
    --refresh the single "the environment restarted, make it valid again" command.
    """
    for group in ("owners", "partners"):
        for entry in ctx[group]:
            entry["token"] = sign_in(entry["email"], entry["password"])

    with httpx.Client(base_url=BASE_URL, timeout=30.0) as c:
        for p in ctx["partners"]:
            require(
                c.post(f"/api/v1/partners/{p['id']}/location",
                       json={"lat": p["lat"], "lng": p["lng"]},
                       headers=hdr(p["token"])),
                f"partner {p['label']} location re-push",
            )
    print(f"  re-pushed {len(ctx['partners'])} partner locations into Redis")

    ctx["refreshed_at"] = datetime.now(timezone.utc).isoformat()
    return ctx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--purge", action="store_true", help="tear the dataset down and exit")
    ap.add_argument("--refresh", action="store_true", help="re-mint tokens only")
    args = ap.parse_args()

    print(f"DB: {S.DATABASE_URL.split('@')[-1].split('/')[0]}   Redis: {S.REDIS_URL}")

    if args.purge:
        print("\nTearing down the load-test dataset...")
        purge_redis()
        purge()
        purge_supabase_accounts()
        if CONTEXT_PATH.exists():
            CONTEXT_PATH.unlink()
            print(f"  removed {CONTEXT_PATH.name}")
        print(f"  counts now: {counts()}")
        return

    if args.refresh:
        if not CONTEXT_PATH.exists():
            raise SystemExit(f"{CONTEXT_PATH.name} does not exist — seed first.")
        ctx = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
        print("\nRe-minting tokens and restoring Redis for the existing dataset...")
        ctx = refresh(ctx)
        write_context(ctx)
        # Re-verify rather than assume. The whole point of --refresh is that the
        # environment was disturbed; taking its word that the re-push worked would
        # reintroduce exactly the assumption that made the refresh necessary.
        verify_placement(ctx)
        return

    # The server has to be up before anything is created, so a dead server is a
    # clean exit rather than 26 orphaned Supabase accounts.
    try:
        probe = httpx.get(f"{BASE_URL}/health", timeout=10.0)
    except httpx.TransportError as exc:
        raise SystemExit(
            f"no server on {BASE_URL} ({exc!r}).\n"
            f"Start one first:  uvicorn app.main:app --port 8010"
        )
    if probe.status_code != 200:
        raise SystemExit(f"{BASE_URL}/health returned {probe.status_code}")
    print(f"server on {BASE_URL}: healthy")

    print("\nClearing any leftovers from a previous seed...")
    purge_redis()
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    ctx: dict = {}
    cleaned = False
    try:
        with httpx.Client(base_url=BASE_URL, timeout=30.0) as c:
            print(f"\nSeeding {len(PLACEMENTS)} partners and {OWNER_COUNT} owners...")
            ctx = build(c)
        print("\nVerifying the placement against live Redis...")
        verify_placement(ctx)
        print("\nWriting the context file...")
        write_context(ctx)
        print(f"\n  counts now: {counts()}")
        print("\nSeeded. Next:  k6 run tests/load/dispatch.js")
    except BaseException:
        # Anything at all — including a KeyboardInterrupt or a transport error
        # escaping mid-build — must not leave half a fleet behind. A partially
        # seeded dataset is worse than none: the next run would inherit it, and
        # the candidate pool the report describes would silently be wrong.
        # (This exact failure mode already cost a debugging session once, in a
        # harness whose cleanup lived at the end of the happy path.)
        if not cleaned:
            cleaned = True
            print("\n! seeding failed — rolling the partial dataset back")
            try:
                purge_redis()
                purge()
                purge_supabase_accounts()
            except Exception as exc:                            # noqa: BLE001
                print(f"  ! rollback itself failed: {exc!r}")
        raise


if __name__ == "__main__":
    main()
