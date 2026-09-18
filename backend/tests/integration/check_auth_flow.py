"""Live end-to-end check of the Supabase JWT auth retrofit.

Run against a server started with the same .env this script reads:

    python -m uvicorn app.main:app --port 8010
    python tests/integration/check_auth_flow.py

Not named test_*.py on purpose: pytest must not collect it, because it needs a
live server and a live database rather than fixtures.

On tokens — these are REAL Supabase-issued tokens, not locally minted ones. The
script creates throwaway accounts through the Admin API using the secret key,
signs in as each one with the publishable key to get a genuine access token,
and deletes them again at the end. So every token here was signed by Supabase's
own private key, carries their kid, and is verified against the public half
fetched live from the project's JWKS endpoint.

That distinction is the entire reason this file was rewritten. The previous
version minted its own HS256 tokens with the secret from .env, and passed 51/51
while the verifier was pinned to the wrong algorithm — the harness and the
implementation shared the same false assumption, so the tests could not see it.
A test that mints its own credentials cannot tell you whether you would accept
the issuer's. Only a real token can.

What this file does NOT cover: expired, wrong-audience, wrong-issuer and
missing-claim tokens, because Supabase will not issue those on request. Those
rules are checked in check_token_rules.py against a local key set. Run both.
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import base64  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402

import httpx  # noqa: E402
import psycopg2  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

BASE = "http://127.0.0.1:8010"
S = get_settings()
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift
STRANGER_PHONE = "+919000000804"                      # a second owner, created below

# Every Supabase account this script creates lands on this domain, so cleanup is
# a single filter rather than a list of ids that a crash could lose.
QA_DOMAIN = "sahayak-authqa.invalid"

_results: list[tuple[bool, str, str]] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((condition, label, detail))
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))


_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=30.0)


def purge_supabase_accounts() -> None:
    """Delete every QA_DOMAIN account. Runs at both ends — emails are unique, so
    a crash mid-run would otherwise block the next attempt at account creation."""
    r = _supa.get("/auth/v1/admin/users", headers=_admin_headers, params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    for u in r.json().get("users", []):
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa.delete(f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str) -> tuple[str, str]:
    """Create a real Supabase account, sign in, return (auth_user_id, access_token).

    Two calls on purpose. The admin create uses the SECRET key and mirrors what a
    back-office tool would do; the sign-in uses the PUBLISHABLE key and is
    exactly what the mobile app will do after an OTP. The token that comes back
    is the same object either way — this is the real issuance path, not a
    simulation of it.
    """
    email = f"authqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
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


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def forge_from(token: str, alg: str, secret: bytes | None = None) -> str:
    """Rewrite a genuine token's header, keeping its real payload.

    Built by hand rather than with jwt.encode(), which refuses to use a public
    key as an HMAC secret. That refusal is a courtesy to people writing signing
    code; an attacker just writes these three lines instead.
    """
    _, payload, sig = token.split(".")
    header = _b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    if secret is None:
        return f"{header}.{payload}.{sig}"
    signing_input = f"{header}.{payload}"
    return signing_input + "." + _b64(hmac.new(secret, signing_input.encode(), hashlib.sha256).digest())


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def code_of(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("code", "?")
    except Exception:
        return "?"


c = httpx.Client(base_url=BASE, timeout=30.0)

_QA_PHONES = ("+919000000801", "+919000000802", "+919000000803")
dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True


def purge() -> None:
    """Remove everything this script creates, by its QA phone numbers.

    Run at both ends, so a crash mid-run cannot poison the next attempt — the
    partner phone numbers are unique, and a leftover row would fail
    registration on the way back in.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM partners WHERE phone = ANY(%s)", (list(_QA_PHONES),))
        ids = [r[0] for r in cur.fetchall()]
        cur.execute("""DELETE FROM job_assignments WHERE partner_id = ANY(%s::uuid[])
                       OR job_id IN (SELECT id FROM jobs WHERE user_id = %s)""", (ids, USER_ID))
        cur.execute("DELETE FROM job_status_history WHERE job_id IN "
                    "(SELECT id FROM jobs WHERE user_id = %s AND issue_description LIKE 'QA:%%')",
                    (USER_ID,))
        cur.execute("DELETE FROM jobs WHERE user_id = %s AND issue_description LIKE 'QA:%%'", (USER_ID,))
        cur.execute("DELETE FROM partner_services WHERE partner_id = ANY(%s::uuid[])", (ids,))
        cur.execute("DELETE FROM partners WHERE id = ANY(%s::uuid[])", (ids,))
        cur.execute("DELETE FROM users WHERE phone = %s", (STRANGER_PHONE,))
        cur.execute("UPDATE users SET auth_user_id = NULL WHERE id = %s", (USER_ID,))


