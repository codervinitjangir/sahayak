"""Live check: the two-way rating exchange, and the partner aggregate it feeds.

Run it directly — it needs no server process:

    python tests/integration/check_ratings.py

Add --reverted to run the **control**, described at the bottom of this docstring.

Not named test_*.py on purpose, same as its siblings: pytest must not collect it,
because it writes to the real database and creates real Supabase accounts.

-- What is actually under test ---------------------------------------------

Two things that look like one feature and are not.

The first is the endpoint pair: who may rate, when, and once. Sections 2, 3, 4,
7 and 8 — a job too early, a body claiming to be someone else, a verified
stranger, a second attempt, and what each side is allowed to read back.

The second is `partners.rating_avg` / `rating_count`, which before this task
nothing in the system could write. A Postgres trigger was supposed to and could
not — it resolved the rated partner through `job_assignments.status = 'accepted'`
and a job has already moved that assignment to 'completed' by the time a rating
is legal, so its UPDATE matched zero rows and reported success. ADR-018 and
db/migrations/004 have the full story. Those two columns are one of the four
weighted inputs to ADR-009's matching score, so for as long as they stayed 0.0 a
fifth of the dispatch algorithm was a constant.

Sections 5, 6, 9 and 10 are that second thing, and section 5 is the one that
matters most: it completes a real job through the real lifecycle endpoints and
then asserts the mechanic's stored average actually moved off 0.0. Section 6 is
its complement — a *partner's* rating of the *owner* must not touch the partner's
own score, which is the failure a naive "average every rating on this partner's
jobs" would produce, and which section 5 alone would not catch. Section 9 proves
the arithmetic across two jobs, which is what separates a working aggregate from
one that happens to equal the only rating it has ever seen. Section 10 corrupts
the stored value on purpose and shows the next write repairing it, which is the
property that recomputing from source buys and incrementing does not.

-- The control run ---------------------------------------------------------

    python tests/integration/check_ratings.py --reverted

must FAIL, and it fails in an unusually specific way. Rather than deleting the
new routes — which would fail everything and prove only that the routes exist —
it swaps the aggregate writer for **the shipped trigger's own rule**, ported
verbatim: resolve the partner through `job_assignments.status = 'accepted'`
alone. Everything else stays exactly as it is now.

So the control run exercises the complete endpoint, stores every rating, and
still leaves every mechanic on 0.0 — precisely the behaviour that was live in
this database until migration 004 ran. Every aggregate assertion fails and every
endpoint assertion passes, which is the defect isolated to the one line it lives
on: not "ratings are broken" but "ratings are stored and nothing reads them".

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
from sqlalchemy import text  # noqa: E402

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
# never purge each other's rows out from under one another. 098x belongs to
# check_partner_offers.py, 097x to check_dispatch_capacity.py, 096x to
# check_dispatch_race.py, 090x to check_dispatch_flow.py.
QA_DOMAIN = "sahayak-ratingsqa.invalid"
PHONE_PREFIX = "+91900000099"
JOB_TAG = "RATE-QA"

# alpha does every job and is the partner whose average must move. beta is never
# offered anything and never accepts anything: they exist to prove that "a
# verified partner with a valid token" is not the same as "a party to this job".
LABELS = ("alpha", "beta")
PARTNER_PHONES = {label: PHONE_PREFIX + str(i + 1) for i, label in enumerate(LABELS)}
OFFSETS_KM = {"alpha": (0.7, 0.7), "beta": (-0.7, 0.7)}

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

TABLES = (
    "users", "vehicles", "partners", "partner_services",
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

    Scoped by the QA phone prefix and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.

    ratings goes first: it is the only table here with a foreign key to jobs and
    no ON DELETE CASCADE behind it, so deleting jobs before ratings fails on the
    constraint and leaves the run half-cleaned.
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


def supabase_identity(label: str) -> tuple[str, str]:
    """Create a real Supabase account and sign in. Returns (auth_user_id, token)."""
    email = f"rateqa-{label}@{QA_DOMAIN}"
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
    return uid, r.json()["access_token"]


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


def only_available(*labels: str) -> None:
    ids = [partners[label]["id"] for label in labels]
    q = conn.cursor()
    q.execute(
        "UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) "
        "WHERE phone LIKE %(p)s",
        {"ids": ids, "p": PHONE_PREFIX + "%"},
    )


def aggregate_of(label: str) -> tuple[str, int]:
    row = one("SELECT rating_avg, rating_count FROM partners WHERE id = %(i)s",
              {"i": partners[label]["id"]})
    return str(row["rating_avg"]), row["rating_count"]


def ratings_of(job_id: str) -> list:
    return rows("SELECT rated_by, rating, comment FROM ratings "
                "WHERE job_id = %(i)s ORDER BY rated_by", {"i": job_id})


async def rate(c, job_id: str, token: str, body: dict) -> httpx.Response:
    return await c.post(f"/api/v1/jobs/{job_id}/ratings", json=body, headers=hdr(token))


async def read_ratings(c, job_id: str, token: str) -> httpx.Response:
    return await c.get(f"/api/v1/jobs/{job_id}/ratings", headers=hdr(token))


async def job_through_to(c, tag: str, final_status: str, price: float | None = None) -> str:
    """Create a job, have alpha accept it, and walk it to `final_status`.

    Scaffolding, not an assertion: every step here is already covered by
    check_job_lifecycle.py and check_dispatch_flow.py. A failure raises SystemExit
    rather than recording a check, so a broken lifecycle shows up as a broken
    lifecycle and not as a mysterious rating failure.
    """
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Ratings QA pickup, Outer Ring Rd",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    offer = one("SELECT id, partner_id FROM job_assignments "
                "WHERE job_id = %(i)s AND status = 'offered'", {"i": job_id})
    if offer is None or str(offer["partner_id"]) != partners["alpha"]["id"]:
        raise SystemExit(f"job {tag}: expected a live offer to alpha, got {offer}")

    token = partners["alpha"]["token"]
    r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                     json={"action": "accept"}, headers=hdr(token))
    if r.status_code != 200:
        raise SystemExit(f"job {tag} accept failed: {r.status_code} {r.text[:300]}")

    chain = ["partner_en_route", "in_progress", "completed"]
    for step in chain[:chain.index(final_status) + 1]:
        body: dict = {"status": step}
        if step == "completed":
            body["price_final"] = price if price is not None else 500
        r = await c.post(f"/api/v1/jobs/{job_id}/status", json=body, headers=hdr(token))
        if r.status_code != 200:
            raise SystemExit(f"job {tag} → {step} failed: {r.status_code} {r.text[:300]}")

    return job_id


# --------------------------------------------------------------------------
# The control: the shipped trigger's rule, ported into the aggregate writer.
# --------------------------------------------------------------------------
async def trigger_era_recompute(db, partner_id):
    """What update_partner_rating() did, expressed against the same columns.

    The only difference from rating_repository.recompute_partner_rating is the
    assignment status list — `= 'accepted'` here, RESPONSIBLE_ASSIGNMENT_STATUSES
    there. A rating is only legal on a completed job, and completing a job moves
    the assignment to 'completed', so this matches nothing and every partner
    stays on 0.0.
    """
    result = await db.execute(text("""
        UPDATE partners SET
            rating_count = (
                SELECT count(*) FROM ratings r
                 WHERE r.rated_by = 'user'
                   AND r.job_id IN (SELECT ja.job_id FROM job_assignments ja
                                     WHERE ja.partner_id = :pid AND ja.status = 'accepted')),
            rating_avg = COALESCE((
                SELECT avg(r.rating) FROM ratings r
                 WHERE r.rated_by = 'user'
                   AND r.job_id IN (SELECT ja.job_id FROM job_assignments ja
                                     WHERE ja.partner_id = :pid AND ja.status = 'accepted')), 0)
         WHERE id = :pid
        RETURNING rating_avg, rating_count
    """), {"pid": partner_id})
    row = result.fetchone()
    return (row[0], row[1]) if row else None


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned, owner_token

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    if REVERTED:
        from app.repositories import rating_repository      # noqa: E402
        rating_repository.recompute_partner_rating = trigger_era_recompute
        print("*** CONTROL RUN: the aggregate writer has been swapped for the "
              "dropped trigger's rule (assignment status = 'accepted' only). "
              "This run must FAIL — on every aggregate check, and nowhere else. ***")

    from app.main import app                    # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://rate.test",
                                 timeout=60.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, two verified partners, both unrated")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        for label in LABELS:
            _, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Ratings QA {label}",
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

        only_available("alpha")
        # The starting point the whole task exists to move. Every partner in this
        # database has read 0.0 since the schema was written.
        check("alpha starts at rating_avg 0.0 / count 0", aggregate_of("alpha") == ("0.0", 0),
              f"{aggregate_of('alpha')}")

        # ------------------------------------------------------------------
        section("2. A job that is not finished cannot be rated")
        # ------------------------------------------------------------------
        # Run before any successful rating so this cannot be passing because of
        # leftover state from one.
        job_live = await job_through_to(c, "job-live", "in_progress")

        r = await rate(c, job_live, owner_token, {"rating": 5})
        check("owner rating an in_progress job is 409 JOB_NOT_RATEABLE",
              r.status_code == 409 and code_of(r) == "JOB_NOT_RATEABLE",
              f"HTTP {r.status_code} {code_of(r)}")
        r = await rate(c, job_live, partners["alpha"]["token"], {"rating": 5})
        check("partner rating an in_progress job is 409 JOB_NOT_RATEABLE",
              r.status_code == 409 and code_of(r) == "JOB_NOT_RATEABLE",
              f"HTTP {r.status_code} {code_of(r)}")
        check("nothing was stored for it", ratings_of(job_live) == [],
              f"{len(ratings_of(job_live))} row(s)")

        r = await read_ratings(c, job_live, owner_token)
        body = data_of(r) or {}
        check("GET on an unfinished job is 200 with can_rate false",
              r.status_code == 200 and body.get("can_rate") is False and body.get("ratings") == [],
              f"HTTP {r.status_code} can_rate={body.get('can_rate')}")

        # ------------------------------------------------------------------
        section("3. The body carries no identity, and says so loudly")
        # ------------------------------------------------------------------
        # The escalation this guards against: an owner posting rated_by='partner'
        # writes the mechanic's review of themselves, in the mechanic's name, and
        # burns the one slot the mechanic had to reply.
        job_done = await job_through_to(c, "job-one", "completed", price=1250.50)

        r = await rate(c, job_done, owner_token, {"rating": 5, "rated_by": "partner"})
        check("rated_by in the body is 422, not a silently dropped field",
              r.status_code == 422, f"HTTP {r.status_code} {code_of(r)}")
        r = await rate(c, job_done, owner_token, {"rating": 5, "job_id": job_done})
        check("job_id in the body is 422 as well", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")
        r = await rate(c, job_done, owner_token, {"rating": 6})
        check("rating 6 is 422", r.status_code == 422, f"HTTP {r.status_code}")
        r = await rate(c, job_done, owner_token, {"rating": 0})
        check("rating 0 is 422", r.status_code == 422, f"HTTP {r.status_code}")
        check("none of the four rejected bodies stored anything",
              ratings_of(job_done) == [], f"{len(ratings_of(job_done))} row(s)")

        # ------------------------------------------------------------------
        section("4. A stranger with a valid token is not a party to the job")
        # ------------------------------------------------------------------
        beta_token = partners["beta"]["token"]
        r = await rate(c, job_done, beta_token, {"rating": 1})
        check("an unrelated partner rating the job is 403",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")
        r = await read_ratings(c, job_done, beta_token)
        check("an unrelated partner reading the ratings is 403",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")

        unknown = str(uuid.uuid4())
        r = await rate(c, unknown, owner_token, {"rating": 5})
        check("rating an unknown job is 404 JOB_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")
        r = await read_ratings(c, unknown, owner_token)
        check("reading an unknown job's ratings is 404 JOB_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("5. The owner rates the mechanic, and the mechanic's score moves")
        # ------------------------------------------------------------------
        # The check this whole task exists for. Before migration 004 the write
        # below succeeded, the row landed, and this assertion read 0.0.
        before = aggregate_of("alpha")
        r = await rate(c, job_done, owner_token, {"rating": 5, "comment": "Quick and polite."})
        check("owner rating a completed job is 201", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        item = data_of(r) or {}
        check("the response says rated_by 'user', taken from the token",
              item.get("rated_by") == "user", str(item.get("rated_by")))
        check("the response carries a created_at", bool(item.get("created_at")),
              str(item.get("created_at"))[:19])

        stored = ratings_of(job_done)
        check("exactly one row is stored, rated_by 'user'",
              len(stored) == 1 and stored[0]["rated_by"] == "user" and stored[0]["rating"] == 5,
              f"{stored}")

        after = aggregate_of("alpha")
        check("alpha's stored rating_avg moved from 0.0 to 5.0",
              after == ("5.0", 1), f"{before} → {after}")

        # ------------------------------------------------------------------
        section("6. A partner's rating of the owner does not move the partner")
        # ------------------------------------------------------------------
        # Deliberately a low score. An implementation that averaged every rating
        # attached to this partner's jobs — rather than only the owner-written
        # ones — would drag alpha from 5.0 to 3.5 here, and would look correct in
        # section 5.
        r = await rate(c, job_done, partners["alpha"]["token"],
                       {"rating": 2, "comment": "Wrong address given."})
        check("the partner may rate the owner on the same job, 201",
              r.status_code == 201, f"HTTP {r.status_code} {code_of(r)}")
        check("it is stored as rated_by 'partner'",
              (data_of(r) or {}).get("rated_by") == "partner",
              str((data_of(r) or {}).get("rated_by")))
        check("alpha's own score is untouched by it", aggregate_of("alpha") == ("5.0", 1),
              f"{aggregate_of('alpha')}")

        # ------------------------------------------------------------------
        section("7. One rating per side, enforced by the constraint")
        # ------------------------------------------------------------------
        r = await rate(c, job_done, owner_token, {"rating": 1})
        check("the owner's second attempt is 409 RATING_ALREADY_SUBMITTED",
              r.status_code == 409 and code_of(r) == "RATING_ALREADY_SUBMITTED",
              f"HTTP {r.status_code} {code_of(r)}")
        r = await rate(c, job_done, partners["alpha"]["token"], {"rating": 5})
        check("the partner's second attempt is 409 as well",
              r.status_code == 409 and code_of(r) == "RATING_ALREADY_SUBMITTED",
              f"HTTP {r.status_code} {code_of(r)}")
        check("still exactly two rows, and the first scores survived",
              [(x["rated_by"], x["rating"]) for x in ratings_of(job_done)]
              == [("partner", 2), ("user", 5)],
              f"{[(x['rated_by'], x['rating']) for x in ratings_of(job_done)]}")
        check("the refused retries did not move the aggregate",
              aggregate_of("alpha") == ("5.0", 1), f"{aggregate_of('alpha')}")

        # ------------------------------------------------------------------
        section("8. Both sides read the same job, and neither can rate again")
        # ------------------------------------------------------------------
        for who, token in (("owner", owner_token), ("partner", partners["alpha"]["token"])):
            r = await read_ratings(c, job_done, token)
            body = data_of(r) or {}
            listed = body.get("ratings") or []
            check(f"{who} sees both ratings",
                  r.status_code == 200 and len(listed) == 2,
                  f"HTTP {r.status_code}, {len(listed)} item(s)")
            check(f"{who} sees them in a stable order (partner, user)",
                  [x.get("rated_by") for x in listed] == ["partner", "user"],
                  f"{[x.get('rated_by') for x in listed]}")
            check(f"{who} has can_rate false now", body.get("can_rate") is False,
                  str(body.get("can_rate")))
            check(f"{who} sees job_status 'completed'", body.get("job_status") == "completed",
                  str(body.get("job_status")))
        leaked = [k for k in (listed[0] if listed else {}) if k in
                  ("user_id", "partner_id", "rater_id", "name", "phone")]
        check("no rating item carries an identity field", leaked == [], f"{leaked}")

        # ------------------------------------------------------------------
        section("9. The average is recomputed, not accumulated")
        # ------------------------------------------------------------------
        # Two jobs, 5 and 4, must read 4.5 / 2. One job proves nothing: an
        # implementation that simply stored the latest rating would pass section 5.
        job_two = await job_through_to(c, "job-two", "completed", price=640)
        r = await rate(c, job_two, owner_token, {"rating": 4})
        check("second completed job rated 4", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        check("alpha now reads 4.5 across two ratings",
              aggregate_of("alpha") == ("4.5", 2), f"{aggregate_of('alpha')}")

        # A whitespace-only comment is an absent comment, so one query about "did
        # they leave a note" works regardless of which client sent it.
        r = await rate(c, job_two, partners["alpha"]["token"],
                       {"rating": 5, "comment": "   "})
        check("a whitespace-only comment is accepted", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        blank = [x for x in ratings_of(job_two) if x["rated_by"] == "partner"]
        check("it is stored as NULL, not as an empty string",
              len(blank) == 1 and blank[0]["comment"] is None, f"{blank}")

        # ------------------------------------------------------------------
        section("10. Deleting a rating repairs the aggregate on the next write")
        # ------------------------------------------------------------------
        # The payoff of recomputing from source. An incremental writer cannot do
        # this: it would carry the 4.5 forward forever, because it never reads the
        # rows it is meant to be summarising.
        q = conn.cursor()
        q.execute("DELETE FROM ratings WHERE job_id = %(i)s AND rated_by = 'user'",
                  {"i": job_two})
        check("the stored average is now stale on purpose",
              aggregate_of("alpha") == ("4.5", 2), f"{aggregate_of('alpha')}")

        job_three = await job_through_to(c, "job-three", "completed", price=300)
        r = await rate(c, job_three, owner_token, {"rating": 3})
        check("a third job is rated 3", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        check("the aggregate healed itself to 4.0 across the two rows that exist",
              aggregate_of("alpha") == ("4.0", 2), f"{aggregate_of('alpha')}")

    # ----------------------------------------------------------------------
    section("11. Cleanup")
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
              "run that passes means this harness is not testing the aggregate.")
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
