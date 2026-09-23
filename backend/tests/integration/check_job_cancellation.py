"""Live end-to-end check of owner-initiated job cancellation.

Run it directly — it needs no server process:

    python tests/integration/check_job_cancellation.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

This endpoint's whole reason to exist is the statuses the partner route cannot
reach. A partner can only touch a job that was assigned to them, which means
that until now the entire window between "driver taps request" and "a mechanic
accepts" had no exit — the exact window in which a driver is most likely to
change their mind, because they are sitting there watching a spinner. Sections
2 and 3 are that window: a job with no assignment row at all, and a job with an
offer nobody has answered yet.

Section 4 is the regression check, and it is the same mechanism the lifecycle
harness guards: cancelling must actually release the partner, measured through
``dispatch_repository.get_eligible_partners`` — the production query — rather
than through a count written here. A harness that re-implements the SQL it is
checking only proves the author can write the same query twice.

Section 6 is the one that would catch the worst possible regression on this
route: an owner cancelling somebody else's booking. It is checked against a
*second real registered owner*, not a forged id.

The database is real and every assertion is made against Postgres, not against
the API's own response body. Tokens are real Supabase tokens. Redis is
fakeredis, the single substitution, for the reasons set out at the top of
check_dispatch_flow.py.

Cleanup runs at both ends and the run FAILS if the table counts do not return
to their baseline.
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

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False
SERVICE_ID = 3

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
NEAR_LAT = PICKUP_LAT + 1.0 / KM_PER_DEG_LAT
FAR_LAT = PICKUP_LAT + 6.0 / KM_PER_DEG_LAT

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another.
QA_DOMAIN = "sahayak-cancelqa.invalid"
QA_PHONES = ("+919000000931", "+919000000932")   # the two partners
OWNER_B_PHONE = "+919000000933"                  # the second registered owner
JOB_TAG = "CANCEL-QA"

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


def job_row(job_id: str) -> dict:
    return one(
        "SELECT status, price_final, completed_at, cancelled_at, cancellation_reason "
        "FROM jobs WHERE id = %(i)s", {"i": job_id},
    ) or {}


def assignments_for(job_id: str) -> list:
    """Every assignment row for a job, newest offer first — unfiltered.

    The lifecycle harness excludes 'rejected' because it only ever cares about
    the live one. Here the whole point is which rows were touched and which
    were left alone, so nothing is filtered out.
    """
    return rows(
        "SELECT id, partner_id, status FROM job_assignments "
        "WHERE job_id = %(i)s ORDER BY offered_at DESC", {"i": job_id},
    )


def latest_assignment(job_id: str) -> dict:
    found = assignments_for(job_id)
    return found[0] if found else {}


def history_for(job_id: str) -> list:
    return rows(
        "SELECT status, note, changed_at FROM job_status_history "
        "WHERE job_id = %(i)s ORDER BY changed_at, id", {"i": job_id},
    )


def chain(job_id: str) -> str:
    return " → ".join(h["status"] for h in history_for(job_id))


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone numbers and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = ANY(%(p)s))", {"p": list(QA_PHONES)},
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
        "(SELECT id FROM partners WHERE phone = ANY(%(p)s))", {"p": list(QA_PHONES)},
    )
    q.execute("DELETE FROM partners WHERE phone = ANY(%(p)s)", {"p": list(QA_PHONES)})
    # The second owner is a real users row created through POST /users, so it
    # has to go too. Scoped by its own phone number and nothing else.
    q.execute("DELETE FROM users WHERE phone = %(p)s", {"p": OWNER_B_PHONE})
    q.execute("UPDATE users SET auth_user_id = NULL WHERE id = %(i)s", {"i": USER_ID})


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
    email = f"cancelqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa.post(
        "/auth/v1/admin/users", headers=_admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]

    r = _supa.post(
        "/auth/v1/token", params={"grant_type": "password"},
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


async def load_of(partner_id: str) -> tuple:
    """Ask the production eligibility query what this partner's load is.

    Returns (active_job_count, eligible). eligible is False when the partner
    has been filtered out of the candidate set entirely, which is what being at
    MAX_CONCURRENT_JOBS looks like from dispatch's side.

    Going through dispatch_repository rather than counting here is the point:
    the question is not "does my SQL say zero", it is "does the query that
    actually decides whether this partner gets offered work say zero".
    """
    from app.config.database import AsyncSessionLocal
    from app.repositories import dispatch_repository

    async with AsyncSessionLocal() as db:
        found = await dispatch_repository.get_eligible_partners(
            db,
            partner_ids=[uuid.UUID(partner_id)],
            service_id=SERVICE_ID,
            requires_equipment=False,
        )
    if not found:
        return None, False
    return int(found[0].active_job_count), True


async def main() -> None:
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app  # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://cancel.test") as c:

        # ------------------------------------------------------------------
        section("1. Two owners and two verified partners")
        # ------------------------------------------------------------------
        owner_auth, owner_token = supabase_identity("owner-a")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner A linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        # A second *real* owner, registered through the public signup route.
        # The 403 check later is only worth anything against a genuine second
        # account — a forged user_id would be testing the token verifier, which
        # check_auth_flow.py already owns.
        _, owner_b_token = supabase_identity("owner-b")
        r = await c.post("/api/v1/users", json={
            "name": "Cancel QA Bystander", "phone": OWNER_B_PHONE,
        }, headers=hdr(owner_b_token))
        if r.status_code != 201:
            raise SystemExit(f"owner B registration failed: {r.status_code} {r.text[:300]}")
        owner_b_id = data_of(r)["id"]
        check("owner B registered as a separate vehicle owner", r.status_code == 201,
              f"user_id {owner_b_id[:8]}…")

        partners: dict[str, dict] = {}
        for label, phone, lat in (("primary", QA_PHONES[0], NEAR_LAT),
                                  ("bystander", QA_PHONES[1], FAR_LAT)):
            _, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Cancel QA {label}", "phone": phone,
                "primary_category_code": "mechanical",
            })
            if r.status_code != 201:
                raise SystemExit(f"partner {label} registration failed: {r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]

            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"partner {label} link-auth failed: {r.status_code} {r.text[:300]}")

            # Verification has no endpoint yet — that workflow is a separate
            # task — so it is set directly rather than pretended away.
            q = conn.cursor()
            q.execute("UPDATE partners SET verification_status='verified', "
                      "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": pid})

            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": PICKUP_LNG}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code != 200:
                    raise SystemExit(f"{label} setup failed at {path}: {r.status_code} {r.text[:300]}")

            r = await c.patch(f"/api/v1/partners/{pid}/availability",
                              json={"is_available": True}, headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} availability failed: {r.status_code} {r.text[:300]}")

            partners[label] = {"id": pid, "token": token}
            check(f"{label} partner is verified, available and on shift",
                  r.status_code == 200, f"partner_id {pid[:8]}…")

        by_id = {meta["id"]: label for label, meta in partners.items()}

        # ------------------------------------------------------------------
        section("2. Cancelling a job that has no assignment row at all")
        # ------------------------------------------------------------------
        # The case the partner endpoint structurally cannot reach, and the one
        # that would blow up on a missing row if step 5 of the service assumed
        # an assignment exists.
        await set_availability(c, partners, False)
        job_nm = await create_job(c, owner_token, "nomatch")
        check("with nobody on shift the job lands in 'no_match_found'",
              job_row(job_nm)["status"] == "no_match_found", chain(job_nm))
        check("and it genuinely has no assignment row",
              assignments_for(job_nm) == [], f"{len(assignments_for(job_nm))} rows")

        r = await c.post(f"/api/v1/jobs/{job_nm}/cancel",
                         json={"cancellation_reason": "found a friend with cables"},
                         headers=hdr(owner_token))
        check("an owner can cancel a job that found nobody", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("the database agrees it is 'cancelled'",
              job_row(job_nm)["status"] == "cancelled", chain(job_nm))
        check("assignment_status is null — no partner was released",
              data_of(r).get("assignment_status") is None,
              str(data_of(r).get("assignment_status")))
        check("cancelled_at and cancellation_reason were stored",
              job_row(job_nm)["cancelled_at"] is not None
              and job_row(job_nm)["cancellation_reason"] == "found a friend with cables",
              str(job_row(job_nm)["cancellation_reason"]))

        # A job left in 'requested' is what a dispatch fault produces — the
        # guarded path in _try_dispatch. Forced here rather than simulated by
        # breaking Redis, because the state is the point, not how it arose.
        job_req = await create_job(c, owner_token, "requested")
        q = conn.cursor()
        q.execute("UPDATE jobs SET status='requested' WHERE id=%(i)s", {"i": job_req})
        q.execute("DELETE FROM job_assignments WHERE job_id=%(i)s", {"i": job_req})

        r = await c.post(f"/api/v1/jobs/{job_req}/cancel", headers=hdr(owner_token))
        check("a job still in 'requested' can be cancelled, with no body at all",
              r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")
        check("no cancellation_reason is stored when none was sent",
              job_row(job_req)["cancellation_reason"] is None,
              str(job_row(job_req)["cancellation_reason"]))
        check("the timeline records who cancelled it",
              history_for(job_req)[-1]["note"] == "Cancelled by owner",
              str(history_for(job_req)[-1]["note"]))

        await set_availability(c, partners, True)

        # ------------------------------------------------------------------
        section("3. Cancelling while an offer is still outstanding")
        # ------------------------------------------------------------------
        job_off = await create_job(c, owner_token, "offered")
        offer = latest_assignment(job_off)
        check("the job is in 'matching' with one offer out",
              job_row(job_off)["status"] == "matching" and offer.get("status") == "offered",
              f"{job_row(job_off)['status']} / {offer.get('status')}")

        r = await c.post(f"/api/v1/jobs/{job_off}/cancel",
                         json={"cancellation_reason": "towed already"},
                         headers=hdr(owner_token))
        check("an owner can cancel out from under an unanswered offer",
              r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")
        check("the outstanding offer is closed as 'cancelled'",
              latest_assignment(job_off)["status"] == "cancelled",
              f"status={latest_assignment(job_off)['status']}")
        check("the offer is NOT recorded as 'rejected'",
              latest_assignment(job_off)["status"] != "rejected",
              "ADR-012 — 'rejected' is the partner's own answer and feeds acceptance rate")
        check("the response reported the released assignment",
              data_of(r).get("assignment_status") == "cancelled",
              str(data_of(r).get("assignment_status")))

        # The partner must not be able to answer an offer for a job that is
        # gone. This is the reason 'offered' rows are closed, not just accepted
        # ones.
        offered_partner = by_id[str(offer["partner_id"])]
        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"},
                         headers=hdr(partners[offered_partner]["token"]))
        check("the partner can no longer accept the cancelled offer",
              r.status_code in (409, 404), f"HTTP {r.status_code} {code_of(r)}")
        check("and the attempt did not resurrect the job",
              job_row(job_off)["status"] == "cancelled", chain(job_off))

        # ------------------------------------------------------------------
        section("4. The regression: cancelling must free the partner")
        # ------------------------------------------------------------------
        job_acc, worker = await create_and_accept(c, owner_token, partners, by_id, "accepted")
        check("the job reached 'assigned' after the partner accepted",
              job_row(job_acc)["status"] == "assigned", chain(job_acc))

        count, _ = await load_of(partners[worker]["id"])
        check("accepting put the partner's active job count at 1", count == 1, f"count={count}")

        r = await c.post(f"/api/v1/jobs/{job_acc}/cancel",
                         json={"cancellation_reason": "changed my mind"},
                         headers=hdr(owner_token))
        check("an owner can cancel a job a partner has already accepted",
              r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")
        check("the accepted assignment is closed as 'cancelled', not 'rejected'",
              latest_assignment(job_acc)["status"] == "cancelled",
              f"status={latest_assignment(job_acc)['status']}")

        count, eligible = await load_of(partners[worker]["id"])
        check("the partner's active job count dropped back to 0",
              eligible and count == 0, f"count={count}, eligible={eligible}")

        check("the timeline names the owner, not the partner, as the canceller",
              history_for(job_acc)[-1]["note"] == "Cancelled by owner: changed my mind",
              str(history_for(job_acc)[-1]["note"]))

        r = await c.get(f"/api/v1/jobs/{job_acc}", headers=hdr(owner_token))
        detail = data_of(r)
        check("GET /jobs/{id} shows the cancelled job to its owner",
              r.status_code == 200 and detail.get("status") == "cancelled",
              f"HTTP {r.status_code} / {detail.get('status')}")
        check("current_assignment reflects the closed-out assignment",
              (detail.get("current_assignment") or {}).get("status") == "cancelled",
              str((detail.get("current_assignment") or {}).get("status")))

        # ------------------------------------------------------------------
        section("5. Cancelling mid-job, after the mechanic is on the way")
        # ------------------------------------------------------------------
        job_mid, worker_mid = await create_and_accept(c, owner_token, partners, by_id, "midjob")
        mid_token = partners[worker_mid]["token"]
        for target in ("partner_en_route", "in_progress"):
            r = await c.post(f"/api/v1/jobs/{job_mid}/status",
                             json={"status": target}, headers=hdr(mid_token))
            if r.status_code != 200:
                raise SystemExit(f"could not walk job to {target}: {r.status_code} {r.text[:300]}")

        r = await c.post(f"/api/v1/jobs/{job_mid}/cancel", json={},
                         headers=hdr(owner_token))
        check("an owner can cancel a job already in progress", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("no price was written by the cancellation",
              job_row(job_mid)["price_final"] is None and job_row(job_mid)["completed_at"] is None,
              f"price_final={job_row(job_mid)['price_final']}")
        check("the full timeline is preserved",
              [h["status"] for h in history_for(job_mid)] ==
              ["requested", "matching", "assigned", "partner_en_route", "in_progress", "cancelled"],
              chain(job_mid))

        count, eligible = await load_of(partners[worker_mid]["id"])
        check("the partner is free again after a mid-job cancellation",
              eligible and count == 0, f"count={count}")

        # ------------------------------------------------------------------
        section("6. Only the job's own owner may cancel it")
        # ------------------------------------------------------------------
        job_prot, worker_prot = await create_and_accept(c, owner_token, partners, by_id, "protected")

        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel",
                         json={"cancellation_reason": "not mine to cancel"},
                         headers=hdr(owner_b_token))
        check("a different registered owner gets 403",
              r.status_code == 403 and code_of(r) == "FORBIDDEN",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the intruder's attempt changed nothing",
              job_row(job_prot)["status"] == "assigned"
              and job_row(job_prot)["cancellation_reason"] is None,
              chain(job_prot))

        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel", json={},
                         headers=hdr(partners[worker_prot]["token"]))
        check("the assigned partner is also refused — this is an owner route",
              r.status_code == 403 and code_of(r) == "FORBIDDEN",
              f"HTTP {r.status_code} {code_of(r)}")

        other = "bystander" if worker_prot == "primary" else "primary"
        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel", json={},
                         headers=hdr(partners[other]["token"]))
        check("an unrelated partner is refused the same way", r.status_code == 403,
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel", json={})
        check("an unauthenticated caller gets 401", r.status_code == 401,
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{uuid.uuid4()}/cancel", json={},
                         headers=hdr(owner_token))
        check("an unknown job id is 404 JOB_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        check("the protected job survived every refused attempt",
              job_row(job_prot)["status"] == "assigned"
              and latest_assignment(job_prot)["status"] == "accepted",
              chain(job_prot))

        # ------------------------------------------------------------------
        section("7. A finished job cannot be cancelled")
        # ------------------------------------------------------------------
        prot_token = partners[worker_prot]["token"]
        for target, body in (("partner_en_route", {}), ("in_progress", {}),
                             ("completed", {"price_final": 940})):
            r = await c.post(f"/api/v1/jobs/{job_prot}/status",
                             json={"status": target, **body}, headers=hdr(prot_token))
            if r.status_code != 200:
                raise SystemExit(f"could not complete the job at {target}: "
                                 f"{r.status_code} {r.text[:300]}")

        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel",
                         json={"cancellation_reason": "too late"},
                         headers=hdr(owner_token))
        check("cancelling a completed job is 409 JOB_ALREADY_TERMINAL",
              r.status_code == 409 and code_of(r) == "JOB_ALREADY_TERMINAL",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the finished job kept its status, price and completion time",
              job_row(job_prot)["status"] == "completed"
              and str(job_row(job_prot)["price_final"]) == "940.00"
              and job_row(job_prot)["completed_at"] is not None,
              f"{job_row(job_prot)['status']} / {job_row(job_prot)['price_final']}")
        check("the refused cancellation wrote nothing",
              job_row(job_prot)["cancelled_at"] is None
              and job_row(job_prot)["cancellation_reason"] is None,
              "no cancelled_at, no reason")
        check("and it wrote no history row",
              [h["status"] for h in history_for(job_prot)].count("cancelled") == 0,
              chain(job_prot))

        # Already-cancelled: the double-tap case.
        r = await c.post(f"/api/v1/jobs/{job_acc}/cancel", json={},
                         headers=hdr(owner_token))
        check("cancelling an already-cancelled job is 409 JOB_ALREADY_TERMINAL",
              r.status_code == 409 and code_of(r) == "JOB_ALREADY_TERMINAL",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the second attempt did not add a second history row",
              [h["status"] for h in history_for(job_acc)].count("cancelled") == 1,
              chain(job_acc))
        check("the original cancellation_reason was not overwritten",
              job_row(job_acc)["cancellation_reason"] == "changed my mind",
              str(job_row(job_acc)["cancellation_reason"]))

        # 403 must win over 409, or the error code becomes a state oracle: a
        # stranger could sweep job ids and read each one's state off which
        # error came back.
        r = await c.post(f"/api/v1/jobs/{job_prot}/cancel", json={},
                         headers=hdr(owner_b_token))
        check("a stranger cancelling a *completed* job still gets 403, not 409",
              r.status_code == 403,
              f"HTTP {r.status_code} {code_of(r)} — the status must not leak")

        # ------------------------------------------------------------------
        section("8. The request body")
        # ------------------------------------------------------------------
        job_body = await create_job(c, owner_token, "body")

        r = await c.post(f"/api/v1/jobs/{job_body}/cancel",
                         json={"status": "cancelled"}, headers=hdr(owner_token))
        check("sending a 'status' field is 422, not a silent 200",
              r.status_code == 422, f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_body}/cancel",
                         json={"cancellation_reason": "x" * 501}, headers=hdr(owner_token))
        check("an over-long cancellation_reason is 422", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")

        check("neither rejected body changed the job",
              job_row(job_body)["status"] in ("matching", "no_match_found"),
              chain(job_body))

        r = await c.post(f"/api/v1/jobs/{job_body}/cancel",
                         json={"cancellation_reason": "x" * 500}, headers=hdr(owner_token))
        check("a reason at exactly the limit is accepted", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

    # ----------------------------------------------------------------------
    section("9. Cleanup and baseline")
    # ----------------------------------------------------------------------
    purge()
    purge_supabase_accounts()
    final_counts = counts()
    check("every table is back to its baseline count", final_counts == baseline,
          f"{final_counts} vs {baseline}")
    check("the shared test user's auth link was released",
          one("SELECT auth_user_id FROM users WHERE id=%(i)s", {"i": USER_ID})["auth_user_id"] is None)
    check("the second owner's row is gone",
          one("SELECT id FROM users WHERE phone=%(p)s", {"p": OWNER_B_PHONE}) is None)

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
async def set_availability(c, partners, available: bool) -> None:
    """Take every QA partner on or off shift, through the real endpoint.

    Used to manufacture a 'no_match_found' job. Going through the API rather
    than an UPDATE keeps the Redis-side availability state in step with the
    column, which is what the eligibility query actually reads.
    """
    for meta in partners.values():
        r = await c.patch(f"/api/v1/partners/{meta['id']}/availability",
                          json={"is_available": available}, headers=hdr(meta["token"]))
        if r.status_code != 200:
            raise SystemExit(f"availability toggle failed: {r.status_code} {r.text[:300]}")


async def create_job(c, owner_token, tag: str) -> str:
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Cancel QA pickup",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    return data_of(r)["id"]


async def create_and_accept(c, owner_token, partners, by_id, tag) -> tuple:
    """Create a job, let dispatch offer it, and accept as whoever was offered it.

    Reading the offer back and accepting as *that* partner, rather than
    assuming the nearest one won, is deliberate: the scoring weights are
    dispatch's business and are tuned elsewhere. A cancellation harness that
    broke every time someone adjusted a weight would be testing the wrong
    module.

    Returns (job_id, partner_label).
    """
    job_id = await create_job(c, owner_token, tag)

    offer = latest_assignment(job_id)
    if not offer:
        raise SystemExit(f"job {tag} got no offer — dispatch found no candidate")
    label = by_id[str(offer["partner_id"])]

    r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                     json={"action": "accept"}, headers=hdr(partners[label]["token"]))
    if r.status_code != 200:
        raise SystemExit(f"accept for job {tag} failed: {r.status_code} {r.text[:300]}")
    return job_id, label


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        conn.close()
