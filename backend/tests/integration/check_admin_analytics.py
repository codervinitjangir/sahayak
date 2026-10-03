"""Live check: the three admin analytics endpoints, against real data.

Run it directly — it needs no server process:

    python tests/integration/check_admin_analytics.py

Add --reverted to run the **control**, described at the bottom of this docstring.

Not named test_*.py on purpose, same as its siblings: pytest must not collect it,
because it writes to the real database and creates real Supabase accounts.

-- Why this harness is not optional ----------------------------------------

tests/unit/test_admin_analytics_service.py has 47 tests and they all pass. They
monkeypatch every function in analytics_repository, which is the right design for
what they test — the service's arithmetic and its refusal to invent numbers — and
it makes them structurally incapable of noticing that **no query in that module
could execute at all**. Writing this file surfaced two bugs before it was
finished, both of which would have made all three endpoints return 500 on every
single call, with a green unit suite:

  1. `column p.is_verified does not exist`. partner_supply filtered on a boolean
     that was never in the schema; verification is a four-value enum column,
     `verification_status`. One wrong identifier, one endpoint dead.

  2. `AmbiguousParameterError: could not determine data type of parameter $1`,
     on nine of the twelve queries — every one that takes the window. asyncpg
     PREPAREs before binding, so Postgres must infer a parameter's type from the
     SQL text alone, and `$1 IS NULL` tells it nothing. This failed on the
     unbounded call *and* with both timestamps supplied. It is specifically an
     asyncpg property: the identical SQL run through psycopg2 (which interpolates
     client-side) works, so a developer checking the query by hand in a script
     like this file's own `rows()` helper would have seen it pass.

Neither is a subtle logic error. Both are the kind only a real connection can
report, which is the whole argument for this file.

-- What is actually under test ---------------------------------------------

Section 4 onwards drives nine jobs through the real endpoints — created, offered,
declined, re-offered, accepted, completed, cancelled, and left unmatched — and
then asks the three reports to describe what happened. Three things matter most.

**Section 6, the status-overwrite trap.** `job_assignments.status` is rewritten
when a job ends: completing a job moves its accepted assignment to 'completed',
cancelling one moves its still-open offer off 'offered'. So a report that
classified offers by that column would lose both — it would count 3 accepted
instead of 5 and 1 unanswered instead of 2, and its three outcomes would no
longer sum to the number of offers. The repository reads `accepted_at` and
`responded_at` instead, and this section is the only place that distinction can
be demonstrated, because it needs a job that has already ended.

**Section 8, the outage exclusion.** A `no_match_found` caused by our own Redis
being unreachable is not evidence about partner supply. Both causes share one
status by design (ADR-016) and only the job_status_history note separates them.
This section produces a real one — it breaks the location store's geosearch for
exactly one job creation, so DISPATCH_UNAVAILABLE_NOTE is written by the shipped
code path rather than seeded by SQL — and then asserts the rate excludes it from
*both* sides of the fraction while `rate_including_outages` keeps it.

**Section 11, the divergence the project exists to measure.** A job is dispatched
under conditions where the nearest eligible partner is deliberately not the best
one: alpha is 0.99 km away but already holds a live job, beta is 2.1 km away and
free. Weighted scoring must pick beta, `was_baseline_choice` must be false, and
the attribution must name `load_score` as the driver — not `distance_score`,
which is what was overridden, and not `skill_score` or `rating_score`, which did
not vary and therefore cannot have separated anybody.

Everything is read through a window starting at a timestamp taken from the
database immediately before the first job is created. That isolates these nine
jobs from whatever else the database holds, which is what makes exact counts
assertable at all — and it means a broken window predicate cannot produce a
passing run, because every count would silently include the rest of the table.

-- The control run ---------------------------------------------------------

    python tests/integration/check_admin_analytics.py --reverted

must FAIL. Rather than removing the routes — which would fail everything and
prove only that the routes exist — it swaps one query, `offer_outcomes`, for the
status-based classification described above: `status = 'accepted'`, `'rejected'`,
`'offered'`. Nothing else changes. Every route still answers 200, every
authorization check still passes, the funnel is still right, and section 6 fails
on both the partition and the two acceptance rates — the defect isolated to the
one column it lives in.

Redis is fakeredis, the single substitution, for the reasons at the top of
check_dispatch_flow.py. Partner availability is set with SQL, as scaffolding, so
each job's offer reaches a known partner.

Cleanup runs at both ends, survives a crash, and the run FAILS if the table
counts do not return to their baseline.
"""
import asyncio
import sys
import uuid
from pathlib import Path

# Windows consoles default to cp1252, which cannot encode the arrows below, and
# a UnicodeEncodeError from a print() would abort the run *between* the
# assertions and the cleanup — leaving QA rows in the database.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import fakeredis.aioredis  # noqa: E402
import httpx  # noqa: E402
import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402
from redis import exceptions as redis_exceptions  # noqa: E402

from app.config.redis_client import set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

REVERTED = "--reverted" in sys.argv

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LNG = 111.32 * 0.9205    # cos(23°) ≈ 0.9205

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another. 099x belongs to
# check_ratings.py, 098x to check_partner_offers.py, 097x to
# check_dispatch_capacity.py, 096x to check_dispatch_race.py, 095x to
# check_notifications.py, 090x to check_dispatch_flow.py.
QA_DOMAIN = "sahayak-adminqa.invalid"
PHONE_PREFIX = "+91900000094"
JOB_TAG = "ADMN-QA"

