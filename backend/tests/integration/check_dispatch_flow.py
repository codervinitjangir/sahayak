"""Live end-to-end check of the dispatch / matching engine.

Run it directly — it needs no server process:

    python tests/integration/check_dispatch_flow.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

Three deliberate choices about what is real here and what is not:

  * **The database is real.** Every assertion about status transitions, ranks,
    history rows and score_components is made by querying Postgres directly with
    psycopg2, not by trusting the API's own response. A test that only reads the
    response body is testing the serializer.

  * **The tokens are real.** Partner identities come from actual Supabase
    accounts, signed by Supabase's key and verified against the live JWKS
    endpoint — the lesson already paid for in check_auth_flow.py, where a
    harness that minted its own tokens passed 51/51 against a verifier pinned to
    the wrong algorithm. A test that issues its own credentials cannot tell you
    whether you would accept the issuer's.

  * **Redis is fake.** fakeredis, injected through set_redis_client. This is the
    one substitution, and it is defensible because what dispatch needs from Redis
    is GEOADD/GEOSEARCH, which fakeredis implements with genuine geohash math —
    verified against known Ahmedabad coordinates before this file was written,
    not assumed. The alternative was to skip every geo assertion on a machine
    with no Redis daemon, which would have left the entire candidate search
    untested.

The app is driven in-process over ASGITransport rather than through a socket, so
there is no server to start and no port to collide with.

Cleanup runs at both ends. The tail of the run re-counts every table and
compares against the baseline recorded at the top, and the run FAILS if anything
is left behind — a test that pollutes the database it asserts against will pass
once and then lie forever.
"""
import asyncio
import sys
import uuid
from pathlib import Path

# Windows consoles default to cp1252, which cannot encode the arrows and dashes
# in the status-transition output below — and a UnicodeEncodeError raised from a
# print() would abort the run *between* the assertions and the cleanup, leaving
# QA rows in the database. Reconfigured rather than avoided, because "→" is what
# makes a status chain readable at a glance.
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

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False
SERVICE_ID = 3
TOWING_CODE = "flatbed_towing"       # requires_vehicle_equipment = True

# Pickup point: Ahmedabad, near CG Road. Every partner below is placed at a
# measured bearing/offset from here so the distances in the assertions are the
# distances the geo search will actually compute.
PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600

# Roughly 1 km, 3 km and 6 km due north of the pickup point. Latitude degrees are
# ~111.32 km regardless of longitude, so going north keeps the arithmetic honest
# — an east/west offset would need a cos(lat) factor and would quietly drift.
KM_PER_DEG_LAT = 111.32
NEAR_LAT = PICKUP_LAT + 1.0 / KM_PER_DEG_LAT
MID_LAT = PICKUP_LAT + 3.0 / KM_PER_DEG_LAT
FAR_LAT = PICKUP_LAT + 6.0 / KM_PER_DEG_LAT

# Far outside the 10 km radius: Gandhinagar, ~25 km away. Used for the
# no-candidates case, because moving the job is more honest than deleting the
# partners — it tests the radius, not the absence of rows.
REMOTE_LAT, REMOTE_LNG = 23.2200, 72.6500

QA_DOMAIN = "sahayak-dispatchqa.invalid"
QA_PHONES = ("+919000000901", "+919000000902", "+919000000903")

_results: list[tuple[bool, str, str]] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


# --------------------------------------------------------------------------
# Database access, used only to verify and to clean up — never to set up state
# the API is capable of setting up itself.
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
    out = {}
    for table in TABLES:
        q.execute(f"SELECT count(*) FROM {table}")
        out[table] = q.fetchone()[0]
    return out


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql: str, params=None):
    result = rows(sql, params)
    return result[0] if result else None


