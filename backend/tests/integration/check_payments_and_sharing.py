"""Live check: payments, public share links, and vehicle delete (2026-11-13 fixes).

Run it directly — it needs no server process:

    python tests/integration/check_payments_and_sharing.py

Not named test_*.py: it writes to the real database and creates real Supabase
accounts. Helpers are copied from check_ratings.py (same owner, same lifecycle
scaffolding); the QA range is +91900000092x / PAY-QA / sahayak-payqa.invalid.

Why a live harness for these: the unit tests monkeypatch every repository, so
they cannot see a foreign key or an asyncpg PREPARE. The vehicle-delete defect
is a foreign key, and only the database can show it is gone.

-- What it proves --------------------------------------------------------
1. ADR-017 amendment: public tracking without the owner's share token is 404,
   even though the offered partner knows the job id; with the token it is 200,
   and an unanswered offer is not named as the rescuer.
2. ADR-022: the owner cannot mark a payment paid; the assigned partner can; a
   client-sent amount is ignored; GET is read-only (404 before an order exists).
3. A vehicle with a completed job in its history can be deleted, and the job
   keeps its vehicle_number snapshot.

Cleanup runs at both ends, survives a crash, and the run FAILS if the table
counts do not return to their baseline.
"""
import asyncio
import sys
import uuid
from typing import Optional
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


USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
# The shared "Test Driver QA" users row every harness links its owner identity to.
# link-auth binds on the token's phone claim as of 2026-10-07, so the owner account
# has to be created carrying this number.
TEST_DRIVER_PHONE = "+919000000001"

VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LNG = 111.32 * 0.9205    # cos(23°) ≈ 0.9205

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another. 098x belongs to
# check_partner_offers.py, 097x to check_dispatch_capacity.py, 096x to
# check_dispatch_race.py, 090x to check_dispatch_flow.py.
QA_DOMAIN = "sahayak-payqa.invalid"
PHONE_PREFIX = "+91900000092"
JOB_TAG = "PAY-QA"

# alpha does every job and is the partner whose average must move. beta is never
# offered anything and never accepts anything: they exist to prove that "a
# verified partner with a valid token" is not the same as "a party to this job".
LABELS = ("alpha", "beta")
SCRATCH_PLATE = "QA92PAY0001"
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
    "jobs", "job_status_history", "job_assignments", "ratings", "payments",
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
        "DELETE FROM payments WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    # The scratch vehicle section 4 deletes; jobs pointing at it are QA jobs.
    q.execute(
        "UPDATE jobs SET vehicle_id = NULL WHERE vehicle_id IN "
        "(SELECT id FROM vehicles WHERE vehicle_number = %(n)s)", {"n": SCRATCH_PLATE},
    )
    q.execute("DELETE FROM vehicles WHERE vehicle_number = %(n)s", {"n": SCRATCH_PLATE})
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


def _reclaim_phone(phone: str) -> None:
    """Delete any existing Supabase account holding `phone`.

    Only QA numbers ever reach here (every caller passes a +9190000xxxxx test
    number), so this cannot touch a real account.
    """
    digits = phone.lstrip("+")
    r = _supa_call("GET", "/auth/v1/admin/users", headers=_admin_headers,
                    params={"per_page": 200})
    if r.status_code != 200:
        return
    for u in r.json().get("users", []):
        if (u.get("phone") or "").lstrip("+") == digits:
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str, phone: Optional[str] = None) -> tuple[str, str]:
    """Create a real Supabase account and sign in. Returns (auth_user_id, token).

    `phone`, when given, is set on the account and confirmed, so the access token
    carries a phone claim alongside the email one. Both link-auth endpoints bind
    on that claim as of 2026-10-07 — a token that has not proved the profile's
    number gets a 404 — so every identity that links something must pass the
    number of the row it is about to link. Measured: one account can hold an
    email and a phone, and an email+password sign-in still carries the phone
    claim, which is why the sign-in below and the cleanup above are unchanged.
    """
    if phone:
        # Supabase enforces phone uniqueness project-wide, and every harness's
        # owner identity carries the same shared test-driver number. A previous
        # run that crashed before cleanup leaves that number taken, which would
        # fail this harness for something the previous one did — so reclaim it.
        _reclaim_phone(phone)
    email = f"payqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa_call(
        "POST", "/auth/v1/admin/users", headers=_admin_headers,
        json={"email": email, "password": password, "email_confirm": True,
              **({"phone": phone, "phone_confirm": True} if phone else {})},
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

