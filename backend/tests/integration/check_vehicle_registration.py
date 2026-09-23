"""Live end-to-end check of vehicle registration, listing and single fetch.

Run it directly — it needs no server process:

    python tests/integration/check_vehicle_registration.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

What makes this harness different from the ones before it: **nothing is inserted
by hand.** Every previous job harness leaned on a vehicle row that had been put
in the database manually, because until now there was no other way to get one —
which meant the owner-facing path had a hole in the middle that no amount of API
testing could have found. Section 8 is the whole chain end to end, driven only
through HTTP: register an owner, register their vehicle, request help with it,
watch dispatch offer it to a mechanic. If section 8 passes, a real person can use
this system from a standing start for the first time.

Section 5 is the one guarding a decision that is easy to "fix" into a bug later:
an owner with no vehicles gets `200` and `[]`, not `404`. That is the state every
user is in between finishing signup and adding their first car.

Section 6 checks the anti-enumeration rule the same way check_job_cancellation.py
checks ownership — against a *second real registered owner*, not a forged id. A
404 that is only a 404 for ids that do not exist is not anti-enumeration at all,
and the only way to prove it is to hold a real vehicle belonging to somebody else
and ask for it.

The database is real and every assertion about what was *stored* is made against
Postgres, not against the API's own response body. Tokens are real Supabase
tokens. Redis is fakeredis, the single substitution, for the reasons set out at
the top of check_dispatch_flow.py.

Cleanup runs at both ends and the run FAILS if the table counts do not return to
their baseline.
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

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False
SERVICE_ID = 3

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
NEAR_LAT = PICKUP_LAT + 1.0 / KM_PER_DEG_LAT

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another.
QA_DOMAIN = "sahayak-vehicleqa.invalid"
OWNER_A_PHONE = "+919000000941"
OWNER_B_PHONE = "+919000000942"
OWNER_C_PHONE = "+919000000943"   # the untouched owner of section 8
OWNER_PHONES = (OWNER_A_PHONE, OWNER_B_PHONE, OWNER_C_PHONE)
PARTNER_PHONE = "+919000000944"
JOB_TAG = "VEHICLE-QA"

# Set once section 9's purge has run, so the emergency cleanup in __main__ can
# tell "the run finished and some checks failed" apart from "the run died
# somewhere in the middle" — only the second needs cleaning up after.
_cleaned = False

# Deliberately *not* the shared seed vehicle. This harness must not depend on a
# manually-inserted row — that dependency is the thing it exists to remove.
_results: list[tuple[bool, str, str]] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


# --------------------------------------------------------------------------
# Database access — used only to verify and to clean up.
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


def vehicle_row(vehicle_id: str) -> dict:
    return one(
        "SELECT id, user_id, vehicle_type, make, model, vehicle_number, created_at "
        "FROM vehicles WHERE id = %(i)s", {"i": vehicle_id},
    ) or {}


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone numbers and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.

    Jobs go before vehicles even though users→vehicles cascades, because
    jobs.vehicle_id has no ON DELETE clause: deleting a vehicle out from under a
    job would fail on the constraint, and the failure would come *after* the
    assertions, leaving half the QA data behind.
    """
    q = conn.cursor()
    owner_ids_sql = "SELECT id FROM users WHERE phone = ANY(%(owners)s)"
    job_scope = (
        f"SELECT id FROM jobs WHERE issue_description LIKE %(tag)s "
        f"OR vehicle_id IN (SELECT id FROM vehicles WHERE user_id IN ({owner_ids_sql}))"
    )
    scope = {"tag": JOB_TAG + "%", "owners": list(OWNER_PHONES)}

    q.execute(f"DELETE FROM job_status_history WHERE job_id IN ({job_scope})", scope)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN ({job_scope})", scope)
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = %(p)s)", {"p": PARTNER_PHONE},
    )
    q.execute(
        "DELETE FROM jobs WHERE issue_description LIKE %(tag)s "
        f"OR vehicle_id IN (SELECT id FROM vehicles WHERE user_id IN ({owner_ids_sql}))",
        scope,
    )
    q.execute(
        f"DELETE FROM vehicles WHERE user_id IN ({owner_ids_sql})",
        {"owners": list(OWNER_PHONES)},
    )
    q.execute(
        "DELETE FROM partner_services WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = %(p)s)", {"p": PARTNER_PHONE},
    )
    q.execute("DELETE FROM partners WHERE phone = %(p)s", {"p": PARTNER_PHONE})
    q.execute("DELETE FROM users WHERE phone = ANY(%(owners)s)", {"owners": list(OWNER_PHONES)})