def assignments_for(job_id: str) -> list:
    return rows(
        "SELECT id, partner_id, status, assignment_rank, matching_score, "
        "       score_components, was_baseline_choice, distance_at_offer_m, "
        "       offered_at, responded_at, accepted_at, rejection_reason "
        "FROM job_assignments WHERE job_id = %(job_id)s "
        "ORDER BY assignment_rank",
        {"job_id": job_id},
    )


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone numbers and by the auth accounts on QA_DOMAIN, not by
    "delete recent rows" — a cleanup that works by timestamp will one day delete
    something real.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = ANY(%(phones)s))",
        {"phones": list(QA_PHONES)},
    )
    # Jobs raised by this script are identified by their pickup points, which are
    # fixed constants above and belong to no real booking.
    q.execute(
        "DELETE FROM job_status_history WHERE job_id IN ("
        "  SELECT id FROM jobs WHERE issue_description LIKE 'DISPATCH-QA%%')"
    )
    q.execute(
        "DELETE FROM job_assignments WHERE job_id IN ("
        "  SELECT id FROM jobs WHERE issue_description LIKE 'DISPATCH-QA%%')"
    )
    q.execute("DELETE FROM jobs WHERE issue_description LIKE 'DISPATCH-QA%%'")
    q.execute(
        "DELETE FROM partner_services WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = ANY(%(phones)s))",
        {"phones": list(QA_PHONES)},
    )
    q.execute("DELETE FROM partners WHERE phone = ANY(%(phones)s)", {"phones": list(QA_PHONES)})
    # The shared test user is real and stays; only the link this script made goes.
    q.execute(
        "UPDATE users SET auth_user_id = NULL WHERE id = %(uid)s", {"uid": USER_ID}
    )


# --------------------------------------------------------------------------
# Supabase accounts — real tokens, same approach as check_auth_flow.py.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=30.0)