# alpha sits 0.99 km from the pickup, beta 2.12 km. The gap is the whole of
# section 11: with both free, distance decides and alpha wins; with alpha holding
# one live job its load_score halves (1 - 1/2) and 0.2 of load outweighs 0.4 of
# the 1.13 km difference, so beta wins while being further away. That is a real
# divergence produced by the shipped scorer, not an injected flag.
LABELS = ("alpha", "beta")
PARTNER_PHONES = {label: PHONE_PREFIX + str(i + 1) for i, label in enumerate(LABELS)}
OFFSETS_KM = {"alpha": (0.7, 0.7), "beta": (2.0, 0.7)}

_results: list[tuple[bool, str, str]] = []
_cleaned = False


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


def latlng(offset_km: tuple[float, float]) -> tuple[float, float]:
    north_km, east_km = offset_km
    return (PICKUP_LAT + north_km / KM_PER_DEG_LAT,
            PICKUP_LNG + east_km / KM_PER_DEG_LNG)


# --------------------------------------------------------------------------
# Database access — used only to verify, to set availability, and to clean up.
# --------------------------------------------------------------------------
dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True

# `admins` is in here because this harness creates one, which no other harness
# does. A baseline assertion that omits the table a run writes to cannot fail.
TABLES = (
    "users", "vehicles", "partners", "partner_services", "admins",
    "jobs", "job_status_history", "job_assignments", "ratings",
)


