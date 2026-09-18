"""Token verification rules, checked in-process against a local key set.

Run with no server and no database:

    python tests/integration/check_token_rules.py

Not named test_*.py for the same reason as its sibling: it binds a port.

Why a local key set at all, when check_auth_flow.py proves the real thing works
against real Supabase tokens? Because some of the rules that matter most cannot
be demonstrated with a real token. Supabase will not issue one that is already
expired, or carries the wrong issuer, or omits `sub` — and those are exactly the
cases where a verifier silently waving something through is a breach rather than
a bug. So this file owns its own ES256 keypair, serves the public half over
loopback HTTP, and points the verifier at it with
SUPABASE_JWT_JWKS_URL_OVERRIDE.

(HTTP rather than a file:// URL because PyJWT refuses non-http schemes outright.
That is their hardening, not an obstacle worth routing around.)

The division of labour:

    check_auth_flow.py    real tokens, real JWKS, real routes — proves the
                          production configuration is correct
    this file             synthetic tokens — proves the claim rules are correct

Both are needed. Neither substitutes for the other: the first cannot produce a
bad token, and the second cannot prove .env points anywhere real.
"""
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

JWKS_PORT = 8011
KID = "local-test-key"
LEGACY_SECRET = "legacy-hs256-shared-secret-for-tests-only-32b"
ISS = "https://local-test.supabase.co/auth/v1"
AUD = "authenticated"

# Set before the settings object is ever built — pydantic-settings reads the
# real environment ahead of .env, so this wins without touching the file.
os.environ["SUPABASE_JWT_JWKS_URL_OVERRIDE"] = f"http://127.0.0.1:{JWKS_PORT}/jwks.json"
os.environ["SUPABASE_JWT_SECRET"] = LEGACY_SECRET
os.environ["SUPABASE_JWT_AUDIENCE"] = AUD
os.environ["SUPABASE_URL"] = "https://local-test.supabase.co"

from app.config.settings import get_settings  # noqa: E402
from app.services.auth_service import decode_token  # noqa: E402
from app.utils.errors import InternalError, UnauthorizedError  # noqa: E402

get_settings.cache_clear()

_key = ec.generate_private_key(ec.SECP256R1())
_jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(_key.public_key()))
_jwk.update({"kid": KID, "use": "sig", "alg": "ES256"})
_JWKS_BODY = json.dumps({"keys": [_jwk]}).encode()


class _JWKSHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — name fixed by http.server
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(_JWKS_BODY)))
        self.end_headers()
        self.wfile.write(_JWKS_BODY)

    def log_message(self, *args):
        pass  # keep the test output readable


_server = HTTPServer(("127.0.0.1", JWKS_PORT), _JWKSHandler)
threading.Thread(target=_server.serve_forever, daemon=True).start()

_results: list[tuple[bool, str, str]] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((condition, label, detail))
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))


def mint(ttl: int = 3600, key=None, alg: str = "ES256", kid: str | None = KID, **overrides) -> str:
    """Build a token the way Supabase would, then let the caller break one thing."""
    now = int(time.time())
    payload = {
        "sub": str(uuid.uuid4()), "aud": AUD, "iss": ISS,
        "iat": now, "exp": now + ttl,
        "role": "authenticated", "phone": "919000000000",
    }
    payload.update(overrides)
    for k in [k for k, v in overrides.items() if v is None]:
        payload.pop(k, None)  # None means "omit this claim entirely"
    headers = {"kid": kid} if kid else {}
    return jwt.encode(payload, key if key is not None else _key, algorithm=alg, headers=headers)


def rejects(label: str, token: str) -> None:
    try:
        decode_token(token)
        check(label, False, "ACCEPTED — should have been rejected")
    except UnauthorizedError:
        check(label, True)
    except Exception as exc:  # noqa: BLE001 — the point is to catch the wrong type
        check(label, False, f"raised {type(exc).__name__}, expected UnauthorizedError")


print("\n=== the happy path, so the negatives below mean something ===")
good = mint()
claims = decode_token(good)
check("a well-formed ES256 token verifies", claims.auth_user_id is not None, str(claims.auth_user_id))
check("phone claim survives", claims.phone == "919000000000", repr(claims.phone))

print("\n=== claims Supabase would never get wrong, and we must not trust it to ===")
rejects("expired 60s ago", mint(ttl=-60))
rejects("exp claim missing entirely", mint(exp=None))
rejects("sub claim missing entirely", mint(sub=None))
rejects("sub is not a UUID", mint(sub="administrator"))
rejects("audience belongs to another app", mint(aud="some-other-app"))
rejects("issuer is not our project", mint(iss="https://evil.example.com/auth/v1"))

print("\n=== clock skew: a token that only just expired is still refused ===")
rejects("expired 30s ago (beyond the 10s leeway)", mint(ttl=-30))
check("issued 5s in the future is tolerated (within leeway)",
      decode_token(mint(iat=int(time.time()) + 5)) is not None)

print("\n=== signature and algorithm ===")
_other = ec.generate_private_key(ec.SECP256R1())
rejects("signed by a different P-256 key", mint(key=_other))
rejects("kid that is not in the key set", mint(kid="no-such-key"))
rejects("no kid at all", mint(kid=None))
rejects("alg=none", jwt.encode({"sub": str(uuid.uuid4()), "aud": AUD, "iss": ISS,
                                "exp": int(time.time()) + 3600}, key="", algorithm="none"))