purge()
purge_supabase_accounts()

# --------------------------------------------------------------- setup
print("\n=== SETUP ===")
print("  creating real Supabase accounts and signing in as each...")
sub_user, tok_user = supabase_identity("owner")
sub_a, tok_a = supabase_identity("partner-a")
sub_b, tok_b = supabase_identity("partner-b")
sub_orphan, tok_orphan = supabase_identity("orphan")   # never linked, on purpose

import jwt as _pyjwt  # noqa: E402 — header inspection only, no verification here

_h = _pyjwt.get_unverified_header(tok_user)
check("tokens are genuine Supabase ES256", _h.get("alg") == "ES256", str(_h))
check("tokens carry the project's kid", bool(_h.get("kid")), str(_h.get("kid")))

r = c.post("/api/v1/partners", json={"name": "Auth QA Partner A", "phone": "+919000000801",
                                     "primary_category_code": "mechanical"})
partner_a = r.json()["data"]["id"]
r = c.post("/api/v1/partners", json={"name": "Auth QA Partner B", "phone": "+919000000802"})
partner_b = r.json()["data"]["id"]
print(f"  partner A = {partner_a}\n  partner B = {partner_b}")

r = c.post(f"/api/v1/partners/{partner_a}/link-auth", headers=hdr(tok_a))
check("link-auth binds partner A", r.status_code == 200 and r.json()["data"]["auth_user_id"] == sub_a,
      f"{r.status_code}")
r = c.post(f"/api/v1/partners/{partner_b}/link-auth", headers=hdr(tok_b))
check("link-auth binds partner B", r.status_code == 200, f"{r.status_code}")
r = c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(tok_user))
check("link-auth binds the user", r.status_code == 200 and r.json()["data"]["auth_user_id"] == sub_user,
      f"{r.status_code}")

r = c.post(f"/api/v1/partners/{partner_a}/link-auth", headers=hdr(tok_a))
check("re-linking the same account is idempotent", r.status_code == 200, f"{r.status_code}")
r = c.post(f"/api/v1/partners/{partner_a}/link-auth", headers=hdr(tok_b))
check("hijacking a linked partner is refused", r.status_code == 409, f"{r.status_code} {code_of(r)}")

# A second vehicle owner, so scenario 5 can be tested from the branch that
# actually matters: role="user" who does not own the job. Inserted with raw SQL
# because no registration endpoint exists — see the gap in app/api/users.py.
sub_stranger, tok_stranger = supabase_identity("stranger")
stranger_id = str(uuid.uuid4())
with conn.cursor() as cur:
    cur.execute("INSERT INTO users (id, name, phone) VALUES (%s, 'Auth QA Stranger', %s)",
                (stranger_id, STRANGER_PHONE))
r = c.post(f"/api/v1/users/{stranger_id}/link-auth", headers=hdr(tok_stranger))
check("link-auth binds a second owner", r.status_code == 200, f"{r.status_code}")

# ------------------------------------------------------------ scenario 1
print("\n=== 1. valid token + role=user -> can create a job ===")
body = {"vehicle_id": VEHICLE_ID, "service_code": "battery_jumpstart",
        "pickup_lat": 23.0225, "pickup_lng": 72.5714,
        "pickup_address_text": "SG Highway, Ahmedabad",
        "issue_description": "QA: battery dead in the office car park",
        "user_id": partner_a}  # smuggled: must be ignored, not honoured
r = c.post("/api/v1/jobs", json=body, headers=hdr(tok_user))
check("job created", r.status_code in (200, 201), f"{r.status_code}")
job = r.json()["data"]
job_id = job["id"]
check("job.user_id is the token's local_id", job["user_id"] == USER_ID, job["user_id"])
check("user_id smuggled in the body was ignored", job["user_id"] != partner_a)

r = c.post("/api/v1/jobs", json=body, headers=hdr(tok_a))
check("partner token is refused on POST /jobs", r.status_code == 403, f"{r.status_code} {code_of(r)}")

# ------------------------------------------------------------ scenario 2
print("\n=== 2. valid token + role=partner -> own availability only ===")
r = c.patch(f"/api/v1/partners/{partner_a}/availability", json={"is_available": True}, headers=hdr(tok_a))
check("partner A toggles own availability", r.status_code == 200 and r.json()["data"]["is_available"] is True,
      f"{r.status_code}")
r = c.patch(f"/api/v1/partners/{partner_b}/availability", json={"is_available": True}, headers=hdr(tok_a))
check("partner A is refused on partner B", r.status_code == 403, f"{r.status_code} {code_of(r)}")
r = c.patch(f"/api/v1/partners/{uuid.uuid4()}/availability", json={"is_available": True}, headers=hdr(tok_a))
check("unknown partner id gives 403, not 404 (no enumeration oracle)", r.status_code == 403,
      f"{r.status_code} {code_of(r)}")