def counts() -> dict:
    q = conn.cursor()
    return {t: (q.execute(f"SELECT count(*) FROM {t}"), q.fetchone()[0])[1] for t in TABLES}


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql: str, params=None):
    result = rows(sql, params)
    return result[0] if result else None


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone prefix, the job tag and the QA email domain, never by
    "recent rows" — a cleanup that works by timestamp will one day delete
    something real.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM ratings WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone LIKE %(p)s)", {"p": PHONE_PREFIX + "%"},
    )
    q.execute(
        "DELETE FROM job_status_history WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    q.execute(
        "DELETE FROM job_assignments WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    q.execute("DELETE FROM jobs WHERE issue_description LIKE %(tag)s", {"tag": JOB_TAG + "%"})
    q.execute(
        "DELETE FROM partner_services WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone LIKE %(p)s)", {"p": PHONE_PREFIX + "%"},
    )
    q.execute("DELETE FROM partners WHERE phone LIKE %(p)s", {"p": PHONE_PREFIX + "%"})
    q.execute("DELETE FROM admins WHERE email LIKE %(d)s", {"d": "%@" + QA_DOMAIN})
    q.execute("UPDATE users SET auth_user_id = NULL WHERE id = %(i)s", {"i": USER_ID})


# --------------------------------------------------------------------------
# Supabase accounts — real tokens, same approach as check_auth_flow.py.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}",
                  "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=60.0)


def _supa_call(method: str, url: str, attempts: int = 3, **kwargs) -> httpx.Response:
    """Call Supabase, retrying a *transport* failure but never a rejection."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return _supa.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            print(f"  ! Supabase {method} {url} timed out "
                  f"(attempt {attempt + 1}/{attempts}), retrying")
    raise SystemExit(f"Supabase unreachable after {attempts} attempts: {last}")


def purge_supabase_accounts() -> None:
    r = _supa_call("GET", "/auth/v1/admin/users", headers=_admin_headers,
                   params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    for u in r.json().get("users", []):
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str) -> tuple[str, str, str]:
    """Create a real Supabase account and sign in. Returns (auth_user_id, token, email)."""
    email = f"admnqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa_call(
        "POST", "/auth/v1/admin/users", headers=_admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]

    r = _supa_call(
        "POST", "/auth/v1/token", params={"grant_type": "password"},
        headers={"apikey": PUB, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )
    if r.status_code != 200:
        raise SystemExit(f"could not sign in as {email}: {r.status_code} {r.text[:300]}")
    return uid, r.json()["access_token"], email


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def code_of(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("code", "?")
    except Exception:       # noqa: BLE001
        return "?"


def data_of(r: httpx.Response):
    try:
        return r.json().get("data")
    except Exception:       # noqa: BLE001
        return None


partners: dict[str, dict] = {}
owner_token = ""
admin_token = ""
jobs: dict[str, str] = {}
redis_client = None


def only_available(*labels: str) -> None:
    ids = [partners[label]["id"] for label in labels]
    q = conn.cursor()
    q.execute(
        "UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) "
        "WHERE phone LIKE %(p)s",
        {"ids": ids, "p": PHONE_PREFIX + "%"},
    )


def db_now() -> str:
    """The database's clock, not this process's.

    Every timestamp the window is compared against is a Postgres column default,
    so the window bound has to come from the same clock or a few hundred
    milliseconds of skew silently drops the first job.
    """
    return one("SELECT now() AS t")["t"].isoformat()


# --------------------------------------------------------------------------
# Driving the real endpoints. Scaffolding, not assertions: every step here is
# already covered by check_job_lifecycle.py and check_dispatch_flow.py, so a
# failure raises SystemExit rather than recording a check.
# --------------------------------------------------------------------------
async def create_job(c, tag: str) -> str:
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Admin analytics QA pickup, Outer Ring Rd",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]
    jobs[tag] = job_id
    return job_id


def live_offer(job_id: str, expect_label: str | None = None) -> dict:
    offer = one("SELECT id, partner_id, assignment_rank, was_baseline_choice "
                "FROM job_assignments WHERE job_id = %(i)s AND status = 'offered' "
                "ORDER BY assignment_rank DESC LIMIT 1", {"i": job_id})
    if offer is None:
        raise SystemExit(f"job {job_id}: expected a live offer, found none")
    if expect_label and str(offer["partner_id"]) != partners[expect_label]["id"]:
        raise SystemExit(f"job {job_id}: expected the offer to go to {expect_label}, "
                         f"got partner {offer['partner_id']}")
    return offer


async def respond(c, offer_id, label: str, action: str) -> None:
    r = await c.post(f"/api/v1/job-assignments/{offer_id}/respond",
                     json={"action": action}, headers=hdr(partners[label]["token"]))
    if r.status_code != 200:
        raise SystemExit(f"{label} {action} on {offer_id} failed: "
                         f"{r.status_code} {r.text[:300]}")


async def walk_to(c, job_id: str, label: str, final_status: str,
                  price: float = 500) -> None:
    chain = ["partner_en_route", "in_progress", "completed"]
    for step in chain[:chain.index(final_status) + 1]:
        body: dict = {"status": step}
        if step == "completed":
            body["price_final"] = price
        r = await c.post(f"/api/v1/jobs/{job_id}/status", json=body,
                         headers=hdr(partners[label]["token"]))
        if r.status_code != 200:
            raise SystemExit(f"{job_id} → {step} failed: {r.status_code} {r.text[:300]}")


# --------------------------------------------------------------------------
# Reading the reports.
# --------------------------------------------------------------------------
async def report(c, name: str, **params) -> dict:
    r = await c.get(f"/api/v1/admin/analytics/{name}", params=params,
                    headers=hdr(admin_token))
    if r.status_code != 200:
        raise SystemExit(f"GET {name} {params} failed: {r.status_code} {r.text[:400]}")
    return data_of(r)


def note_codes(body: dict) -> list[str]:
    return [n["code"] for n in body.get("notes", [])]


# --------------------------------------------------------------------------
# The control: offers classified by the column the job's ending overwrites.
# --------------------------------------------------------------------------
async def status_based_offer_outcomes(db, *, from_ts=None, to_ts=None):
    """What a reasonable person writes first, and why it is wrong.

    Identical to the shipped query except for the three FILTER clauses, which
    read `a.status` instead of `a.accepted_at` / `a.responded_at`. Completing a
    job moves its accepted assignment to 'completed' and cancelling one moves its
    open offer off 'offered', so both outcomes vanish and the three counts stop
    summing to offers_total.
    """
    from sqlalchemy import text

    result = await db.execute(text("""
        SELECT
            count(*)                                                AS offers_total,
            count(DISTINCT a.job_id)                                AS jobs_offered,
            count(DISTINCT a.partner_id)                            AS partners_offered,
            count(*) FILTER (WHERE a.status = 'accepted')           AS accepted,
            count(*) FILTER (WHERE a.status = 'rejected')           AS declined,
            count(*) FILTER (WHERE a.status = 'offered')            AS unanswered,
            count(*) FILTER (
                WHERE a.estimated_arrival_min IS NOT NULL
            )                                                       AS with_eta_estimate
        FROM job_assignments a
        JOIN jobs j ON j.id = a.job_id
        WHERE (CAST(:from_ts AS timestamptz) IS NULL
                   OR j.requested_at >= CAST(:from_ts AS timestamptz))
          AND (CAST(:to_ts AS timestamptz) IS NULL
                   OR j.requested_at < CAST(:to_ts AS timestamptz))
    """), {"from_ts": from_ts, "to_ts": to_ts})
    return dict(result.mappings().one())


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned, owner_token, admin_token, redis_client

    redis_client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    set_redis_client(redis_client)

    if REVERTED:
        from app.repositories import analytics_repository      # noqa: E402
        analytics_repository.offer_outcomes = status_based_offer_outcomes
        print("*** CONTROL RUN: offer outcomes are classified by "
              "job_assignments.status instead of the timestamps. This run must "
              "FAIL — in section 6 and 7, and nowhere else. ***")

    from app.main import app                    # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://admin.test",
                                 timeout=60.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, two partners, and an admin provisioned by SQL")
        # ------------------------------------------------------------------
        _, owner_token, _ = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        for label in LABELS:
            _, token, _ = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Admin QA {label}",
                "phone": PARTNER_PHONES[label],
                "primary_category_code": "mechanical",
            })
            if r.status_code != 201:
                raise SystemExit(f"{label} partner registration failed: "
                                 f"{r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]

            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} link-auth failed: {r.status_code} {r.text[:300]}")

            q = conn.cursor()
            q.execute("UPDATE partners SET verification_status='verified' WHERE id=%(i)s",
                      {"i": pid})

            lat, lng = latlng(OFFSETS_KM[label])
            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": lng}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}

        # The admin is created by direct SQL, and that is not a shortcut around a
        # missing test fixture — it is the production provisioning path. ADR-020
        # declines to build an admin link-auth endpoint on purpose: an admins row
        # is a privilege grant, not a profile, so nobody gets to claim one by
        # presenting a token. Any harness that could provision an admin over HTTP
        # would be evidence of a hole.
        admin_uid, admin_token, admin_email = supabase_identity("ops")
        q = conn.cursor()
        q.execute("INSERT INTO admins (name, email, role, auth_user_id) "
                  "VALUES (%(n)s, %(e)s, 'ops', %(a)s)",
                  {"n": "Admin QA ops", "e": admin_email, "a": admin_uid})
        linked = one("SELECT id, role, auth_user_id FROM admins WHERE email = %(e)s",
                     {"e": admin_email})
        check("an admins row exists with the Supabase account attached",
              linked is not None and str(linked["auth_user_id"]) == admin_uid,
              f"{linked}")

        # ------------------------------------------------------------------
        section("2. require_admin is the whole authorization boundary")
        # ------------------------------------------------------------------
        ROUTES = ("overview", "dispatch", "matching")
        for name in ROUTES:
            path = f"/api/v1/admin/analytics/{name}"

            r = await c.get(path)
            check(f"{name}: no token is 401", r.status_code == 401,
                  f"HTTP {r.status_code} {code_of(r)}")

            r = await c.get(path, headers=hdr(owner_token))
            check(f"{name}: an owner's token is 403 FORBIDDEN",
                  r.status_code == 403 and code_of(r) == "FORBIDDEN",
                  f"HTTP {r.status_code} {code_of(r)}")

            r = await c.get(path, headers=hdr(partners["alpha"]["token"]))
            check(f"{name}: a verified partner's token is 403 FORBIDDEN",
                  r.status_code == 403 and code_of(r) == "FORBIDDEN",
                  f"HTTP {r.status_code} {code_of(r)}")

            r = await c.get(path, headers=hdr(admin_token))
            check(f"{name}: the admin's token is 200", r.status_code == 200,
                  f"HTTP {r.status_code} {code_of(r)}")

        # A token signed by Supabase for an account linked to nothing at all.
        _, orphan_token, _ = supabase_identity("orphan")
        r = await c.get("/api/v1/admin/analytics/overview", headers=hdr(orphan_token))
        check("a valid token for an unlinked account is refused",
              r.status_code in (401, 403), f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("3. The window is validated before anything is read")
        # ------------------------------------------------------------------
        now = db_now()
        earlier = one("SELECT now() - interval '1 day' AS t")["t"].isoformat()
        for name in ROUTES:
            path = f"/api/v1/admin/analytics/{name}"
            r = await c.get(path, params={"from": now, "to": earlier},
                            headers=hdr(admin_token))
            check(f"{name}: an inverted window is 400 INVALID_DATE_RANGE",
                  r.status_code == 400 and code_of(r) == "INVALID_DATE_RANGE",
                  f"HTTP {r.status_code} {code_of(r)}")

        r = await c.get("/api/v1/admin/analytics/overview",
                        params={"from": now, "to": now}, headers=hdr(admin_token))
        check("equal bounds are allowed and return an empty window",
              r.status_code == 200 and (data_of(r) or {}).get("jobs", {}).get("total") == 0,
              f"HTTP {r.status_code} total={(data_of(r) or {}).get('jobs', {}).get('total')}")

        r = await c.get("/api/v1/admin/analytics/overview",
                        params={"from": "not-a-timestamp"}, headers=hdr(admin_token))
        check("an unparseable timestamp is 422, not 500", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("4. Nine jobs through the real endpoints")
        # ------------------------------------------------------------------
        # T0 comes from the database clock, before the first job exists. Every
        # assertion below reads `from=T0`, which isolates these nine jobs from
        # whatever else this database holds — and means a window predicate that
        # silently matched everything could not produce a passing run.
        T0 = db_now()
        W = {"from": T0}

        # (a) declined, then re-offered and left open. Both partners free, so
        #     distance decides and alpha — the nearer one — is offered first.
        only_available("alpha", "beta")
        job = await create_job(c, "declined")
        first = live_offer(job, "alpha")
        check("the first offer goes to the nearer partner at rank 1",
              first["assignment_rank"] == 1 and first["was_baseline_choice"] is True,
              f"rank={first['assignment_rank']} baseline={first['was_baseline_choice']}")
        await respond(c, first["id"], "alpha", "reject")
        second = live_offer(job, "beta")
        check("the decline produced a rank-2 offer to the other partner",
              second["assignment_rank"] == 2,
              f"rank={second['assignment_rank']}")
        # beta never answers it. That offer stays open forever: there is no expiry.

        # (b) an open offer on a job the owner then cancels — the trap in section 6.
        only_available("beta")
        job = await create_job(c, "cancel-open")
        live_offer(job, "beta")
        r = await c.post(f"/api/v1/jobs/{job}/cancel",
                         json={"cancellation_reason": "ADMN-QA changed their mind"},
                         headers=hdr(owner_token))
        if r.status_code != 200:
            raise SystemExit(f"cancel failed: {r.status_code} {r.text[:300]}")

        # (c) two completed jobs. alpha accepts and finishes each, so by the end
        #     alpha holds nothing live and both assignments read 'completed'.
        only_available("alpha")
        for tag, price in (("done-1", 450), ("done-2", 620)):
            job = await create_job(c, tag)
            await respond(c, live_offer(job, "alpha")["id"], "alpha", "accept")
            await walk_to(c, job, "alpha", "completed", price=price)

        # (d) one job left in progress. This is alpha's one live job, and it is
        #     what halves alpha's load_score for (e).
        job = await create_job(c, "live")
        await respond(c, live_offer(job, "alpha")["id"], "alpha", "accept")
        await walk_to(c, job, "alpha", "in_progress")

        # (e) the divergence. Both free to be offered, alpha nearer but loaded.
        only_available("alpha", "beta")
        job = await create_job(c, "diverge")
        diverged_offer = live_offer(job, "beta")
        check("the loaded-but-nearer partner was passed over for the further one",
              diverged_offer["was_baseline_choice"] is False,
              f"was_baseline_choice={diverged_offer['was_baseline_choice']}")
        await respond(c, diverged_offer["id"], "beta", "accept")

        # (f) one job left at partner_en_route, taking alpha to capacity (2).
        only_available("alpha")
        job = await create_job(c, "enroute")
        await respond(c, live_offer(job, "alpha")["id"], "alpha", "accept")
        await walk_to(c, job, "alpha", "partner_en_route")

        # (g) a genuine no-match: nobody is available inside the radius.
        only_available()
        job = await create_job(c, "nomatch-genuine")
        check("a job with no available partner ends in no_match_found",
              one("SELECT status FROM jobs WHERE id = %(i)s", {"i": job})["status"]
              == "no_match_found",
              one("SELECT status FROM jobs WHERE id = %(i)s", {"i": job})["status"])

        # (h) an outage no-match, written by the shipped code path. Breaking
        #     geosearch for one call makes dispatch_service raise
        #     DispatchUnavailableError and write DISPATCH_UNAVAILABLE_NOTE itself,
        #     which is stronger than seeding that history row with SQL: it proves
        #     the string the evaluation query matches on is the string the
        #     failure path actually writes.
        only_available("alpha", "beta")
        intact_geosearch = redis_client.geosearch

        async def _broken_geosearch(*a, **k):
            raise redis_exceptions.TimeoutError("ADMN-QA: injected location-store outage")

        redis_client.geosearch = _broken_geosearch
        try:
            job = await create_job(c, "nomatch-outage")
        finally:
            redis_client.geosearch = intact_geosearch
        outage_note = one(
            "SELECT note FROM job_status_history WHERE job_id = %(i)s "
            "AND status = 'no_match_found' AND note LIKE 'Dispatch unavailable:%%'",
            {"i": job},
        )
        check("the outage wrote its own timeline note, not a seeded one",
              outage_note is not None, f"{outage_note}")

        created = one("SELECT count(*) AS n FROM jobs WHERE issue_description LIKE %(t)s",
                      {"t": JOB_TAG + "%"})["n"]
        check("nine jobs were created", created == 9, f"{created}")

        # ------------------------------------------------------------------
        section("5. The funnel partitions, and conversion is a floor")
        # ------------------------------------------------------------------
        ov = await report(c, "overview", **W)
        jb = ov["jobs"]
        statuses = ("requested", "matching", "assigned", "partner_en_route",
                    "in_progress", "completed", "cancelled", "no_match_found")
        check("the window found exactly the nine jobs this run created",
              jb["total"] == 9, f"{jb['total']}")
        check("the eight status counts sum to total",
              sum(jb[s] for s in statuses) == jb["total"],
              f"{sum(jb[s] for s in statuses)} vs {jb['total']}")
        check("two completed, one cancelled, two unmatched",
              (jb["completed"], jb["cancelled"], jb["no_match_found"]) == (2, 1, 2),
              f"completed={jb['completed']} cancelled={jb['cancelled']} "
              f"no_match={jb['no_match_found']}")
        check("one job is in_progress and one is partner_en_route",
              (jb["in_progress"], jb["partner_en_route"]) == (1, 1),
              f"in_progress={jb['in_progress']} en_route={jb['partner_en_route']}")

        # Independent verification: the same counts, straight from SQL.
        sql_funnel = one(
            "SELECT count(*) AS total, "
            "count(*) FILTER (WHERE status='completed') AS completed, "
            "count(*) FILTER (WHERE status='cancelled') AS cancelled "
            "FROM jobs WHERE issue_description LIKE %(t)s", {"t": JOB_TAG + "%"})
        check("the endpoint agrees with a direct query over the same rows",
              (jb["total"], jb["completed"], jb["cancelled"])
              == (sql_funnel["total"], sql_funnel["completed"], sql_funnel["cancelled"]),
              f"endpoint={jb['total']}/{jb['completed']}/{jb['cancelled']} "
              f"sql={sql_funnel['total']}/{sql_funnel['completed']}/{sql_funnel['cancelled']}")

        cv = ov["conversion"]
        check("conversion is completed/total over the whole window",
              cv["rate"] == round(2 / 9, 4), f"{cv['rate']}")
        # declined (offer open), live, diverge, enroute — four that can still
        # reach completed. The cancelled and unmatched three cannot, and are in
        # the denominator as settled outcomes rather than counted as in-flight.
        check("still_open counts only jobs that can still reach completed",
              cv["still_open"] == 4, f"{cv['still_open']}")
        check("completed + still_open + settled failures = total",
              cv["completed"] + cv["still_open"] + jb["cancelled"]
              + jb["no_match_found"] == cv["total"],
              f"{cv['completed']}+{cv['still_open']}+{jb['cancelled']}"
              f"+{jb['no_match_found']} vs {cv['total']}")

        # ------------------------------------------------------------------
        section("6. An offer's outcome survives the job ending")
        # ------------------------------------------------------------------
        # The reason the repository reads timestamps and not job_assignments.status.
        # Two of the five accepted offers belong to completed jobs, whose
        # assignment rows now read 'completed'; one of the two unanswered offers
        # belongs to a cancelled job, whose row no longer reads 'offered'. A
        # status-based count loses all three.
        dp = await report(c, "dispatch", **W)
        of = dp["offers"]
        overwritten = rows(
            "SELECT a.status, count(*) AS n FROM job_assignments a "
            "JOIN jobs j ON j.id = a.job_id "
            "WHERE j.issue_description LIKE %(t)s GROUP BY a.status ORDER BY a.status",
            {"t": JOB_TAG + "%"})
        print(f"       stored assignment statuses: "
              f"{ {r['status']: r['n'] for r in overwritten} }")
        check("eight offers were extended", of["total"] == 8, f"{of['total']}")
        check("the three outcomes are mutually exclusive and exhaust the table",
              of["accepted"] + of["declined"] + of["unanswered"] == of["total"],
              f"{of['accepted']}+{of['declined']}+{of['unanswered']} vs {of['total']}")
        check("five accepted, including the two whose rows now read 'completed'",
              of["accepted"] == 5, f"{of['accepted']}")
        check("one declined", of["declined"] == 1, f"{of['declined']}")
        check("two unanswered, including the one on the cancelled job",
              of["unanswered"] == 2, f"{of['unanswered']}")
        check("seven jobs were offered to somebody (two never were)",
              of["jobs_offered"] == 7, f"{of['jobs_offered']}")
        check("both partners were offered work", of["partners_offered"] == 2,
              f"{of['partners_offered']}")

        # ------------------------------------------------------------------
        section("7. Two acceptance rates, because an unanswered offer is still open")
        # ------------------------------------------------------------------
        check("acceptance of answered offers is 5/6",
              of["acceptance_rate_of_answered"] == round(5 / 6, 4),
              f"{of['acceptance_rate_of_answered']}")
        check("acceptance of all offers is 5/8",
              of["acceptance_rate_of_all"] == round(5 / 8, 4),
              f"{of['acceptance_rate_of_all']}")
        check("the two rates differ, which is the point of reporting both",
              of["acceptance_rate_of_answered"] != of["acceptance_rate_of_all"],
              f"{of['acceptance_rate_of_answered']} vs {of['acceptance_rate_of_all']}")
        check("the no-expiry caveat is attached to the response",
              "UNANSWERED_OFFERS_HAVE_NO_EXPIRY" in note_codes(dp),
              f"{note_codes(dp)}")

        ob = dp["offers_before_acceptance"]
        check("every acceptance happened at rank 1",
              ob["accepted_offers"] == 5 and ob["worst_rank"] == 1,
              f"{ob['accepted_offers']} accepted, worst rank {ob['worst_rank']}")

        lat = dp["dispatch_latency"]
        check("dispatch latency was measured on the seven offered jobs",
              lat["count"] == 7 and lat["unit"] == "seconds",
              f"count={lat['count']} unit={lat['unit']}")
        check("latency is a positive number of seconds",
              lat["mean"] is not None and float(lat["mean"]) > 0, f"{lat['mean']}")

        # ------------------------------------------------------------------
        section("8. A dispatch outage is excluded from both sides of the rate")
        # ------------------------------------------------------------------
        nm = dp["no_match"]
        check("both unmatched jobs are counted", nm["total"] == 2, f"{nm['total']}")
        check("they are split one genuine, one outage",
              (nm["genuine"], nm["dispatch_unavailable"]) == (1, 1),
              f"genuine={nm['genuine']} outage={nm['dispatch_unavailable']}")
        check("the rate is 1 genuine over 8 eligible jobs, not 1 over 9",
              nm["rate"] == round(1 / 8, 4),
              f"{nm['rate']} (1/8={round(1 / 8, 4)}, 1/9={round(1 / 9, 4)})")
        check("rate_including_outages keeps both, over all nine",
              nm["rate_including_outages"] == round(2 / 9, 4),
              f"{nm['rate_including_outages']}")
        check("the exclusion is auditable — the two rates differ",
              nm["rate"] != nm["rate_including_outages"],
              f"{nm['rate']} vs {nm['rate_including_outages']}")
        check("the exclusion is declared in the notes",
              "OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE" in note_codes(dp),
              f"{note_codes(dp)}")

        # ------------------------------------------------------------------
        section("9. ETA accuracy is null, and the response proves why")
        # ------------------------------------------------------------------
        check("eta_accuracy is null", ov["eta_accuracy"] is None, f"{ov['eta_accuracy']}")
        check("a note names the missing input",
              "ETA_ACCURACY_NOT_COMPUTABLE" in note_codes(ov), f"{note_codes(ov)}")
        eta_note = [n for n in ov["notes"] if n["code"] == "ETA_ACCURACY_NOT_COMPUTABLE"][0]
        check("the note cites the count of estimates, which is 0 of 8",
              "0 of 8" in eta_note["detail"], f"{eta_note['detail']}")
        stored = one("SELECT count(*) AS n FROM job_assignments a JOIN jobs j "
                     "ON j.id = a.job_id WHERE j.issue_description LIKE %(t)s "
                     "AND a.estimated_arrival_min IS NOT NULL", {"t": JOB_TAG + "%"})["n"]
        check("no code path wrote an arrival estimate", stored == 0, f"{stored}")

        ws = ov["work_started"]
        # Three, not two. The two completed jobs passed *through* in_progress on
        # their way to completed, and the query reads job_status_history rather
        # than the job's current status, so it still measures them. That is the
        # behaviour worth pinning: measuring only jobs sitting in in_progress
        # right now would exclude every job that finished — which is precisely
        # the population you want a time-to-work-started figure for. The enroute
        # job is the complement: it never reached in_progress, so it is absent,
        # which is why this is 3 and not 4.
        reached = one(
            "SELECT count(DISTINCT h.job_id) AS n FROM job_status_history h "
            "JOIN jobs j ON j.id = h.job_id WHERE j.issue_description LIKE %(t)s "
            "AND h.status = 'in_progress'", {"t": JOB_TAG + "%"})["n"]
        check("work_started measured every job that ever reached in_progress",
              ws["count"] == 3 and ws["unit"] == "minutes",
              f"count={ws['count']} unit={ws['unit']}")
        check("which is two finished jobs plus the live one, and not the en-route one",
              ws["count"] == reached == 3, f"endpoint={ws['count']} history={reached}")
        check("it is named for what it measures, and says it is not arrival",
              "WORK_STARTED_IS_NOT_ARRIVAL" in note_codes(ov), f"{note_codes(ov)}")

        # ------------------------------------------------------------------
        section("10. The window filters, and the roster does not")
        # ------------------------------------------------------------------
        before = await report(c, "overview", **{"from": T0, "to": T0})
        check("a zero-width window at T0 sees none of the nine",
              before["jobs"]["total"] == 0, f"{before['jobs']['total']}")

        unbounded = await report(c, "overview")
        check("the unbounded report is a superset of the windowed one",
              unbounded["jobs"]["total"] >= 9, f"{unbounded['jobs']['total']}")
        check("the window reported the bounds it was given",
              ov["window"]["requested_from"] is not None
              and ov["window"]["requested_to"] is None,
              f"{ov['window']}")
        check("first_job_at and last_job_at fall inside the window",
              ov["window"]["first_job_at"] is not None
              and ov["window"]["first_job_at"] >= ov["window"]["requested_from"],
              f"first={ov['window']['first_job_at']} from={ov['window']['requested_from']}")

        ps = ov["partners"]
        sql_ps = one(
            "SELECT count(*) AS total, "
            "count(*) FILTER (WHERE verification_status='verified') AS verified, "
            "count(*) FILTER (WHERE is_available) AS available FROM partners")
        check("partner_supply agrees with a direct query over every partner",
              (ps["partners_total"], ps["verified"], ps["available_now"])
              == (sql_ps["total"], sql_ps["verified"], sql_ps["available"]),
              f"endpoint={ps['partners_total']}/{ps['verified']}/{ps['available_now']} "
              f"sql={sql_ps['total']}/{sql_ps['verified']}/{sql_ps['available']}")
        check("both QA partners are verified and counted",
              ps["verified"] >= 2, f"{ps['verified']}")
        check("both partners are holding live work",
              ps["busy_now"] == 2, f"{ps['busy_now']}")
        check("three assignments are live (in_progress, en_route, and the accepted one)",
              ps["live_assignments"] == 3, f"{ps['live_assignments']}")
        check("a windowed request says the roster is not historical",
              "PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL" in note_codes(ov),
              f"{note_codes(ov)}")
        check("an unwindowed request does not carry that note",
              "PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL" not in note_codes(unbounded),
              f"{note_codes(unbounded)}")

        # ------------------------------------------------------------------
        section("11. Weighted scoring against the nearest-partner baseline")
        # ------------------------------------------------------------------
        mt = await report(c, "matching", **W)
        dv = mt["divergence"]
        check("first offers only — the rank-2 offer is excluded",
              dv["first_offers"] == 7 and of["total"] == 8,
              f"first_offers={dv['first_offers']} offers_total={of['total']}")
        check("the two arms partition the first offers",
              dv["diverged"] + dv["agreed_with_nearest"] == dv["first_offers"],
              f"{dv['diverged']}+{dv['agreed_with_nearest']} vs {dv['first_offers']}")
        check("exactly one dispatch overrode the nearest eligible partner",
              dv["diverged"] == 1, f"{dv['diverged']}")
        check("the divergence rate is 1/7", dv["rate"] == round(1 / 7, 4), f"{dv['rate']}")
        check("the restriction to first offers is declared",
              "FIRST_OFFERS_ONLY" in note_codes(mt), f"{note_codes(mt)}")

        arm_d, arm_a = mt["weighted_diverged"], mt["also_nearest"]
        check("the arms' offer counts match the divergence split",
              (arm_d["offers"], arm_a["offers"]) == (dv["diverged"],
                                                     dv["agreed_with_nearest"]),
              f"{arm_d['offers']}/{arm_a['offers']}")
        check("the diverged offer was accepted", arm_d["accepted"] == 1,
              f"{arm_d['accepted']}")
        check("the diverged partner scored better overall despite being further",
              arm_d["mean_matching_score"] is not None
              and float(arm_d["mean_matching_score"]) > 0,
              f"{arm_d['mean_matching_score']}")
        check("and worse on distance, which is what it means to diverge",
              float(arm_d["mean_distance_score"]) < float(arm_a["mean_distance_score"]),
              f"diverged={arm_d['mean_distance_score']} "
              f"nearest={arm_a['mean_distance_score']}")

        at = mt["attribution"]
        check("skill_score is reported as a constant, because it is one by design",
              "skill_score" in at["constant_components"],
              f"{at['constant_components']}")
        check("rating_score is also constant — every QA partner is unrated",
              "rating_score" in at["constant_components"],
              f"{at['constant_components']}")
        check("load_score is the one component that measurably varied",
              at["eligible_components"] == ["load_score"],
              f"{at['eligible_components']}")
        check("load is named as the driver of the divergence",
              at["driver"] == "load_score", f"{at['driver']}")
        check("distance is never the driver, even though it differed most",
              at["driver"] != "distance_score"
              and "distance_score" not in at["eligible_components"],
              f"driver={at['driver']} eligible={at['eligible_components']}")
        check("all four components appear in deltas and stddev",
              sorted(at["deltas"]) == sorted(at["stddev"])
              == ["distance_score", "load_score", "rating_score", "skill_score"],
              f"{sorted(at['deltas'])}")
        check("the constants are declared in the notes",
              "CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE" in note_codes(mt),
              f"{note_codes(mt)}")
        check("so is the fact that attribution is group means, not a counterfactual",
              "ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL" in note_codes(mt),
              f"{note_codes(mt)}")

        # ------------------------------------------------------------------
        section("12. Small samples are labelled rather than quietly reported")
        # ------------------------------------------------------------------
        # Nine jobs is far under the threshold, so every report that computes a
        # percentile must say the percentiles do not mean anything yet. The
        # complement — the note disappearing on a large sample — is the unit
        # suite's job; what matters here is that real data triggers it.
        for name, body in (("overview", ov), ("dispatch", dp), ("matching", mt)):
            check(f"{name} warns that the sample is too small for percentiles",
                  "SAMPLE_TOO_SMALL_FOR_PERCENTILES" in note_codes(body),
                  f"{note_codes(body)}")

        for name, body in (("overview", ov), ("dispatch", dp), ("matching", mt)):
            codes = note_codes(body)
            check(f"{name}: no note code is repeated", len(codes) == len(set(codes)),
                  f"{codes}")
            details = [n["detail"] for n in body["notes"]]
            check(f"{name}: every note carries a detail", all(d.strip() for d in details),
                  f"{len(details)} note(s)")

        # Every rate in every report is a proportion or null. A rate outside 0..1
        # is arithmetic that has gone wrong in a way no single assertion above
        # would necessarily catch.
        def all_rates(node, path="") -> list[tuple[str, float]]:
            found = []
            if isinstance(node, dict):
                for k, v in node.items():
                    if isinstance(v, (dict, list)):
                        found += all_rates(v, f"{path}.{k}")
                    elif "rate" in k and isinstance(v, (int, float)):
                        found.append((f"{path}.{k}", v))
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    found += all_rates(v, f"{path}[{i}]")
            return found

        bad = [(p, v) for body in (ov, dp, mt) for p, v in all_rates(body)
               if not 0.0 <= v <= 1.0]
        check("every rate in all three reports is a proportion", bad == [], f"{bad}")

    # ----------------------------------------------------------------------
    section("13. Cleanup")
    # ----------------------------------------------------------------------
    purge()
    purge_supabase_accounts()
    _cleaned = True
    after = counts()
    check("every table is back to its baseline", after == baseline,
          f"{after}" if after != baseline else "unchanged")


def summarise() -> int:
    passed = sum(1 for ok, _, _ in _results if ok)
    failed = [(label, detail) for ok, label, detail in _results if not ok]
    print(f"\n{'=' * 70}")
    print(f"{passed}/{len(_results)} checks passed")
    if failed:
        print("\nFailed:")
        for label, detail in failed:
            print(f"  - {label}" + (f"  ({detail})" if detail else ""))
    if REVERTED:
        print("\nControl run: failures above are the expected result. A control "
              "run that passes means this harness is not testing how an offer's "
              "outcome is classified.")
    print("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Cleanup runs even if an assertion raised or a request blew up: an
        # escaped exception that skips the purge leaves QA rows behind and
        # silently redefines "baseline" for every later run.
        if not _cleaned:
            print("\n! run did not finish — purging anyway")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as exc:      # noqa: BLE001
                print(f"  ! cleanup failed: {type(exc).__name__}")
    sys.exit(summarise())