# --------------------------------------------------------------------------
# Supabase accounts — real tokens, same approach as check_auth_flow.py.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=60.0)


def _supa_call(method: str, url: str, attempts: int = 3, **kwargs) -> httpx.Response:
    """Call Supabase, retrying a *transport* failure but never a rejection.

    Supabase is over the public internet and a read timeout here is weather, not
    a result — a single dropped packet partway through account setup would
    otherwise abort a run and leave QA rows behind. Only httpx.TransportError is
    retried: a 4xx is an answer, and retrying an answer turns a real failure into
    a slower real failure.
    """
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
    email = f"vehicleqa-{label}@{QA_DOMAIN}"
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
    except Exception:
        return "?"


def message_of(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("message", "")
    except Exception:
        return ""


def data_of(r: httpx.Response):
    try:
        return r.json().get("data")
    except Exception:
        return None


async def register_owner(c, label: str, phone: str, name: str) -> tuple[str, str]:
    """Sign up a brand-new vehicle owner through the public route.

    Returns (user_id, token). No row is inserted by hand anywhere in this
    harness, which is the point of the whole exercise — see the module docstring.
    """
    _, token = supabase_identity(label)
    r = await c.post("/api/v1/users", json={"name": name, "phone": phone}, headers=hdr(token))
    if r.status_code != 201:
        raise SystemExit(f"{label} registration failed: {r.status_code} {r.text[:300]}")
    return data_of(r)["id"], token


async def add_vehicle(c, token: str, **body) -> httpx.Response:
    return await c.post("/api/v1/vehicles", json=body, headers=hdr(token))


async def main() -> None:
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app  # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://vehicle.test") as c:

        # ------------------------------------------------------------------
        section("1. Two real owners, both signed up through the API")
        # ------------------------------------------------------------------
        owner_a_id, owner_a_token = await register_owner(
            c, "owner-a", OWNER_A_PHONE, "Vehicle QA Owner A")
        check("owner A registered", bool(owner_a_id), f"user_id {owner_a_id[:8]}…")

        owner_b_id, owner_b_token = await register_owner(
            c, "owner-b", OWNER_B_PHONE, "Vehicle QA Owner B")
        check("owner B registered as a separate owner",
              owner_b_id != owner_a_id, f"user_id {owner_b_id[:8]}…")

        # ------------------------------------------------------------------
        section("2. Registering a vehicle (spec #1)")
        # ------------------------------------------------------------------
        r = await add_vehicle(c, owner_a_token, vehicle_type="four_wheeler",
                              make="Maruti", model="Swift", vehicle_number="QA01AB1234")
        check("POST /vehicles returns 201", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        created = data_of(r) or {}
        vehicle_a1 = created.get("id")
        check("the response carries the new vehicle's id", bool(vehicle_a1))
        check("the response echoes what was registered",
              created.get("vehicle_type") == "four_wheeler"
              and created.get("make") == "Maruti"
              and created.get("model") == "Swift",
              f"{created.get('vehicle_type')} / {created.get('make')} {created.get('model')}")
        check("created_at comes back populated", bool(created.get("created_at")),
              str(created.get("created_at")))

        stored = vehicle_row(vehicle_a1)
        # The assertion that matters: the owner was taken from the token. Checked
        # in Postgres rather than in the response, which does not even carry
        # user_id — a response-only check would be reading back the same
        # assumption it is supposed to be testing.
        check("vehicles.user_id was set from the token",
              str(stored.get("user_id")) == owner_a_id,
              f"stored {str(stored.get('user_id'))[:8]}… vs token owner {owner_a_id[:8]}…")
        check("the row really is in Postgres, not just in the response",
              stored.get("vehicle_number") == "QA01AB1234")

        # ------------------------------------------------------------------
        section("3. What the endpoint refuses")
        # ------------------------------------------------------------------
        # user_id is not a field on VehicleCreateRequest, and extra="forbid"
        # turns sending one into a 422 rather than a silent no-op. Silently
        # dropping it is how a client comes to believe it works — and this is the
        # exact field where believing that would mean registering vehicles to
        # other people.
        r = await add_vehicle(c, owner_a_token, vehicle_type="two_wheeler",
                              vehicle_number="QA09XX0009", user_id=owner_b_id)
        check("a user_id in the body is refused outright", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")
        check("...and nothing was written for it",
              one("SELECT id FROM vehicles WHERE vehicle_number = %(n)s",
                  {"n": "QA09XX0009"}) is None)

        for label, number in (("empty", "   "), ("too short", "AB"),
                              ("punctuation", "QA01/AB/1234"), ("over-long", "Q" * 21)):
            r = await add_vehicle(c, owner_a_token, vehicle_type="four_wheeler",
                                  vehicle_number=number)
            check(f"a {label} registration number is refused",
                  r.status_code in (400, 422),
                  f"HTTP {r.status_code} {code_of(r)}")

        r = await add_vehicle(c, owner_a_token, vehicle_type="spaceship",
                              vehicle_number="QA02CD5678")
        check("an unknown vehicle_type is refused", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("4. Registration-number normalisation (spec #7)")
        # ------------------------------------------------------------------
        r = await add_vehicle(c, owner_a_token, vehicle_type="two_wheeler",
                              make="Honda", model="Activa",
                              vehicle_number="qa 07 zz 4321")
        check("a spaced, lower-case number is accepted", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        vehicle_a2 = (data_of(r) or {}).get("id")
        check("the response shows the normalised form",
              (data_of(r) or {}).get("vehicle_number") == "QA07ZZ4321",
              str((data_of(r) or {}).get("vehicle_number")))
        check("Postgres stored the normalised form, not what was typed",
              vehicle_row(vehicle_a2).get("vehicle_number") == "QA07ZZ4321",
              str(vehicle_row(vehicle_a2).get("vehicle_number")))

        # The decision under test is not "spaces are stripped", it is "one real
        # vehicle is one string". Hyphens and mixed case must land on the same
        # value as the spaced version above.
        r = await add_vehicle(c, owner_a_token, vehicle_type="two_wheeler",
                              vehicle_number="Qa-07-Zz-4321")
        vehicle_a3 = (data_of(r) or {}).get("id")
        check("a hyphenated spelling of the same plate normalises identically",
              vehicle_row(vehicle_a3).get("vehicle_number") == "QA07ZZ4321")

        # ...and is *not* refused as a duplicate. This is the documented
        # no-global-uniqueness decision, asserted rather than assumed, because a
        # well-meaning future UNIQUE index would break it silently. See ADR-014.
        check("registering the same number twice is allowed", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        check("...and produced a genuinely separate row", vehicle_a3 != vehicle_a2)

        # ------------------------------------------------------------------
        section("5. Listing (spec #2, #3)")
        # ------------------------------------------------------------------
        r = await c.get("/api/v1/vehicles", headers=hdr(owner_b_token))
        check("an owner with no vehicles gets 200, not 404", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("...and an empty array rather than an error", data_of(r) == [],
              repr(data_of(r)))

        r = await c.get("/api/v1/vehicles", headers=hdr(owner_a_token))
        listed = data_of(r) or []
        check("owner A's list returns every vehicle they registered",
              len(listed) == 3, f"{len(listed)} returned")
        check("the list contains exactly their own rows",
              {v["id"] for v in listed} == {vehicle_a1, vehicle_a2, vehicle_a3})
        # Newest first, because the list feeds a picker and the vehicle someone
        # just added is the one they are about to choose.
        check("newest is first",
              [v["id"] for v in listed] == [vehicle_a3, vehicle_a2, vehicle_a1],
              " → ".join(v["vehicle_number"] for v in listed))
        check("the list leaks no owner id", all("user_id" not in v for v in listed))

        # ------------------------------------------------------------------
        section("6. Single fetch and the anti-enumeration rule (spec #4, #5, #6)")
        # ------------------------------------------------------------------
        r = await c.get(f"/api/v1/vehicles/{vehicle_a1}", headers=hdr(owner_a_token))
        check("fetching your own vehicle returns 200", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("...with the right vehicle",
              (data_of(r) or {}).get("vehicle_number") == "QA01AB1234")

        # Owner B asking for owner A's vehicle. A real second account holding a
        # real other-owner id — the only version of this test worth running.
        r_theirs = await c.get(f"/api/v1/vehicles/{vehicle_a1}", headers=hdr(owner_b_token))
        check("fetching someone else's vehicle returns 404, not 403",
              r_theirs.status_code == 404, f"HTTP {r_theirs.status_code} {code_of(r_theirs)}")
        check("...with VEHICLE_NOT_FOUND",
              code_of(r_theirs) == "VEHICLE_NOT_FOUND", code_of(r_theirs))

        r_missing = await c.get(f"/api/v1/vehicles/{uuid.uuid4()}", headers=hdr(owner_b_token))
        check("fetching a vehicle that does not exist returns 404",
              r_missing.status_code == 404,
              f"HTTP {r_missing.status_code} {code_of(r_missing)}")

        # The decision, stated as an assertion: if these two ever differ, the
        # endpoint becomes an existence oracle and anyone walking UUIDs can count
        # the platform's vehicles.
        check("the two 404s are indistinguishable",
              (r_theirs.status_code, code_of(r_theirs), message_of(r_theirs))
              == (r_missing.status_code, code_of(r_missing), message_of(r_missing)),
              f"{code_of(r_theirs)} / {code_of(r_missing)}")
        check("...and neither reveals whether the id exists",
              message_of(r_theirs) == message_of(r_missing),
              repr(message_of(r_theirs)))

        # ------------------------------------------------------------------
        section("7. Who may call these endpoints at all")
        # ------------------------------------------------------------------
        _, partner_token = supabase_identity("partner")
        r = await c.post("/api/v1/partners", json={
            "name": "Vehicle QA Mechanic", "phone": PARTNER_PHONE,
            "primary_category_code": "mechanical",
        })
        if r.status_code != 201:
            raise SystemExit(f"partner registration failed: {r.status_code} {r.text[:300]}")
        partner_id = data_of(r)["id"]
        r = await c.post(f"/api/v1/partners/{partner_id}/link-auth", headers=hdr(partner_token))
        if r.status_code != 200:
            raise SystemExit(f"partner link-auth failed: {r.status_code} {r.text[:300]}")

        for label, path in (("list", "/api/v1/vehicles"),
                            ("fetch", f"/api/v1/vehicles/{vehicle_a1}")):
            r = await c.get(path, headers=hdr(partner_token))
            check(f"a partner token cannot {label} vehicles", r.status_code == 403,
                  f"HTTP {r.status_code} {code_of(r)}")

        r = await add_vehicle(c, partner_token, vehicle_type="four_wheeler",
                              vehicle_number="QA99PP9999")
        check("a partner token cannot register a vehicle", r.status_code == 403,
              f"HTTP {r.status_code} {code_of(r)}")

        for label, path in (("list", "/api/v1/vehicles"),
                            ("fetch", f"/api/v1/vehicles/{vehicle_a1}")):
            r = await c.get(path)
            check(f"an unauthenticated {label} is refused", r.status_code == 401,
                  f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post("/api/v1/vehicles", json={
            "vehicle_type": "four_wheeler", "vehicle_number": "QA98PP9998"})
        check("an unauthenticated registration is refused", r.status_code == 401,
              f"HTTP {r.status_code} {code_of(r)}")
        check("...and wrote nothing",
              one("SELECT id FROM vehicles WHERE vehicle_number = %(n)s",
                  {"n": "QA98PP9998"}) is None)

        # ------------------------------------------------------------------
        section("8. The whole owner path, nothing inserted by hand (spec #8)")
        # ------------------------------------------------------------------
        # Put the mechanic on shift so the job has somewhere to go. This is the
        # only part of the section that is not owner-driven, and it is setup
        # rather than subject: verification has no endpoint yet, so it is set
        # directly rather than pretended away.
        q = conn.cursor()
        q.execute("UPDATE partners SET verification_status='verified', "
                  "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": partner_id})
        for path, body in (
            (f"/api/v1/partners/{partner_id}/services", {"service_codes": [SERVICE_CODE]}),
            (f"/api/v1/partners/{partner_id}/location", {"lat": NEAR_LAT, "lng": PICKUP_LNG}),
        ):
            r = await c.post(path, json=body, headers=hdr(partner_token))
            if r.status_code != 200:
                raise SystemExit(f"partner setup {path} failed: {r.status_code} {r.text[:300]}")
        r = await c.patch(f"/api/v1/partners/{partner_id}/availability",
                          json={"is_available": True}, headers=hdr(partner_token))
        if r.status_code != 200:
            raise SystemExit(f"availability toggle failed: {r.status_code} {r.text[:300]}")

        # A third owner, untouched by any earlier section, so this is genuinely a
        # cold start and not a continuation of state built up above.
        owner_c_id, owner_c_token = await register_owner(
            c, "owner-c", OWNER_C_PHONE, "Vehicle QA Owner C")
        check("step 1 — a brand-new owner signs up", bool(owner_c_id),
              f"user_id {owner_c_id[:8]}…")

        r = await add_vehicle(c, owner_c_token, vehicle_type="four_wheeler",
                              make="Hyundai", model="i20", vehicle_number="QA05EF8765")
        check("step 2 — they register their vehicle", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        vehicle_c = (data_of(r) or {}).get("id")

        r = await c.post("/api/v1/jobs", json={
            "vehicle_id": vehicle_c, "service_code": SERVICE_CODE,
            "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
            "pickup_address_text": "Vehicle QA pickup",
            "issue_description": f"{JOB_TAG} end-to-end",
        }, headers=hdr(owner_c_token))
        check("step 3 — they request help with it", r.status_code == 201,
              f"HTTP {r.status_code} {code_of(r)}")
        job = data_of(r) or {}
        job_id = job.get("id")

        stored_job = one("SELECT status, vehicle_id, vehicle_number, user_id "
                         "FROM jobs WHERE id = %(i)s", {"i": job_id}) or {}
        check("the job is bound to the vehicle they just registered",
              str(stored_job.get("vehicle_id")) == vehicle_c)
        check("the job owner is the owner who registered it",
              str(stored_job.get("user_id")) == owner_c_id)
        # The snapshot create_job takes: the plate is copied onto the job, in its
        # normalised form, so the job stays truthful if the vehicle is later
        # edited or deleted.
        check("the normalised plate was snapshotted onto the job",
              stored_job.get("vehicle_number") == "QA05EF8765",
              str(stored_job.get("vehicle_number")))

        offer = one("SELECT id, partner_id, status FROM job_assignments "
                    "WHERE job_id = %(i)s ORDER BY offered_at DESC", {"i": job_id})
        check("step 4 — dispatch offered it to the mechanic", offer is not None,
              f"job status {stored_job.get('status')}")
        check("...to the QA mechanic specifically",
              offer is not None and str(offer["partner_id"]) == partner_id)
        check("the job moved off 'requested'",
              stored_job.get("status") == "matching", str(stored_job.get("status")))

        # And the ownership check still bites: owner A cannot raise a job against
        # owner C's vehicle. Same 404, same reason.
        r = await c.post("/api/v1/jobs", json={
            "vehicle_id": vehicle_c, "service_code": SERVICE_CODE,
            "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
            "issue_description": f"{JOB_TAG} cross-owner attempt",
        }, headers=hdr(owner_a_token))
        check("another owner cannot raise a job against that vehicle",
              r.status_code == 404 and code_of(r) == "VEHICLE_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

    # ----------------------------------------------------------------------
    section("9. Cleanup and baseline (spec #9)")
    # ----------------------------------------------------------------------
    global _cleaned
    purge()
    purge_supabase_accounts()
    _cleaned = True
    final_counts = counts()
    check("every table is back to its baseline count", final_counts == baseline,
          f"{final_counts} vs {baseline}")
    check("no QA vehicle rows survive",
          one("SELECT id FROM vehicles WHERE vehicle_number LIKE 'QA%%'") is None)
    check("no QA owner rows survive",
          one("SELECT id FROM users WHERE phone = ANY(%(p)s)",
              {"p": list(OWNER_PHONES)}) is None)

    passed = sum(1 for ok, _, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 60}\n{passed}/{total} checks passed")
    if passed != total:
        print("\nFailures:")
        for ok, label, detail in _results:
            if not ok:
                print(f"  - {label}  ({detail})")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        # Cleanup has to survive a crash, not just a clean finish. Section 9
        # runs inside main(), so anything that escapes before it — a dropped
        # connection to Supabase, a KeyboardInterrupt, an assertion blowing up
        # mid-section — would otherwise leave QA rows behind. The next run's
        # opening purge would tidy them, but its *baseline* is measured after
        # that purge and before its own writes, so the leftovers would silently
        # become part of the expected state. Purging here keeps the baseline
        # meaningful.
        #
        # Guarded by _cleaned so a run that finished and merely *failed* some
        # checks does not re-purge and claim it died.
        if not _cleaned:
            print("\n! run did not finish — cleaning up before exiting")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as cleanup_error:      # noqa: BLE001
                print(f"  ! cleanup itself failed: {cleanup_error}")
        raise
    finally:
        conn.close()