r = c.post(f"/api/v1/partners/{partner_a}/services",
           json={"service_codes": ["battery_jumpstart", "flat_tyre"]}, headers=hdr(tok_a))
check("partner A links own services", r.status_code == 200, f"{r.status_code}")
r = c.post(f"/api/v1/partners/{partner_b}/services",
           json={"service_codes": ["flat_tyre"]}, headers=hdr(tok_a))
check("partner A is refused on partner B's services", r.status_code == 403, f"{r.status_code} {code_of(r)}")
r = c.patch(f"/api/v1/partners/{partner_a}/availability", json={"is_available": True}, headers=hdr(tok_user))
check("user token is refused on a partner route", r.status_code == 403, f"{r.status_code} {code_of(r)}")

# ------------------------------------------------------------ scenario 3
print("\n=== 3. no token -> 401 on protected routes ===")
for method, path, payload in [
    ("post", "/api/v1/jobs", body),
    ("get", f"/api/v1/jobs/{job_id}", None),
    ("patch", f"/api/v1/partners/{partner_a}/availability", {"is_available": False}),
    ("post", f"/api/v1/partners/{partner_a}/services", {"service_codes": ["flat_tyre"]}),
]:
    r = c.request(method, path, json=payload)
    check(f"{method.upper():5} {path.split('/api/v1')[1]:44} -> 401",
          r.status_code == 401, f"{r.status_code} {code_of(r)}")
    if r.status_code == 401:
        check("    WWW-Authenticate: Bearer sent",
              r.headers.get("www-authenticate") == "Bearer", r.headers.get("www-authenticate", "-"))
        break

r = c.get(f"/api/v1/jobs/{job_id}", headers={"Authorization": tok_user})  # no "Bearer " prefix
check("Authorization without the Bearer scheme -> 401", r.status_code == 401, f"{r.status_code}")
r = c.post("/api/v1/partners", json={"name": "Open Signup QA", "phone": "+919000000803"})
check("register_partner stays open (no token needed)", r.status_code in (200, 201), f"{r.status_code}")
partner_open = r.json()["data"]["id"] if r.status_code in (200, 201) else None

# ------------------------------------------------------------ scenario 4
print("\n=== 4. malformed / forged tokens -> 401 ===")
# Each of these starts from a genuine Supabase token and breaks one thing, so a
# pass means the server rejected something that was *almost* right. The claim
# rules Supabase will not issue on request — expired, wrong audience, wrong
# issuer, missing exp, non-UUID sub — are in check_token_rules.py.
_pub_jwk = httpx.get(S.SUPABASE_JWT_JWKS_URL, timeout=15.0).json()["keys"][0]
cases = {
    "structurally malformed": "this.is.not.a.jwt",
    "two segments, no signature": tok_user.rsplit(".", 1)[0],
    "signature truncated": tok_user[:-8],
    "signature replaced": tok_user.rsplit(".", 1)[0] + "." + _b64(b"x" * 64),
    "payload swapped, signature kept": (
        tok_user.split(".")[0] + "." + tok_a.split(".")[1] + "." + tok_user.split(".")[2]),
    "alg=none (signature stripped)": forge_from(tok_user, "none").rsplit(".", 1)[0] + ".",
    "alg=RS256 relabel": forge_from(tok_user, "RS256"),
    "alg=HS256 relabel, real signature": forge_from(tok_user, "HS256"),
    "HS256 forged with the public JWK": forge_from(tok_user, "HS256", json.dumps(_pub_jwk).encode()),
    "HS256 forged with an attacker secret": forge_from(tok_user, "HS256", b"attacker-chose-this"),
    "unknown kid": (_b64(json.dumps({"alg": "ES256", "kid": str(uuid.uuid4()), "typ": "JWT"}).encode())
                    + "." + tok_user.split(".")[1] + "." + tok_user.split(".")[2]),
}
for label, token in cases.items():
    r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(token))
    check(f"{label:38} -> 401", r.status_code == 401, f"{r.status_code} {code_of(r)}")

r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(tok_orphan))
check("valid token with no linked row -> 403 IDENTITY_NOT_LINKED",
      r.status_code == 403 and code_of(r) == "IDENTITY_NOT_LINKED", f"{r.status_code} {code_of(r)}")

r = c.get(f"/api/v1/jobs/{job_id}", headers={"Authorization": "Bearer"})
check("Bearer scheme with no credentials  -> 401", r.status_code == 401, f"{r.status_code} {code_of(r)}")

