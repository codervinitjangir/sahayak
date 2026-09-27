"""Live check: GET /api/v1/partners/me/offers.

Run it directly — it needs no server process:

    python tests/integration/check_partner_offers.py

Add --reverted to run the **control**, described at the bottom of this docstring.

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

-- What this endpoint is for -----------------------------------------------

To answer an offer a partner calls POST /job-assignments/{assignment_id}/respond,
and until this endpoint landed there was no way for a partner client to learn
that id. The /partners router had no GET route at all; the current-assignment
shape in the frontend contract is a nested field on the *owner's* GET /jobs/{id}
and a partner cannot read it. The load-test harness worked around the gap by
selecting ids straight out of Postgres, which a real app cannot do — so section
7 deliberately does not do that either. It takes the id from the HTTP response
and answers with it, which is the only assertion that proves the gap is closed.

-- What is actually under test ---------------------------------------------

The filter, and what the payload does not contain.

The filter is "assignment is 'offered' AND job is still 'matching'", which is
the same predicate respond_to_assignment enforces under a row lock before it
writes. Two copies of one rule in two modules; the unit tests pin them to each
other, and sections 3-6 here prove the SQL does what the constant says. Section
6 is the one worth reading: it puts an 'offered' row on a cancelled job by hand,
which is the state a lost cancel-vs-accept race leaves behind, and asserts the
list hides it. Without the job-status half of the filter that row would be
offered to a mechanic for a job the customer already called off.

The payload is the privacy decision. An offer is a question, and a mechanic who
answers "no" must not have learned the customer's name, phone number or exact
position in the process. Section 4 asserts against the owner's real phone number
and the job's real coordinates, read from the database, rather than against a
list of field names — a redaction test that only knows the names it thought of
is a test that passes the day someone adds a new one.

Redis is fakeredis, the single substitution, for the reasons at the top of
check_dispatch_flow.py. Partner availability is set with SQL, as scaffolding, so
each section's offer reaches a known partner.

-- The control run ---------------------------------------------------------

    python tests/integration/check_partner_offers.py --reverted

must FAIL. It removes the /me/offers route from the router before the app is
built, which is exactly the state this repository was in before this task: the
endpoint is a 404 and there is no way to learn an assignment_id over HTTP. It is
a faithful revert precisely because the whole feature is that one route and what
it calls — nothing else in the request path changed.

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
# never purge each other's rows out from under one another. 097x belongs to
# check_dispatch_capacity.py, 096x to check_dispatch_race.py, 095x to
# check_dispatch_flow.py.
QA_DOMAIN = "sahayak-partneroffersqa.invalid"
PHONE_PREFIX = "+91900000098"
JOB_TAG = "POFF-QA"

# alpha receives every offer; beta exists solely to prove the list is scoped to
# the caller — a leak test needs a second partner who was never offered anything
# and whose list must therefore stay empty throughout.
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
    "jobs", "job_status_history", "job_assignments",
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


def offers_for(job_id: str) -> list:
    return rows(
        "SELECT id, partner_id, status, assignment_rank FROM job_assignments "
        "WHERE job_id = %(i)s ORDER BY assignment_rank", {"i": job_id},
    )


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone prefix and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.
    """
    q = conn.cursor()
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
    email = f"poffqa-{label}@{QA_DOMAIN}"
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


def only_available(*labels: str) -> None:
    ids = [partners[label]["id"] for label in labels]
    q = conn.cursor()
    q.execute(
        "UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) "
        "WHERE phone LIKE %(p)s",
        {"ids": ids, "p": PHONE_PREFIX + "%"},
    )


def label_of(partner_id) -> str:
    for label, p in partners.items():
        if p["id"] == str(partner_id):
            return label
    return f"?{str(partner_id)[:8]}"


async def my_offers(c, label: str) -> httpx.Response:
    return await c.get("/api/v1/partners/me/offers", headers=hdr(partners[label]["token"]))


