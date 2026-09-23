"""Live end-to-end check of owner registration: POST /api/v1/users.

Run against a server started with the same .env this script reads:

    python -m uvicorn app.main:app --port 8010
    python tests/integration/check_user_registration.py

Not named test_*.py on purpose: pytest must not collect it, because it needs a
live server, a live database and a live Supabase project rather than fixtures.

Tokens are REAL Supabase-issued tokens, for the reason check_auth_flow.py sets
out at length — a harness that mints its own credentials cannot tell you whether
you would accept the issuer's.

This file asks for **phone** accounts, which check_auth_flow.py does not.
Registration's interesting logic hangs off the token's phone claim
(phone_verified, PHONE_MISMATCH, and the IDENTITY_NOT_LINKED split), and an
email-only account carries no such claim.

As of 2026-09-20 this project answers `phone_provider_disabled` to a phone
sign-in: the Admin API will create a phone account, but the password grant
refuses to issue a token for one, so there is no way to obtain a phone-claim
token from it at all. The script detects that, falls back to email accounts, and
SKIPS the three phone-claim assertions by name — it does not quietly pass them.
Those branches are covered instead in tests/unit/test_user_service.py, which can
construct the claims directly. Turn on the phone provider in the Supabase
dashboard and this file will exercise them live with no edit.

Assertions are made against the database with psycopg2 wherever the database is
what matters. A response body saying auth_user_id was set is the API repeating
its own input back; the row is the fact.
"""
import sys
import uuid
from pathlib import Path

# Windows consoles default to cp1252 and cannot encode the dashes below. A
# UnicodeEncodeError from print() would abort between the assertions and the
# cleanup, leaving QA rows behind — the one failure mode this script must not
# have, since its rows hold unique phone numbers that would block the next run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx  # noqa: E402
import psycopg2  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

BASE = "http://127.0.0.1:8010"
S = get_settings()
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

# A range of its own, so a crashed check_auth_flow.py run (+9190000008xx) and a
# crashed run of this file cannot purge each other's leftovers.
PHONE_A = "+919000000901"          # registers successfully
PHONE_B = "+919000000902"          # A's second attempt, on a different number
PHONE_C = "+919000000903"          # a second account, re-submitting A's number
PHONE_MISMATCH = "+919000000904"   # submitted by an account that verified PHONE_D
PHONE_D = "+919000000905"
PHONE_PARTNER = "+919000000906"    # an unclaimed mechanic profile, never registered
QA_PHONES = (PHONE_A, PHONE_B, PHONE_C, PHONE_MISMATCH, PHONE_D, PHONE_PARTNER)

QA_DOMAIN = "sahayak-regqa.invalid"
SERVICE_CODE = "battery_jumpstart"
VEHICLE_TYPE = "four_wheeler"      # vehicles_vehicle_type_check: two_wheeler | four_wheeler

_results: list[tuple[bool, str, str]] = []
_skipped: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f"  - {detail}" if detail else ""))


def skip(label: str, why: str) -> None:
    """Record a check that could not run. Counted separately - never as a pass."""
    _skipped.append(f"{label} ({why})")
    print(f"  [SKIP] {label}  - {why}")


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


_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=30.0)
c = httpx.Client(base_url=BASE, timeout=30.0)

dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True