# ------------------------- assign partner A to the job (no dispatch engine yet)
with conn.cursor() as cur:
    cur.execute(
        """INSERT INTO job_assignments (id, job_id, partner_id, status, offered_at, accepted_at,
                                        estimated_arrival_min)
           VALUES (%s, %s, %s, 'accepted', now(), now(), 12)""",
        (str(uuid.uuid4()), job_id, partner_a))
print(f"\n  (seeded an accepted assignment: job {job_id[:8]} -> partner A, ETA 12 min)")

# ------------------------------------------------------------ scenario 5
print("\n=== 5. GET /jobs/{id} as a non-owner, non-assigned partner ===")
r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(tok_b))
check("200, not an error", r.status_code == 200, f"{r.status_code}")
ca = r.json()["data"]["current_assignment"]
check("current_assignment still returned", ca is not None)
check("status visible", ca and ca.get("status") == "accepted", str(ca and ca.get("status")))
check("estimated_arrival_min visible", ca and ca.get("estimated_arrival_min") == 12,
      str(ca and ca.get("estimated_arrival_min")))
check("partner_name withheld", ca and ca.get("partner_name") is None, repr(ca and ca.get("partner_name")))
check("partner_phone withheld", ca and ca.get("partner_phone") is None, repr(ca and ca.get("partner_phone")))
check("partner_id withheld", ca and ca.get("partner_id") is None, repr(ca and ca.get("partner_id")))

print("  -- same job, fetched by an unrelated vehicle owner --")
r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(tok_stranger))
check("200, not an error", r.status_code == 200, f"{r.status_code}")
ca = r.json()["data"]["current_assignment"]
check("status visible", ca and ca.get("status") == "accepted", str(ca and ca.get("status")))
check("estimated_arrival_min visible", ca and ca.get("estimated_arrival_min") == 12,
      str(ca and ca.get("estimated_arrival_min")))
check("partner_name withheld", ca and ca.get("partner_name") is None, repr(ca and ca.get("partner_name")))
check("partner_phone withheld", ca and ca.get("partner_phone") is None, repr(ca and ca.get("partner_phone")))
check("no partner PII anywhere in the payload",
      "Auth QA Partner A" not in r.text and "+919000000801" not in r.text)

# ------------------------------------------------------------ scenario 6
print("\n=== 6. GET /jobs/{id} as the owner ===")
r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(tok_user))
check("200", r.status_code == 200, f"{r.status_code}")
ca = r.json()["data"]["current_assignment"]
check("partner_name returned", ca and ca.get("partner_name") == "Auth QA Partner A",
      repr(ca and ca.get("partner_name")))
check("partner_phone returned", ca and ca.get("partner_phone") == "+919000000801",
      repr(ca and ca.get("partner_phone")))
check("partner_id returned", ca and ca.get("partner_id") == partner_a)
check("partner_rating present in shape", ca and "partner_rating" in ca)

print("\n=== 6b. GET /jobs/{id} as the ASSIGNED partner ===")
r = c.get(f"/api/v1/jobs/{job_id}", headers=hdr(tok_a))
ca = r.json()["data"]["current_assignment"] if r.status_code == 200 else None
check("assigned partner sees the owner's job", r.status_code == 200, f"{r.status_code}")
check("assigned partner sees contact details", ca and ca.get("partner_name") == "Auth QA Partner A",
      repr(ca and ca.get("partner_name")))

# ---------------------------------------------------------------- cleanup
print("\n=== CLEANUP ===")
purge()
purge_supabase_accounts()
r = _supa.get("/auth/v1/admin/users", headers=_admin_headers, params={"per_page": 200})
leftover = [u["email"] for u in r.json().get("users", [])
            if (u.get("email") or "").endswith("@" + QA_DOMAIN)] if r.status_code == 200 else ["?"]
check("every QA Supabase account removed", not leftover, ", ".join(leftover) or "none")
_supa.close()
with conn.cursor() as cur:
    for t in ("partners", "partner_services", "jobs", "job_assignments", "job_status_history"):
        cur.execute(f"SELECT count(*) FROM {t}")
        print(f"  {t:22} {cur.fetchone()[0]}")
    cur.execute("SELECT auth_user_id FROM users WHERE id = %s", (USER_ID,))
    print(f"  users.auth_user_id     {cur.fetchone()[0]} (reset)")
conn.close()

failed = [r for r in _results if not r[0]]
print(f"\n{'=' * 60}\n{len(_results) - len(failed)}/{len(_results)} checks passed")
for _, label, detail in failed:
    print(f"  FAILED: {label} — {detail}")
sys.exit(1 if failed else 0)