def purge_supabase_accounts() -> None:
    r = _supa.get("/auth/v1/admin/users", headers=_admin_headers, params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    for u in r.json().get("users", []):
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa.delete(f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str) -> tuple[str, str]:
    """Create a real Supabase account and sign in. Returns (auth_user_id, token)."""
    email = f"dispatchqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa.post(
        "/auth/v1/admin/users",
        headers=_admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]

    r = _supa.post(
        "/auth/v1/token",
        params={"grant_type": "password"},
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


def data_of(r: httpx.Response) -> dict:
    try:
        return r.json().get("data") or {}
    except Exception:
        return {}


async def main() -> None:
    # Swap in the in-process Redis before the app is imported anywhere that
    # matters. Nothing in production can reach this function — it is an explicit
    # override, not an environment flag.
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app  # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://dispatch.test") as c:

        # ------------------------------------------------------------------
        section("1. Three verified, available partners at different distances")
        # ------------------------------------------------------------------
        owner_auth, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner account linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        partners: dict[str, dict] = {}
        placements = (
            ("near", QA_PHONES[0], NEAR_LAT, 1.0),
            ("mid", QA_PHONES[1], MID_LAT, 3.0),
            ("far", QA_PHONES[2], FAR_LAT, 6.0),
        )
        for label, phone, lat, expected_km in placements:
            auth_id, token = supabase_identity(label)
            r = await c.post(
                "/api/v1/partners",
                json={"name": f"Dispatch QA {label}", "phone": phone,
                      "primary_category_code": "mechanical"},
            )
            if r.status_code != 201:
                raise SystemExit(f"partner {label} registration failed: {r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]

            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"partner {label} link-auth failed: {r.status_code} {r.text[:300]}")

            # Verification has no endpoint yet — the workflow is a separate task
            # — so it is set directly. This is the one piece of state the API
            # cannot yet create, and it is set here rather than pretended away.
            q = conn.cursor()
            q.execute(
                "UPDATE partners SET verification_status = 'verified' WHERE id = %(pid)s",
                {"pid": pid},
            )

            r = await c.post(
                f"/api/v1/partners/{pid}/services",
                json={"service_codes": [SERVICE_CODE]},
                headers=hdr(token),
            )
            if r.status_code != 200:
                raise SystemExit(f"partner {label} service link failed: {r.status_code} {r.text[:300]}")

            r = await c.patch(
                f"/api/v1/partners/{pid}/availability",
                json={"is_available": True},
                headers=hdr(token),
            )
            if r.status_code != 200:
                raise SystemExit(f"partner {label} availability failed: {r.status_code} {r.text[:300]}")

            r = await c.post(
                f"/api/v1/partners/{pid}/location",
                json={"lat": lat, "lng": PICKUP_LNG},
                headers=hdr(token),
            )
            check(f"{label} partner reported a location ({expected_km:.0f} km out)",
                  r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")

            partners[label] = {"id": pid, "token": token, "auth_id": auth_id,
                               "expected_km": expected_km}

        # The location endpoint writes to Redis and nowhere else. If a
        # current_location column is ever added, this is the assertion that will
        # notice the day something starts writing to it.
        check("no Postgres column was written for live position",
              not rows("SELECT column_name FROM information_schema.columns "
                       "WHERE table_name='partners' AND column_name='current_location'"),
              "partners.current_location does not exist, as designed")

        # A partner must not be able to move another partner's pin.
        r = await c.post(
            f"/api/v1/partners/{partners['far']['id']}/location",
            json={"lat": NEAR_LAT, "lng": PICKUP_LNG},
            headers=hdr(partners["near"]["token"]),
        )
        check("a partner cannot report someone else's location",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("2. Auto-dispatch on job creation — engine AGREES with baseline")
        # ------------------------------------------------------------------
        # All three well rated, so the nearest partner is also the best one and
        # the naive distance-only baseline picks the same partner the engine
        # does. was_baseline_choice must be true on rank 1.
        q = conn.cursor()
        q.execute(
            "UPDATE partners SET rating_avg = 4.6, rating_count = 12 "
            "WHERE phone = ANY(%(phones)s)", {"phones": list(QA_PHONES)},
        )

        job_a = await create_job(c, owner_token, "DISPATCH-QA agree")
        rows_a = assignments_for(job_a)
        check("exactly one offer was created", len(rows_a) == 1, f"{len(rows_a)} row(s)")
        check("job moved to 'matching' automatically",
              (one("SELECT status FROM jobs WHERE id=%(i)s", {"i": job_a}) or {}).get("status") == "matching",
              "no manual dispatch call was made")

        if rows_a:
            a = rows_a[0]
            check("offer is rank 1 and status 'offered'",
                  a["assignment_rank"] == 1 and a["status"] == "offered",
                  f"rank={a['assignment_rank']} status={a['status']}")
            check("nearest partner won", str(a["partner_id"]) == partners["near"]["id"],
                  f"picked {label_of(partners, a['partner_id'])}")
            check("was_baseline_choice is TRUE when the engine agrees with distance-only",
                  a["was_baseline_choice"] is True, f"got {a['was_baseline_choice']}")
            check("distance_at_offer_m is roughly the real distance",
                  900 <= float(a["distance_at_offer_m"]) <= 1100,
                  f"{float(a['distance_at_offer_m']):.0f} m, expected ~1000 m")
            check("score_components holds all four weighted terms",
                  sorted(a["score_components"] or {}) ==
                  ["distance_score", "load_score", "rating_score", "skill_score"],
                  str(sorted(a["score_components"] or {})))
            check("matching_score equals the weighted sum of its components",
                  components_match(a), explain_score(a))
            check("job_status_history recorded the 'matching' transition",
                  any(h["status"] == "matching" for h in history_for(job_a)),
                  " → ".join(h["status"] for h in history_for(job_a)))

        # ------------------------------------------------------------------
        section("3. A closer but worse-rated partner must NOT win")
        # ------------------------------------------------------------------
        # The whole point of a weighted engine. If this fails, dispatch is an
        # expensive distance sort and the divergence metric will read zero
        # forever.
        #
        # rating_count matters here in a way it did not before ratings were
        # smoothed: a score is now pulled toward the prior in proportion to how
        # little evidence stands behind it, so twelve reviews and forty reviews
        # are genuinely different claims. Forty is used deliberately — the
        # scenario being asserted is "an established 4.9 beats an established
        # 1.5", and running it on thin evidence would be testing the prior
        # rather than the weighting.
        q.execute(
            "UPDATE partners SET rating_avg = 1.5, rating_count = 40 WHERE phone = %(p)s",
            {"p": QA_PHONES[0]},   # the NEAREST partner is now the worst rated
        )
        q.execute(
            "UPDATE partners SET rating_avg = 4.9, rating_count = 40 WHERE phone = %(p)s",
            {"p": QA_PHONES[1]},   # the mid-distance partner is excellent
        )

        job_b = await create_job(c, owner_token, "DISPATCH-QA diverge")
        rows_b = assignments_for(job_b)
        check("exactly one offer was created", len(rows_b) == 1, f"{len(rows_b)} row(s)")
        if rows_b:
            b = rows_b[0]
            check("the better-rated partner 3 km out beat the poorly-rated one 1 km out",
                  str(b["partner_id"]) == partners["mid"]["id"],
                  f"picked {label_of(partners, b['partner_id'])}")
            check("was_baseline_choice is FALSE — the weighting changed the outcome",
                  b["was_baseline_choice"] is False, f"got {b['was_baseline_choice']}")
            check("the weighting, not a tie-break, decided it", weighting_explains(b),
                  explain_score(b))

        # ------------------------------------------------------------------
        section("4. Rejection falls through to the next-best partner")
        # ------------------------------------------------------------------
        first = rows_b[0]
        r = await c.post(
            f"/api/v1/job-assignments/{first['id']}/respond",
            json={"action": "reject", "rejection_reason": "Already on another call"},
            headers=hdr(partners["mid"]["token"]),
        )
        check("partner could reject their own offer", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        body = data_of(r)

        after = assignments_for(job_b)
        rejected = [a for a in after if a["status"] == "rejected"]
        offered = [a for a in after if a["status"] == "offered"]
        check("the rejected offer is marked rejected with its reason",
              len(rejected) == 1 and rejected[0]["rejection_reason"] == "Already on another call",
              f"{len(rejected)} rejected")
        check("responded_at was stamped", bool(rejected and rejected[0]["responded_at"]))
        check("a rank-2 offer was created automatically",
              len(offered) == 1 and offered[0]["assignment_rank"] == 2,
              f"ranks now {[a['assignment_rank'] for a in after]}")
        check("the new offer went to a DIFFERENT partner",
              bool(offered) and offered[0]["partner_id"] != first["partner_id"],
              f"rank 2 → {label_of(partners, offered[0]['partner_id']) if offered else 'nobody'}")
        check("the response reported the next offer's id",
              bool(offered) and body.get("next_assignment_id") == str(offered[0]["id"]),
              str(body.get("next_assignment_id")))
        check("job stayed in 'matching' through the rejection",
              body.get("job_status") == "matching", str(body.get("job_status")))

        # ------------------------------------------------------------------
        section("5. Accepting rank 2 assigns the job and stops the search")
        # ------------------------------------------------------------------
        rank2 = offered[0]
        accepting = "near" if str(rank2["partner_id"]) == partners["near"]["id"] else "far"
        r = await c.post(
            f"/api/v1/job-assignments/{rank2['id']}/respond",
            json={"action": "accept"},
            headers=hdr(partners[accepting]["token"]),
        )
        check("partner could accept their own offer", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        body = data_of(r)

        final = assignments_for(job_b)
        job_row = one("SELECT status FROM jobs WHERE id=%(i)s", {"i": job_b})
        check("job moved to 'assigned'", job_row["status"] == "assigned", job_row["status"])
        check("no further offers were made", len(final) == 2, f"{len(final)} assignment rows")
        check("the accepted row carries accepted_at",
              any(a["status"] == "accepted" and a["accepted_at"] for a in final))
        check("history recorded requested → matching → assigned",
              [h["status"] for h in history_for(job_b)] == ["requested", "matching", "assigned"],
              " → ".join(h["status"] for h in history_for(job_b)))

        # Re-answering a settled offer is a conflict, not a second acceptance.
        r = await c.post(
            f"/api/v1/job-assignments/{rank2['id']}/respond",
            json={"action": "accept"},
            headers=hdr(partners[accepting]["token"]),
        )
        check("answering the same offer twice is rejected with 409",
              r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
              f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("6. A partner cannot answer someone else's offer")
        # ------------------------------------------------------------------
        open_offer = rows_a[0]           # still 'offered', belongs to the near partner
        intruder = partners["far"]["token"]
        r = await c.post(
            f"/api/v1/job-assignments/{open_offer['id']}/respond",
            json={"action": "accept"},
            headers=hdr(intruder),
        )
        check("stealing another partner's offer is refused with 403",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")
        still = [a for a in assignments_for(job_a) if a["id"] == open_offer["id"]][0]
        check("the offer was not touched by the refused call",
              still["status"] == "offered" and still["responded_at"] is None,
              f"status={still['status']}")

        r = await c.post(
            f"/api/v1/job-assignments/{open_offer['id']}/respond",
            json={"action": "reject"},
            headers=hdr(intruder),
        )
        check("rejecting another partner's offer is refused too",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("7. No candidates is a valid outcome, not a crash")
        # ------------------------------------------------------------------
        # The job is moved ~25 km away rather than the partners being deleted, so
        # this exercises the radius itself.
        job_c = await create_job(c, owner_token, "DISPATCH-QA remote",
                                 lat=REMOTE_LAT, lng=REMOTE_LNG)
        job_row = one("SELECT status FROM jobs WHERE id=%(i)s", {"i": job_c})
        check("job created 25 km from every partner still returned 201",
              job_row is not None)
        check("job status is 'no_match_found'", job_row["status"] == "no_match_found",
              job_row["status"])
        check("no offers were created", len(assignments_for(job_c)) == 0)
        check("history recorded the no_match_found transition",
              [h["status"] for h in history_for(job_c)] == ["requested", "no_match_found"],
              " → ".join(h["status"] for h in history_for(job_c)))

        # An equipment-gated service with no verified equipment on file is the
        # other way to reach an empty candidate set — and it is the safety filter
        # that matters most: do not offer a tow to someone with no flatbed.
        for meta in partners.values():
            await c.post(
                f"/api/v1/partners/{meta['id']}/services",
                json={"service_codes": [TOWING_CODE]},
                headers=hdr(meta["token"]),
            )
        job_d = await create_job(c, owner_token, "DISPATCH-QA towing",
                                 service_code=TOWING_CODE)
        job_row = one("SELECT status FROM jobs WHERE id=%(i)s", {"i": job_d})
        check("a towing job finds nobody when no partner holds verified equipment",
              job_row["status"] == "no_match_found", job_row["status"])
        check("no towing offer was made to an unequipped partner",
              len(assignments_for(job_d)) == 0)

        # ------------------------------------------------------------------
        section("8. Re-dispatching an already-dispatched job is refused")
        # ------------------------------------------------------------------
        from app.config.database import AsyncSessionLocal
        from app.services import dispatch_service
        from app.utils.errors import ConflictError

        async with AsyncSessionLocal() as db:
            try:
                await dispatch_service.dispatch_job(db, uuid.UUID(job_b))
                check("dispatching an assigned job raises 409", False, "no error raised")
            except ConflictError as exc:
                check("dispatching an assigned job raises 409 JOB_ALREADY_DISPATCHED",
                      getattr(exc, "code", None) == "JOB_ALREADY_DISPATCHED",
                      f"code={getattr(exc, 'code', None)}")
        check("the assigned job was not given a third offer",
              len(assignments_for(job_b)) == 2, f"{len(assignments_for(job_b))} rows")

        # ------------------------------------------------------------------
        section("9. A partner at capacity is filtered out, not merely penalised")
        # ------------------------------------------------------------------
        # load_score already prefers an idle partner, so a test that only checked
        # "the busy one lost" would pass with no cap at all. The distinction
        # being asserted is that MAX_CONCURRENT_JOBS removes a partner from the
        # candidate set — which is only visible when they would otherwise have
        # won, and when there is nobody else to win instead.
        from app.repositories.dispatch_repository import MAX_CONCURRENT_JOBS

        capped = partners["near"]
        others = [partners["mid"], partners["far"]]

        async def set_available(meta: dict, available: bool):
            return await c.patch(
                f"/api/v1/partners/{meta['id']}/availability",
                json={"is_available": available},
                headers=hdr(meta["token"]),
            )

        # The near partner is nearest to every job raised at the pickup point, so
        # taking the other two off shift is enough to route the filler jobs to
        # them and load them to exactly the cap.
        for meta in others:
            await set_available(meta, False)

        # Counted the way dispatch counts it — through the job's status, not the
        # assignment's. See ADR-008.
        def active_jobs_for(partner_id: str) -> int:
            return one(
                "SELECT COUNT(*) AS n FROM job_assignments a JOIN jobs j ON j.id = a.job_id "
                "WHERE a.partner_id = %(p)s AND a.status = 'accepted' "
                "  AND j.status IN ('assigned','partner_en_route','in_progress')",
                {"p": partner_id},
            )["n"]

        # Measured rather than assumed: this partner may already be holding the
        # job they accepted in section 5, and which partner that was is decided
        # by the scoring, not by this script. Topping up to the cap from wherever
        # they actually are keeps the section independent of that outcome.
        already = active_jobs_for(capped["id"])
        for n in range(MAX_CONCURRENT_JOBS - already):
            filler = await create_job(c, owner_token, f"DISPATCH-QA load {n}")
            offers = assignments_for(filler)
            if len(offers) != 1:
                raise SystemExit(f"filler job {n}: expected 1 offer, got {len(offers)}")
            r = await c.post(
                f"/api/v1/job-assignments/{offers[0]['id']}/respond",
                json={"action": "accept"},
                headers=hdr(capped["token"]),
            )
            if r.status_code != 200:
                raise SystemExit(f"filler accept {n} failed: {r.status_code} {r.text[:300]}")

        active = active_jobs_for(capped["id"])
        check(f"the nearest partner is now holding {MAX_CONCURRENT_JOBS} active jobs",
              active == MAX_CONCURRENT_JOBS, f"{active} active (started at {already})")

        for meta in others:
            await set_available(meta, True)

        job_e = await create_job(c, owner_token, "DISPATCH-QA capped")
        offers_e = assignments_for(job_e)
        check("a job raised next to the capped partner still found somebody",
              len(offers_e) == 1, f"{len(offers_e)} offer(s)")
        if offers_e:
            check("it was NOT offered to the capped partner, who was nearest",
                  str(offers_e[0]["partner_id"]) != capped["id"],
                  f"went to {label_of(partners, offers_e[0]['partner_id'])}")

        # The decisive case: with the other two off shift again, the capped
        # partner is the only partner within range. A preference would still
        # pick them. A filter returns nobody.
        for meta in others:
            await set_available(meta, False)

        job_f = await create_job(c, owner_token, "DISPATCH-QA capped alone")
        job_row = one("SELECT status FROM jobs WHERE id=%(i)s", {"i": job_f})
        check("the only partner in range being at capacity yields no_match_found",
              job_row["status"] == "no_match_found", job_row["status"])
        check("no third job was forced onto a partner already holding two",
              len(assignments_for(job_f)) == 0,
              f"{len(assignments_for(job_f))} offer(s)")

        for meta in others:
            await set_available(meta, True)

    # ----------------------------------------------------------------------
    section("10. Cleanup — the database must return to baseline")
    # ----------------------------------------------------------------------
    purge()
    purge_supabase_accounts()
    final_counts = counts()
    check("every table is back to its baseline count", final_counts == baseline,
          f"{final_counts} vs {baseline}")
    check("the shared test user's auth link was released",
          one("SELECT auth_user_id FROM users WHERE id=%(i)s", {"i": USER_ID})["auth_user_id"] is None)

    passed = sum(1 for ok, _, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 60}\n{passed}/{total} checks passed")
    if passed != total:
        print("\nFailures:")
        for ok, label, detail in _results:
            if not ok:
                print(f"  - {label}  ({detail})")
        sys.exit(1)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
async def create_job(c, owner_token, note, lat=PICKUP_LAT, lng=PICKUP_LNG,
                     service_code=SERVICE_CODE) -> str:
    """Create a job through the API and return its id.

    Note there is no dispatch call anywhere in this helper. Dispatch happening
    at all is part of what is being tested — if it ever stops being automatic,
    every assertion downstream of this fails, which is the correct blast radius.
    """
    r = await c.post(
        "/api/v1/jobs",
        json={
            "vehicle_id": VEHICLE_ID,
            "service_code": service_code,
            "pickup_lat": lat,
            "pickup_lng": lng,
            "pickup_address_text": "Dispatch QA pickup",
            "issue_description": note,
        },
        headers=hdr(owner_token),
    )
    if r.status_code != 201:
        raise SystemExit(f"job creation failed: {r.status_code} {r.text[:300]}")
    return data_of(r)["id"]


def history_for(job_id: str) -> list:
    return rows(
        "SELECT status, changed_at FROM job_status_history "
        "WHERE job_id = %(i)s ORDER BY changed_at, status",
        {"i": job_id},
    )


def label_of(partners: dict, partner_id) -> str:
    for label, meta in partners.items():
        if meta["id"] == str(partner_id):
            return label
    return str(partner_id)


def components_match(assignment) -> bool:
    """The stored breakdown must actually add up to the stored score.

    If these can drift, score_components is decoration rather than evidence, and
    the audit trail the evaluation report depends on is worthless.
    """
    from app.utils.scoring import WEIGHTS

    components = assignment["score_components"] or {}
    expected = sum(WEIGHTS[k] * v for k, v in components.items())
    # NUMERIC(5,4) — the stored value is rounded to four places on the way in.
    return abs(float(assignment["matching_score"]) - expected) < 5e-4


def weighting_explains(assignment) -> bool:
    """Confirm the winner's rating term is what carried them past the nearer one.

    Asserting only "the far partner won" would also pass if the distance term had
    been broken to zero. This checks the margin came from where it should.
    """
    components = assignment["score_components"] or {}
    return components.get("rating_score", 0) > components.get("distance_score", 1)


def explain_score(assignment) -> str:
    components = assignment["score_components"] or {}
    parts = ", ".join(f"{k.split('_')[0]}={v:.2f}" for k, v in sorted(components.items()))
    return f"score={float(assignment['matching_score']):.4f} [{parts}]"


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        conn.close()