# ------------------------------------------------------------------ cleanup
def purge_supabase_accounts() -> None:
    """Delete every QA account this script could have created, by email or phone.

    Supabase reports phones without the '+', so both spellings are compared.
    """
    bare = {p.lstrip("+") for p in QA_PHONES}
    r = _supa.get("/auth/v1/admin/users", headers=_admin_headers, params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    for u in r.json().get("users", []):
        by_email = (u.get("email") or "").endswith("@" + QA_DOMAIN)
        by_phone = (u.get("phone") or "").lstrip("+") in bare
        if by_email or by_phone:
            _supa.delete(f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def purge_db() -> None:
    """Remove every row this script creates, keyed on the QA phone numbers.

    Deleted child-first rather than leaning on ON DELETE CASCADE, so this works
    the same way whichever foreign keys happen to cascade. Runs at both ends: a
    crash mid-run would otherwise leave a users row holding PHONE_A, and the
    next run's first assertion - that registering PHONE_A succeeds - would fail
    for a reason that has nothing to do with the code.
    """
    phones = list(QA_PHONES)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE phone = ANY(%s)", (phones,))
        user_ids = [row[0] for row in cur.fetchall()]
        if user_ids:
            cur.execute(
                """DELETE FROM job_status_history WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute(
                """DELETE FROM job_assignments WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute("DELETE FROM jobs WHERE user_id = ANY(%s::uuid[])", (user_ids,))
            cur.execute("DELETE FROM vehicles WHERE user_id = ANY(%s::uuid[])", (user_ids,))
        cur.execute("DELETE FROM partner_services WHERE partner_id IN "
                    "(SELECT id FROM partners WHERE phone = ANY(%s))", (phones,))
        cur.execute("DELETE FROM partners WHERE phone = ANY(%s)", (phones,))
        cur.execute("DELETE FROM users WHERE phone = ANY(%s)", (phones,))


def db_user(user_id: str) -> tuple:
    with conn.cursor() as cur:
        cur.execute("SELECT name, phone, email, phone_verified, auth_user_id "
                    "FROM users WHERE id = %s", (user_id,))
        return cur.fetchone()


# ------------------------------------------------------------- identities
PHONE_PATH = True   # flipped to False the first time Supabase refuses a phone token


def supabase_identity(label: str, phone: str | None = None) -> tuple[str, str]:
    """Create a real Supabase account, sign in, return (auth_user_id, access_token).

    With `phone`, creates a phone account whose token carries a phone claim -
    the shape a real OTP signup produces, and the only shape that exercises
    phone_verified, PHONE_MISMATCH and the IDENTITY_NOT_LINKED branch. Supabase
    wants the number without the '+', so it is stripped here and only here; what
    the API is asked to store stays E.164 throughout.

    Falls back to an email account, once and for the rest of the run, if the
    project will not issue a phone token. Note the two halves fail separately:
    the Admin API happily *creates* a phone account even when the phone provider
    is disabled, and only the password grant refuses. So the fallback has to
    delete the account it just made rather than leave it orphaned.
    """
    global PHONE_PATH
    password = "Qa!" + uuid.uuid4().hex[:20]

    if phone is not None and PHONE_PATH:
        bare = phone.lstrip("+")
        r = _supa.post("/auth/v1/admin/users", headers=_admin_headers,
                       json={"phone": bare, "password": password, "phone_confirm": True})
        if r.status_code in (200, 201):
            uid = r.json()["id"]
            r = _supa.post("/auth/v1/token", params={"grant_type": "password"},
                           headers={"apikey": PUB, "Content-Type": "application/json"},
                           json={"phone": bare, "password": password})
            if r.status_code == 200:
                return uid, r.json()["access_token"]
            _supa.delete(f"/auth/v1/admin/users/{uid}", headers=_admin_headers)
            reason = r.json().get("error_code") or r.json().get("msg") or r.text[:80]
        else:
            reason = r.json().get("error_code") or r.text[:80]
        print(f"  ! Supabase will not issue a phone token: {reason}")
        print("    falling back to email accounts for the rest of this run")
        PHONE_PATH = False

    email = f"regqa-{label}@{QA_DOMAIN}"
    r = _supa.post("/auth/v1/admin/users", headers=_admin_headers,
                   json={"email": email, "password": password, "email_confirm": True})
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create Supabase account {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]
    r = _supa.post("/auth/v1/token", params={"grant_type": "password"},
                   headers={"apikey": PUB, "Content-Type": "application/json"},
                   json={"email": email, "password": password})
    if r.status_code != 200:
        raise SystemExit(f"could not sign in as {email}: {r.status_code} {r.text[:300]}")
    return uid, r.json()["access_token"]


# ------------------------------------------------------------------ scenarios
def scenarios(tokens: dict) -> None:
    """Every assertion. Called inside try/finally so cleanup runs even on a crash."""
    tok_a, tok_c, tok_d = tokens["a"], tokens["c"], tokens["d"]
    tok_orphan, tok_mech = tokens["orphan"], tokens["mechanic"]
    sub_a = tokens["sub_a"]

    # ----------------------------------------------------------- scenario 0
    print("\n=== 0. POST /users without a token ===")
    r = c.post("/api/v1/users", json={"name": "No Token", "phone": PHONE_A})
    check("unauthenticated registration -> 401", r.status_code == 401, f"{r.status_code} {code_of(r)}")
    check("    WWW-Authenticate: Bearer sent",
          r.headers.get("www-authenticate") == "Bearer", r.headers.get("www-authenticate", "-"))

    # ----------------------------------------------------------- scenario 1
    print("\n=== 1. new verified token, no existing user -> 201 ===")
    r = c.post("/api/v1/users", headers=hdr(tok_a),
               json={"name": "Reg QA Owner A", "phone": PHONE_A, "email": f"owner-a@{QA_DOMAIN}"})
    check("registration returns 201", r.status_code == 201,
          f"{r.status_code} {code_of(r)} {r.text[:140]}")
    if r.status_code != 201:
        raise SystemExit("cannot continue without a registered user")

    data = r.json()["data"]
    new_user_id = data["id"]
    check("response carries exactly the documented fields",
          set(data) == {"id", "name", "phone", "phone_verified", "created_at"}, str(sorted(data)))
    check("response does not echo auth_user_id back", "auth_user_id" not in data)
    check("envelope carries a request_id", bool(r.json().get("meta", {}).get("request_id")))

    row = db_user(new_user_id)
    check("row exists in the database", row is not None)
    name, phone, email, phone_verified, auth_user_id = row
    check("auth_user_id is the token's sub, set in the same insert",
          str(auth_user_id) == sub_a, f"{auth_user_id} vs {sub_a}")
    check("phone stored exactly as submitted (E.164 kept)", phone == PHONE_A, phone)
    check("name stored", name == "Reg QA Owner A", name)
    check("email stored", email == f"owner-a@{QA_DOMAIN}", str(email))

    if PHONE_PATH:
        check("phone_verified true - the token proved this number",
              phone_verified is True, str(phone_verified))
    else:
        check("phone_verified false - token carried no phone claim",
              phone_verified is False, str(phone_verified))

    # ----------------------------------------------------------- scenario 2
    print("\n=== 2. the same phone again -> 400 USER_ALREADY_EXISTS ===")
    r = c.post("/api/v1/users", headers=hdr(tok_c),
               json={"name": "Reg QA Duplicate", "phone": PHONE_A})
    check("duplicate phone -> 400", r.status_code == 400, f"{r.status_code}")
    check("duplicate phone -> USER_ALREADY_EXISTS", code_of(r) == "USER_ALREADY_EXISTS", code_of(r))
    check("not a raw constraint error leaking out",
          "duplicate key" not in message_of(r).lower() and "psycopg" not in message_of(r).lower(),
          message_of(r)[:90])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM users WHERE phone = %s", (PHONE_A,))
        check("still exactly one row for that number", cur.fetchone()[0] == 1)

    r = c.post("/api/v1/users", headers=hdr(tok_a),
               json={"name": "Reg QA Owner A Again", "phone": PHONE_B})
    check("same account, different number -> 409 AUTH_ALREADY_LINKED",
          r.status_code == 409 and code_of(r) == "AUTH_ALREADY_LINKED",
          f"{r.status_code} {code_of(r)}")
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM users WHERE phone = %s", (PHONE_B,))
        check("no second profile grown on the same credential", cur.fetchone()[0] == 0)

    # ----------------------------------------------------------- scenario 3
    print("\n=== 3. verified but unregistered -> USER_NOT_REGISTERED, not a generic 401 ===")
    job_body = {"vehicle_id": str(uuid.uuid4()), "service_code": SERVICE_CODE,
                "pickup_lat": 23.0225, "pickup_lng": 72.5714,
                "pickup_address_text": "SG Highway, Ahmedabad",
                "issue_description": "QA: registration harness"}
    r = c.post("/api/v1/jobs", headers=hdr(tok_orphan), json=job_body)
    check("POST /jobs with an unregistered token is NOT 401", r.status_code != 401, f"{r.status_code}")
    check("POST /jobs with an unregistered token -> 403", r.status_code == 403, f"{r.status_code}")
    check("code is USER_NOT_REGISTERED", code_of(r) == "USER_NOT_REGISTERED", code_of(r))
    check("code is distinct from IDENTITY_NOT_LINKED", code_of(r) != "IDENTITY_NOT_LINKED")
    check("message names the endpoint the client should call",
          "/api/v1/users" in message_of(r), message_of(r)[:90])

    r = c.get(f"/api/v1/jobs/{uuid.uuid4()}", headers=hdr(tok_orphan))
    check("GET /jobs/{id} answers the same way, before any 404",
          r.status_code == 403 and code_of(r) == "USER_NOT_REGISTERED",
          f"{r.status_code} {code_of(r)}")

    # An unclaimed mechanic profile must still get IDENTITY_NOT_LINKED. This is
    # the case a blanket rename would have broken: send this caller to owner
    # signup and their next call fails with PARTNER_ALREADY_EXISTS - a dead end.
    # Needs a phone claim to match the profile on.
    if PHONE_PATH:
        r = c.post("/api/v1/partners", json={"name": "Reg QA Mechanic", "phone": PHONE_PARTNER,
                                             "primary_category_code": "mechanical"})
        check("unclaimed partner profile created", r.status_code in (200, 201), f"{r.status_code}")
        r = c.post("/api/v1/jobs", headers=hdr(tok_mech), json=job_body)
        check("unlinked partner profile still -> 403 IDENTITY_NOT_LINKED",
              r.status_code == 403 and code_of(r) == "IDENTITY_NOT_LINKED",
              f"{r.status_code} {code_of(r)}")
    else:
        skip("unlinked partner profile still -> IDENTITY_NOT_LINKED",
             "no phone-claim token available; covered in tests/unit/test_user_service.py")

    # ----------------------------------------------------------- scenario 4
    print("\n=== 4. register -> POST /jobs with the same token ===")
    vehicle_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO vehicles (id, user_id, vehicle_type, make, model, vehicle_number)
                       VALUES (%s, %s, %s, 'Maruti', 'Swift', 'GJ01RQ0901')""",
                    (vehicle_id, new_user_id, VEHICLE_TYPE))

    job_body["vehicle_id"] = vehicle_id
    r = c.post("/api/v1/jobs", headers=hdr(tok_a), json=job_body)
    check("the freshly registered owner can create a job", r.status_code in (200, 201),
          f"{r.status_code} {code_of(r)} {r.text[:140]}")
    if r.status_code in (200, 201):
        job = r.json()["data"]
        check("job.user_id is the new local id, not the Supabase sub",
              job["user_id"] == new_user_id, f"{job['user_id']} vs {new_user_id}")
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM jobs WHERE id = %s", (job["id"],))
            stored = cur.fetchone()[0]
        check("the database agrees about the owner", str(stored) == new_user_id, str(stored))

    # ----------------------------------------------------------- scenario 5
    print("\n=== 5. phone_verified cannot be claimed, only proved ===")
    if PHONE_PATH:
        r = c.post("/api/v1/users", headers=hdr(tok_d),
                   json={"name": "Reg QA Squatter", "phone": PHONE_MISMATCH})
        check("registering someone else's number -> 400 PHONE_MISMATCH",
              r.status_code == 400 and code_of(r) == "PHONE_MISMATCH",
              f"{r.status_code} {code_of(r)}")
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM users WHERE phone = %s", (PHONE_MISMATCH,))
            check("no row created for the number that was not proved", cur.fetchone()[0] == 0,
                  "a squatted row here would lock its real owner out permanently")
    else:
        skip("registering someone else's number -> PHONE_MISMATCH",
             "no phone-claim token available; covered in tests/unit/test_user_service.py")
        skip("no row created for the number that was not proved",
             "no phone-claim token available; covered in tests/unit/test_user_service.py")

    r = c.post("/api/v1/users", headers=hdr(tok_c), json={"name": "", "phone": PHONE_C})
    check("empty name -> 422 from validation", r.status_code == 422, f"{r.status_code}")
    r = c.post("/api/v1/users", headers=hdr(tok_c), json={"name": "Reg QA No Phone"})
    check("missing phone -> 422 from validation", r.status_code == 422, f"{r.status_code}")


# ----------------------------------------------------------------------- run
print("=== PURGE (leading) ===")
purge_db()
purge_supabase_accounts()
print("  database and Supabase QA accounts cleared")

print("\n=== SETUP ===")
sub_a, tok_a = supabase_identity("owner-a", PHONE_A)
sub_c, tok_c = supabase_identity("owner-c", PHONE_C)
sub_d, tok_d = supabase_identity("owner-d", PHONE_D)
sub_orphan, tok_orphan = supabase_identity("orphan")          # email-only, always
sub_mech, tok_mech = supabase_identity("mechanic", PHONE_PARTNER)

print(f"  token path: {'PHONE (phone claim present)' if PHONE_PATH else 'EMAIL (no phone claim)'}")
if not PHONE_PATH:
    print("  ! phone-claim assertions will be SKIPPED, not silently passed")

import jwt as _pyjwt  # noqa: E402 - header/claim inspection only, no verification here

_h = _pyjwt.get_unverified_header(tok_a)
check("tokens are genuine Supabase ES256", _h.get("alg") == "ES256", str(_h))
_claims = _pyjwt.decode(tok_a, options={"verify_signature": False})
if PHONE_PATH:
    check("token carries the phone claim, without '+'",
          _claims.get("phone") == PHONE_A.lstrip("+"), repr(_claims.get("phone")))
else:
    skip("token carries the phone claim", "phone provider disabled in this Supabase project")

_crashed = None
try:
    scenarios({"a": tok_a, "c": tok_c, "d": tok_d, "orphan": tok_orphan,
               "mechanic": tok_mech, "sub_a": sub_a})
except SystemExit as exc:
    _crashed = str(exc)
except Exception as exc:                                    # noqa: BLE001 - reported, not swallowed
    _crashed = f"{type(exc).__name__}: {exc}"
finally:
    print("\n=== PURGE (trailing) ===")
    purge_db()
    purge_supabase_accounts()
    with conn.cursor() as cur:
        for t in ("users", "vehicles", "partners", "partner_services", "jobs",
                  "job_status_history", "job_assignments"):
            cur.execute(f"SELECT count(*) FROM {t}")
            print(f"  {t:22} {cur.fetchone()[0]}")
        cur.execute("SELECT count(*) FROM users WHERE phone = ANY(%s)", (list(QA_PHONES),))
        check("every QA row removed", cur.fetchone()[0] == 0)
    conn.close()

failed = [r for r in _results if not r[0]]
print(f"\n{'=' * 60}\n{len(_results) - len(failed)}/{len(_results)} checks passed"
      + (f", {len(_skipped)} skipped" if _skipped else ""))
for s in _skipped:
    print(f"  SKIPPED: {s}")
for _, label, detail in failed:
    print(f"  FAILED: {label} - {detail}")
if _crashed:
    print(f"  ABORTED EARLY: {_crashed}")
sys.exit(1 if (failed or _crashed) else 0)