async def offered_job(c, owner_token: str, tag: str, expect: str) -> tuple[str, dict]:
    """Create a job, assert it was offered to `expect`, and return (job_id, offer)."""
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Partner offers QA pickup, Outer Ring Rd",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    live = [o for o in offers_for(job_id) if o["status"] == "offered"]
    if len(live) != 1:
        raise SystemExit(f"job {tag}: expected one live offer, got {offers_for(job_id)}")
    if label_of(live[0]["partner_id"]) != expect:
        raise SystemExit(f"job {tag}: expected the offer to reach {expect}, "
                         f"it reached {label_of(live[0]['partner_id'])}")
    return job_id, live[0]


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    if REVERTED:
        # The control: put the router back the way it was before this task, by
        # removing the one route the task added. Done before app.main imports
        # the router, so the app is built without it and every call below gets
        # the 404 a partner client would have got yesterday.
        from app.api import partners as partners_api      # noqa: E402
        partners_api.router.routes = [
            route for route in partners_api.router.routes
            if not getattr(route, "path", "").endswith("/me/offers")
        ]
        print("*** CONTROL RUN: GET /partners/me/offers has been removed from the "
              "router. This run must FAIL. ***")

    from app.main import app                    # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    owner_phone = (one("SELECT phone FROM users WHERE id = %(i)s", {"i": USER_ID})
                   or {}).get("phone")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://poff.test",
                                 timeout=60.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, two verified partners")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        for label in LABELS:
            _, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Partner Offers QA {label}",
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
            q.execute("UPDATE partners SET verification_status='verified', "
                      "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": pid})

            lat, lng = latlng(OFFSETS_KM[label])
            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": lng}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}

        check("two partners are verified, located and serviced",
              len(partners) == len(LABELS),
              ", ".join(f"{label} {partners[label]['id'][:8]}…" for label in LABELS))

        # ------------------------------------------------------------------
        section("2. An idle partner gets an empty list, not a 404")
        # ------------------------------------------------------------------
        # The ordinary state of a mechanic on shift with no work yet. A 404 here
        # would push every partner app into rendering an error screen for the
        # most common state it will ever be in.
        only_available("alpha")
        r = await my_offers(c, "alpha")
        check("200 with no offers outstanding", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("data is [] rather than null or an object", data_of(r) == [],
              repr(data_of(r))[:80])

        # ------------------------------------------------------------------
        section("3. An outstanding offer appears, with its assignment_id")
        # ------------------------------------------------------------------
        job_one, offer_one = await offered_job(c, owner_token, "job-one", "alpha")

        r = await my_offers(c, "alpha")
        listed = data_of(r) or []
        check("200 with exactly one offer", r.status_code == 200 and len(listed) == 1,
              f"HTTP {r.status_code}, {len(listed)} item(s)")

        item = listed[0] if listed else {}
        check("assignment_id matches the row dispatch wrote",
              item.get("assignment_id") == str(offer_one["id"]),
              f"{str(item.get('assignment_id'))[:8]}… vs {str(offer_one['id'])[:8]}…")
        check("job_id matches the job that was created",
              item.get("job_id") == job_one,
              f"{str(item.get('job_id'))[:8]}… vs {job_one[:8]}…")
        check("the nested job is still 'matching'",
              (item.get("job") or {}).get("status") == "matching",
              str((item.get("job") or {}).get("status")))
        check("the service the owner asked for is named, not just id'd",
              (item.get("job") or {}).get("service_code") == SERVICE_CODE
              and bool((item.get("job") or {}).get("service_name")),
              f"{(item.get('job') or {}).get('service_code')} / "
              f"{(item.get('job') or {}).get('service_name')}")
        check("distance_at_offer_m is populated",
              item.get("distance_at_offer_m") is not None,
              str(item.get("distance_at_offer_m")))
        check("offered_at is populated", bool(item.get("offered_at")),
              str(item.get("offered_at")))

        # ------------------------------------------------------------------
        section("4. The payload does not leak the customer")
        # ------------------------------------------------------------------
        # Asserted against real values read from the database rather than a list
        # of field names, so a field nobody thought to forbid still fails this.
        body_text = r.text
        check("the owner's phone number is absent",
              bool(owner_phone) and owner_phone not in body_text,
              f"owner phone is {len(owner_phone or '')} chars, not in a "
              f"{len(body_text)}-char body")
        check("the owner's user_id is absent", USER_ID not in body_text)
        check("the pickup coordinates are absent",
              f"{PICKUP_LAT}" not in body_text and f"{PICKUP_LNG}" not in body_text,
              "no lat/lng in the body")
        check("the human pickup address IS present — it is what makes the offer "
              "answerable",
              "Outer Ring Rd" in body_text)

        # ------------------------------------------------------------------
        section("5. The list is scoped to the caller")
        # ------------------------------------------------------------------
        # beta was never offered this job. There is no partner_id in the URL to
        # tamper with, so this is really a check that the token is what scopes
        # the query — the failure mode it guards against is a handler that reads
        # an id from anywhere else.
        r_beta = await my_offers(c, "beta")
        check("beta sees an empty list while alpha holds an offer",
              r_beta.status_code == 200 and data_of(r_beta) == [],
              f"HTTP {r_beta.status_code}, {repr(data_of(r_beta))[:60]}")

        r_anon = await c.get("/api/v1/partners/me/offers")
        check("no token is 401", r_anon.status_code == 401,
              f"HTTP {r_anon.status_code} {code_of(r_anon)}")

        r_owner = await c.get("/api/v1/partners/me/offers", headers=hdr(owner_token))
        check("an owner's token is refused", r_owner.status_code in (401, 403),
              f"HTTP {r_owner.status_code} {code_of(r_owner)}")

        # ------------------------------------------------------------------
        section("6. An 'offered' row on a job that has moved is hidden")
        # ------------------------------------------------------------------
        # The state a lost cancel-vs-accept race leaves behind: owner
        # cancellation closes every 'offered' row it finds, but a racing one can
        # commit after it. Put the row back to 'offered' by hand on a cancelled
        # job, which is that remnant exactly, and the list must still hide it —
        # this is the jobs.status = 'matching' half of the filter, and it is the
        # half that stops a mechanic being sent to a job the customer called off.
        job_two, offer_two = await offered_job(c, owner_token, "job-two", "alpha")
        r = await c.post(f"/api/v1/jobs/{job_two}/cancel",
                         json={"cancellation_reason": f"{JOB_TAG} owner changed mind"},
                         headers=hdr(owner_token))
        check("owner cancelled the second job", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        q = conn.cursor()
        q.execute("UPDATE job_assignments SET status='offered', responded_at=NULL "
                  "WHERE id=%(i)s", {"i": offer_two["id"]})
        remnant = one("SELECT a.status AS a_status, j.status AS j_status "
                      "FROM job_assignments a JOIN jobs j ON j.id = a.job_id "
                      "WHERE a.id = %(i)s", {"i": offer_two["id"]})
        check("the remnant is in place: offer 'offered', job 'cancelled'",
              remnant["a_status"] == "offered" and remnant["j_status"] == "cancelled",
              f"{remnant['a_status']} / {remnant['j_status']}")

        r = await my_offers(c, "alpha")
        listed = data_of(r) or []
        ids = {i.get("assignment_id") for i in listed}
        check("the cancelled job's offer is not listed",
              str(offer_two["id"]) not in ids,
              f"{len(listed)} offer(s) listed")
        check("the live offer is still listed",
              str(offer_one["id"]) in ids,
              f"{len(listed)} offer(s) listed")

        # ------------------------------------------------------------------
        section("7. The listed id is the id that answers the offer")
        # ------------------------------------------------------------------
        # The whole point of the endpoint, and the only section that proves it:
        # the assignment_id comes from the HTTP response, never from Postgres,
        # because a partner app has no other source for it.
        r = await my_offers(c, "alpha")
        from_http = (data_of(r) or [{}])[0].get("assignment_id")
        check("an assignment_id was obtained over HTTP alone", bool(from_http),
              str(from_http)[:8] + "…" if from_http else "none")

        r = await c.post(f"/api/v1/job-assignments/{from_http}/respond",
                         json={"action": "accept"},
                         headers=hdr(partners["alpha"]["token"]))
        check("accepting with it succeeds", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        accepted = one("SELECT status FROM job_assignments WHERE id = %(i)s",
                       {"i": from_http})
        check("the assignment is 'accepted' in Postgres",
              (accepted or {}).get("status") == "accepted",
              str((accepted or {}).get("status")))
        check("the job is 'assigned' in Postgres",
              (one("SELECT status FROM jobs WHERE id = %(i)s",
                   {"i": job_one}) or {}).get("status") == "assigned")

        # ------------------------------------------------------------------
        section("8. An answered offer leaves the list")
        # ------------------------------------------------------------------
        # An accepted job is not an outstanding offer. It belongs on a "my jobs"
        # screen, which is a different question and a different endpoint; leaving
        # it here would have the partner app showing an Accept button for work it
        # already holds.
        r = await my_offers(c, "alpha")
        check("alpha's offer list is empty again",
              r.status_code == 200 and data_of(r) == [],
              f"HTTP {r.status_code}, {repr(data_of(r))[:60]}")

    # ----------------------------------------------------------------------
    section("9. Cleanup")
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
              "run that passes means this harness is not testing the endpoint.")
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