async def job_through_to(c, tag: str, final_status: str, price: float | None = None,
                         vehicle_id: str = VEHICLE_ID) -> str:
    """Create a job, have alpha accept it, and walk it to `final_status`.

    Scaffolding, not an assertion: every step here is already covered by
    check_job_lifecycle.py and check_dispatch_flow.py. A failure raises SystemExit
    rather than recording a check, so a broken lifecycle shows up as a broken
    lifecycle and not as a mysterious rating failure.
    """
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": vehicle_id, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Payments QA pickup, Outer Ring Rd",
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
        if step == "in_progress":  # POST /start only, with the owner's code
            r = await c.post(f"/api/v1/jobs/{job_id}/start",
                             json={"start_code": one("SELECT start_code FROM jobs WHERE id = %(i)s", {"i": job_id})["start_code"]}, headers=hdr(token))
        else:
            body: dict = {"status": step}
            if step == "completed":
                body["price_final"] = price if price is not None else 500
            r = await c.post(f"/api/v1/jobs/{job_id}/status", json=body, headers=hdr(token))
        if r.status_code != 200:
            raise SystemExit(f"job {tag} → {step} failed: {r.status_code} {r.text[:300]}")

    return job_id


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned, owner_token

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    from app.main import app                    # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://pay.test",
                                 timeout=60.0) as c:

        section("1. One owner, two verified partners")
        _, owner_token = supabase_identity("owner", TEST_DRIVER_PHONE)
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        for label in LABELS:
            _, token = supabase_identity(label, PARTNER_PHONES[label])
            r = await c.post("/api/v1/partners", json={
                "name": f"Payments QA {label}",
                "phone": PARTNER_PHONES[label],
                "primary_category_code": "mechanical",
            })
            if r.status_code != 201:
                raise SystemExit(f"{label} partner registration failed: {r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]
            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} link-auth failed: {r.status_code} {r.text[:300]}")
            conn.cursor().execute(
                "UPDATE partners SET verification_status='verified' WHERE id=%(i)s", {"i": pid})
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
        alpha = partners["alpha"]["token"]
        beta = partners["beta"]["token"]

        section("2. Public tracking needs the owner's share token (ADR-017 amendment)")
        # An offered-but-unanswered job: alpha holds the offer and so knows the id.
        r = await c.post("/api/v1/jobs", json={
            "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
            "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
            "pickup_address_text": "Payments QA pickup, Outer Ring Rd",
            "issue_description": f"{JOB_TAG} offered",
        }, headers=hdr(owner_token))
        if r.status_code != 201:
            raise SystemExit(f"offered job creation failed: {r.status_code} {r.text[:300]}")
        offered_id = data_of(r)["id"]
        offer = one("SELECT partner_id FROM job_assignments WHERE job_id=%(i)s AND status='offered'",
                    {"i": offered_id})
        check("alpha holds an unanswered offer", offer is not None
              and str(offer["partner_id"]) == partners["alpha"]["id"], f"{offer}")

        r = await c.get(f"/api/v1/jobs/{offered_id}/public-tracking")
        check("no token -> 404 JOB_NOT_FOUND", r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")
        r = await c.get(f"/api/v1/jobs/{offered_id}/public-tracking", params={"t": "0" * 32})
        check("wrong token -> 404 JOB_NOT_FOUND", r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.get(f"/api/v1/jobs/{offered_id}", headers=hdr(owner_token))
        share = (data_of(r) or {}).get("share_token")
        check("owner's job detail carries share_token", bool(share), f"{share!r}")
        r = await c.get(f"/api/v1/jobs/{offered_id}", headers=hdr(alpha))
        check("offered partner's job detail does not",
              r.status_code != 200 or not (data_of(r) or {}).get("share_token"),
              f"HTTP {r.status_code}")

        r = await c.get(f"/api/v1/jobs/{offered_id}/public-tracking", params={"t": share})
        d = data_of(r) or {}
        check("owner's token -> 200 with pickup", r.status_code == 200 and d.get("pickup_lat") is not None,
              f"HTTP {r.status_code} {code_of(r)}")
        check("an unanswered offer is not shown as the rescuer", d.get("partner_name") is None,
              f"{d.get('partner_name')!r}")
        r = await c.post(f"/api/v1/jobs/{offered_id}/cancel", json={"cancellation_reason": "QA"}, headers=hdr(owner_token))
        if r.status_code != 200:
            raise SystemExit(f"cancel offered job failed: {r.status_code} {r.text[:300]}")

        section("3. Payments (ADR-022)")
        job_id = await job_through_to(c, "paid", "completed", price=899)

        r = await c.get(f"/api/v1/payments/job/{job_id}", headers=hdr(owner_token))
        check("GET before any order -> 404 PAYMENT_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "PAYMENT_NOT_FOUND", f"HTTP {r.status_code} {code_of(r)}")
        check("...and wrote nothing",
              one("SELECT count(*) AS n FROM payments WHERE job_id=%(i)s", {"i": job_id})["n"] == 0)

        r = await c.post("/api/v1/payments", json={"job_id": job_id, "amount": "1.00",
                                                   "payment_method": "upi"}, headers=hdr(owner_token))
        d = data_of(r) or {}
        check("owner opens an order -> 201", r.status_code == 201, f"HTTP {r.status_code} {code_of(r)}")
        check("client amount 1.00 ignored; amount is the job's 899",
              str(d.get("amount")) in ("899.00", "899", "899.0"), f"{d.get('amount')!r}")
        payment_id = d.get("id")

        r = await c.post(f"/api/v1/payments/{payment_id}/confirm",
                         json={"payment_method": "upi", "gateway_ref_id": "FAKE"}, headers=hdr(owner_token))
        check("owner confirming own payment -> 403 FORBIDDEN",
              r.status_code == 403 and code_of(r) == "FORBIDDEN", f"HTTP {r.status_code} {code_of(r)}")
        check("...and it is still pending",
              one("SELECT status FROM payments WHERE id=%(i)s", {"i": payment_id})["status"] == "pending")

        r = await c.post(f"/api/v1/payments/{payment_id}/confirm", json={"payment_method": "cash"},
                         headers=hdr(beta))
        check("unrelated partner -> 404 JOB_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND", f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/payments/{payment_id}/confirm", json={"payment_method": "cash"},
                         headers=hdr(alpha))
        check("assigned partner confirms -> 200 paid",
              r.status_code == 200 and (data_of(r) or {}).get("status") == "paid",
              f"HTTP {r.status_code} {code_of(r)}")
        r = await c.get(f"/api/v1/payments/job/{job_id}", headers=hdr(owner_token))
        check("owner now reads it as paid", (data_of(r) or {}).get("status") == "paid",
              f"HTTP {r.status_code} {code_of(r)}")

        section("4. Deleting a vehicle that has job history")
        r = await c.post("/api/v1/vehicles", json={"vehicle_type": "four_wheeler", "make": "QA",
                                                   "model": "Scratch", "vehicle_number": SCRATCH_PLATE},
                         headers=hdr(owner_token))
        check("scratch vehicle registered", r.status_code == 201, f"HTTP {r.status_code} {code_of(r)}")
        scratch_id = (data_of(r) or {}).get("id")
        hist_job = await job_through_to(c, "vehicle-history", "completed", price=300, vehicle_id=scratch_id)

        r = await c.delete(f"/api/v1/vehicles/{scratch_id}", headers=hdr(owner_token))
        check("DELETE a vehicle with a completed job -> 200", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        row = one("SELECT vehicle_id, vehicle_number FROM jobs WHERE id=%(i)s", {"i": hist_job})
        check("the job keeps its vehicle_number snapshot",
              row["vehicle_id"] is None and row["vehicle_number"] == SCRATCH_PLATE, f"{row}")
        check("the vehicle row is gone",
              one("SELECT count(*) AS n FROM vehicles WHERE id=%(i)s", {"i": scratch_id})["n"] == 0)

    section("5. Cleanup")
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
    print("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        if not _cleaned:
            print("\n! run did not finish — purging anyway")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as exc:      # noqa: BLE001
                print(f"  ! cleanup failed: {type(exc).__name__}")
    sys.exit(summarise())