rejects("structurally malformed", "this.is.not.a.jwt")
rejects("two segments, no signature", "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0")
rejects("empty string", "")

print("\n=== algorithm confusion: the public key must not work as an HMAC secret ===")
# The attack: download the JWKS (it is public by design), rebuild the key in PEM
# form, and sign an HS256 token with it. A verifier that lets the token's header
# pick the algorithm will happily HMAC-verify it and hand over any identity the
# attacker names. Note the legacy secret IS configured here, so the HS256 lane is
# open — this proves the lane is bound to the *right* key, not merely closed.
#
# Forged by hand rather than with jwt.encode(), because PyJWT refuses to use a
# PEM public key as an HMAC secret. That refusal protects people writing signing
# code; it does nothing for us, since the attacker writes these four lines
# instead. Testing through jwt.encode() would have tested PyJWT's encoder, not
# our verifier.
import base64  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402

from cryptography.hazmat.primitives import serialization  # noqa: E402


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def forge_hs256(secret: bytes, **claims) -> str:
    now = int(time.time())
    payload = {"sub": str(uuid.uuid4()), "aud": AUD, "iss": ISS,
               "iat": now, "exp": now + 3600, "role": "authenticated"}
    payload.update(claims)
    signing_input = (
        _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        + "." + _b64(json.dumps(payload).encode())
    )
    sig = hmac.new(secret, signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + _b64(sig)


pub_pem = _key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)
rejects("HS256 forged with the JWKS public key (PEM)", forge_hs256(pub_pem))
rejects("HS256 forged with the raw JWK json", forge_hs256(json.dumps(_jwk).encode()))
rejects("HS256 forged with the JWK's x coordinate", forge_hs256(_jwk["x"].encode()))
rejects("HS256 forged with an attacker's own secret", forge_hs256(b"attacker-picked-this-himself"))

# Same idea one step further: keep a genuine ES256 signature but relabel the
# header, so a verifier that reads alg from the token routes it down the wrong
# lane entirely.
_genuine = mint()
_h, _p, _s = _genuine.split(".")
rejects("genuine ES256 signature relabelled alg=RS256",
        _b64(json.dumps({"alg": "RS256", "kid": KID, "typ": "JWT"}).encode()) + f".{_p}.{_s}")
rejects("genuine ES256 signature relabelled alg=HS256",
        _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + f".{_p}.{_s}")

print("\n=== the legacy HS256 lane, while a shared secret is configured ===")
check("a genuine legacy HS256 token still verifies",
      decode_token(mint(key=LEGACY_SECRET, alg="HS256", kid=None)).auth_user_id is not None)
rejects("legacy lane still enforces expiry", mint(key=LEGACY_SECRET, alg="HS256", kid=None, ttl=-60))
rejects("legacy lane still enforces audience",
        mint(key=LEGACY_SECRET, alg="HS256", kid=None, aud="some-other-app"))

print("\n=== with the legacy secret blanked — the intended end state ===")
os.environ["SUPABASE_JWT_SECRET"] = ""
get_settings.cache_clear()
rejects("HS256 rejected once the legacy secret is removed",
        mint(key=LEGACY_SECRET, alg="HS256", kid=None))
check("ES256 is unaffected by the legacy secret being blank",
      decode_token(mint()).auth_user_id is not None)

print("\n=== JWKS unreachable is a 500, not a 401 ===")
# A user holding a perfectly good session must not be told to log in again
# because *our* key fetch failed. Wrong advice, and it will not help them.
_server.shutdown()
os.environ["SUPABASE_JWT_JWKS_URL_OVERRIDE"] = "http://127.0.0.1:8019/gone.json"
get_settings.cache_clear()
try:
    decode_token(mint())
    check("JWKS outage surfaces as InternalError", False, "ACCEPTED — should have raised")
except InternalError:
    check("JWKS outage surfaces as InternalError, not 401", True)
except UnauthorizedError:
    check("JWKS outage surfaces as InternalError, not 401", False,
          "got 401 — would wrongly tell a valid session to re-login")
except Exception as exc:  # noqa: BLE001
    check("JWKS outage surfaces as InternalError, not 401", False, type(exc).__name__)

print("\n=== SUPABASE_URL unset — fail closed, do not skip verification ===")
os.environ["SUPABASE_JWT_JWKS_URL_OVERRIDE"] = ""
os.environ["SUPABASE_URL"] = ""
get_settings.cache_clear()
try:
    decode_token(mint())
    check("no JWKS configured -> refuses rather than trusting", False, "ACCEPTED")
except InternalError:
    check("no JWKS configured -> refuses rather than trusting", True)
except Exception as exc:  # noqa: BLE001
    check("no JWKS configured -> refuses rather than trusting",
          isinstance(exc, UnauthorizedError), type(exc).__name__)

failed = [r for r in _results if not r[0]]
print(f"\n{'=' * 60}\n{len(_results) - len(failed)}/{len(_results)} checks passed")
for _, label, detail in failed:
    print(f"  FAILED: {label} — {detail}")
sys.exit(1 if failed else 0)
