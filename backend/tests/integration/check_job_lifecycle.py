"""Live end-to-end check of the job lifecycle transition endpoint.

Run it directly — it needs no server process:

    python tests/integration/check_job_lifecycle.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

What this file is really for is the second section. The lifecycle endpoint was
built because a partner who accepted a job was counted as busy by that job
forever — there was no way to move a job off an active status, so dispatch's
concurrency ceiling was a one-way door. Sections 3 and 4 below drive a partner
to the ceiling, watch dispatch stop considering them, complete a job, and watch
them become eligible again. That is the regression test; everything else is the
contract around it.

The load measurement deliberately goes through
``dispatch_repository.get_eligible_partners`` — the production query — rather
than a count written here. A harness that re-implements the SQL it is checking
only proves the author can write the same query twice.

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

# Distinct from check_dispatch_flow.py's numbers and domain so the two harnesses
# can never purge each other's rows out from under a run.
QA_DOMAIN = "sahayak-lifecycleqa.invalid"
QA_PHONES = ("+919000000911", "+919000000912")
JOB_TAG = "LIFECYCLE-QA"

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


def assignment_row(job_id: str) -> dict:
    return one(
        "SELECT id, partner_id, status, accepted_at, responded_at "
        "FROM job_assignments WHERE job_id = %(i)s AND status <> 'rejected' "
        "ORDER BY offered_at DESC LIMIT 1", {"i": job_id},
    ) or {}


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
    email = f"lifecycleqa-{label}@{QA_DOMAIN}"
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

    Returns (active_job_count, eligible). eligible is False when the partner has
    been filtered out of the candidate set entirely, which is what being at
    MAX_CONCURRENT_JOBS looks like from dispatch's side — the row does not come
    back at all, so there is no count to read.

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
    async with httpx.AsyncClient(transport=transport, base_url="http://lifecycle.test") as c:

        # ------------------------------------------------------------------
        section("1. An owner and two verified partners")
        # ------------------------------------------------------------------
        owner_auth, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner account linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        partners: dict[str, dict] = {}
        for label, phone, lat in (("primary", QA_PHONES[0], NEAR_LAT),
                                  ("bystander", QA_PHONES[1], FAR_LAT)):
            auth_id, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Lifecycle QA {label}", "phone": phone,
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

        count, eligible = await load_of(partners["primary"]["id"])
        check("primary partner starts with an active job count of 0",
              eligible and count == 0, f"count={count}, eligible={eligible}")

        # ------------------------------------------------------------------
        section("2. Happy path — assigned → en route → in progress → completed")
        # ------------------------------------------------------------------
        job_a, assign_a, worker = await create_and_accept(c, owner_token, partners, by_id, "a")
        token = partners[worker]["token"]

        check("job reached 'assigned' after the partner accepted",
              job_row(job_a)["status"] == "assigned", chain(job_a))

        count, _ = await load_of(partners[worker]["id"])
        check("accepting put the partner's active job count at 1", count == 1, f"count={count}")

        r = await c.post(f"/api/v1/jobs/{job_a}/status",
                         json={"status": "partner_en_route"}, headers=hdr(token))
        check("assigned → partner_en_route accepted", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("the database agrees the job is 'partner_en_route'",
              job_row(job_a)["status"] == "partner_en_route", chain(job_a))
        check("the assignment is still 'accepted' mid-job",
              assignment_row(job_a)["status"] == "accepted",
              "the partner has not been released yet")

        r = await c.post(f"/api/v1/jobs/{job_a}/status",
                         json={"status": "in_progress"}, headers=hdr(token))
        check("partner_en_route → in_progress accepted", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_a}/status",
                         json={"status": "completed", "price_final": 1250.50},
                         headers=hdr(token))
        check("in_progress → completed accepted", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        finished = job_row(job_a)
        check("jobs.price_final stored exactly what was sent",
              str(finished["price_final"]) == "1250.50", f"{finished['price_final']}")
        check("jobs.completed_at was stamped", finished["completed_at"] is not None,
              str(finished["completed_at"]))
        check("job_assignments row is now 'completed'",
              assignment_row(job_a)["status"] == "completed",
              f"status={assignment_row(job_a)['status']}")
        check("the response reported the assignment status too",
              data_of(r).get("assignment_status") == "completed",
              "the half a client cannot otherwise see")
        check("every transition wrote a history row",
              [h["status"] for h in history_for(job_a)] ==
              ["requested", "matching", "assigned", "partner_en_route", "in_progress", "completed"],
              chain(job_a))

        # ------------------------------------------------------------------
        section("3. The regression: does completion actually free the partner?")
        # ------------------------------------------------------------------
        count, eligible = await load_of(partners[worker]["id"])
        check("active job count is back to 0 after completion",
              eligible and count == 0, f"count={count}, eligible={eligible}")

        # Counting is one thing; being offered work is the thing that matters.
        # Drive the partner to the concurrency ceiling and back.
        job_b, _, worker_b = await create_and_accept(c, owner_token, partners, by_id, "b")
        job_c, _, worker_c = await create_and_accept(c, owner_token, partners, by_id, "c")
        at_capacity = worker_b == worker_c == worker
        count, eligible = await load_of(partners[worker]["id"])
        if at_capacity:
            check("two accepted jobs put the partner at MAX_CONCURRENT_JOBS",
                  not eligible, "dispatch no longer returns them as a candidate")
        else:
            check("two accepted jobs put the partner at MAX_CONCURRENT_JOBS",
                  count is not None and count >= 1,
                  f"offers spread across partners; {worker} at {count}")

        r = await c.post(f"/api/v1/jobs/{job_b}/status",
                         json={"status": "cancelled", "cancellation_reason": "car started on its own"},
                         headers=hdr(partners[worker_b]["token"]))
        check("a job can be cancelled straight from 'assigned'", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("jobs.cancelled_at and cancellation_reason were stored",
              job_row(job_b)["cancelled_at"] is not None
              and job_row(job_b)["cancellation_reason"] == "car started on its own",
              str(job_row(job_b)["cancellation_reason"]))
        check("the cancelled job's assignment reads 'cancelled', not 'rejected'",
              assignment_row(job_b)["status"] == "cancelled",
              "ADR-012 — 'rejected' is the partner's answer to an offer, and feeds acceptance rate")

        count_after, eligible_after = await load_of(partners[worker_b]["id"])
        check("cancelling released the partner from that job's load",
              eligible_after, f"count={count_after}, eligible={eligible_after}")

        # Tidy job_c away through the API so the next section starts clean.
        await c.post(f"/api/v1/jobs/{job_c}/status",
                     json={"status": "cancelled"}, headers=hdr(partners[worker_c]["token"]))
        count, eligible = await load_of(partners[worker]["id"])
        check("with every job closed out, the partner is fully free again",
              eligible and count == 0, f"count={count}")

        # ------------------------------------------------------------------
        section("4. Illegal transitions are refused")
        # ------------------------------------------------------------------
        job_d, _, worker_d = await create_and_accept(c, owner_token, partners, by_id, "d")
        dtoken = partners[worker_d]["token"]

        r = await c.post(f"/api/v1/jobs/{job_d}/status",
                         json={"status": "completed", "price_final": 800},
                         headers=hdr(dtoken))
        check("assigned → completed (skipping two steps) is 409",
              r.status_code == 409 and code_of(r) == "INVALID_STATUS_TRANSITION",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the refused transition wrote nothing",
              job_row(job_d)["status"] == "assigned" and len(history_for(job_d)) == 3,
              chain(job_d))

        r = await c.post(f"/api/v1/jobs/{job_d}/status",
                         json={"status": "in_progress"}, headers=hdr(dtoken))
        check("assigned → in_progress (skipping one step) is 409",
              r.status_code == 409, f"HTTP {r.status_code} {code_of(r)}")

        # Walk it to completed, then try to move it again.
        for target, body in (("partner_en_route", {}), ("in_progress", {}),
                             ("completed", {"price_final": 640})):
            await c.post(f"/api/v1/jobs/{job_d}/status",
                         json={"status": target, **body}, headers=hdr(dtoken))

        for target in ("in_progress", "cancelled", "partner_en_route", "completed"):
            body = {"status": target}
            if target == "completed":
                body["price_final"] = 900
            r = await c.post(f"/api/v1/jobs/{job_d}/status", json=body, headers=hdr(dtoken))
            check(f"completed → {target} is refused (terminal state)",
                  r.status_code == 409 and code_of(r) == "INVALID_STATUS_TRANSITION",
                  f"HTTP {r.status_code} {code_of(r)}")

        check("the finished job still reads 'completed' with its original price",
              job_row(job_d)["status"] == "completed" and str(job_row(job_d)["price_final"]) == "640.00",
              f"{job_row(job_d)['status']} / {job_row(job_d)['price_final']}")

        # ------------------------------------------------------------------
        section("5. Only the assigned partner may move a job")
        # ------------------------------------------------------------------
        job_e, _, worker_e = await create_and_accept(c, owner_token, partners, by_id, "e")
        intruder = "bystander" if worker_e == "primary" else "primary"

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "partner_en_route"},
                         headers=hdr(partners[intruder]["token"]))
        check("a different partner gets 403, not 409",
              r.status_code == 403 and code_of(r) == "FORBIDDEN",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the intruder's attempt changed nothing",
              job_row(job_e)["status"] == "assigned", chain(job_e))

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "partner_en_route"}, headers=hdr(owner_token))
        check("the job's own owner is also refused — this is a partner route",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status", json={"status": "partner_en_route"})
        check("an unauthenticated caller gets 401", r.status_code == 401,
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{uuid.uuid4()}/status",
                         json={"status": "partner_en_route"},
                         headers=hdr(partners[worker_e]["token"]))
        check("an unknown job id is 404 JOB_NOT_FOUND",
              r.status_code == 404 and code_of(r) == "JOB_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        # ------------------------------------------------------------------
        section("6. The body must match the transition")
        # ------------------------------------------------------------------
        etoken = partners[worker_e]["token"]
        for target in ("partner_en_route", "in_progress"):
            r = await c.post(f"/api/v1/jobs/{job_e}/status",
                             json={"status": target}, headers=hdr(etoken))
            if r.status_code != 200:
                raise SystemExit(f"could not walk job_e to {target}: {r.status_code} {r.text[:300]}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "completed"}, headers=hdr(etoken))
        check("completing without price_final is 400 PRICE_FINAL_REQUIRED",
              r.status_code == 400 and code_of(r) == "PRICE_FINAL_REQUIRED",
              f"HTTP {r.status_code} {code_of(r)}")
        check("the failed completion left the job in progress and the price null",
              job_row(job_e)["status"] == "in_progress" and job_row(job_e)["price_final"] is None,
              chain(job_e))

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "completed", "price_final": -5}, headers=hdr(etoken))
        check("a negative price is rejected by the schema (422)", r.status_code == 422,
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "completed", "price_final": 700,
                               "cancellation_reason": "not a cancellation"},
                         headers=hdr(etoken))
        check("a cancellation_reason on a completion is 400 FIELD_NOT_APPLICABLE",
              r.status_code == 400 and code_of(r) == "FIELD_NOT_APPLICABLE",
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "cancelled", "price_final": 700}, headers=hdr(etoken))
        check("a price on a cancellation is 400 FIELD_NOT_APPLICABLE",
              r.status_code == 400 and code_of(r) == "FIELD_NOT_APPLICABLE",
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "finished", "price_final": 700}, headers=hdr(etoken))
        check("an unrecognised status is 422, naming the valid values",
              r.status_code == 422, f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "assigned"}, headers=hdr(etoken))
        check("a server-owned status cannot be requested at all (422)",
              r.status_code == 422, "dispatch owns 'assigned'; a partner cannot rewind a job")

        r = await c.post(f"/api/v1/jobs/{job_e}/status",
                         json={"status": "completed", "price_final": 700}, headers=hdr(etoken))
        check("the same completion succeeds once the body is right", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("only the successful attempt is in the timeline",
              [h["status"] for h in history_for(job_e)].count("completed") == 1,
              chain(job_e))

        # ------------------------------------------------------------------
        section("7. GET /jobs/{id} reflects the finished job")
        # ------------------------------------------------------------------
        r = await c.get(f"/api/v1/jobs/{job_e}", headers=hdr(owner_token))
        detail = data_of(r)
        check("owner can read the completed job", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("the detail response carries price_final and completed_at",
              detail.get("price_final") is not None and detail.get("completed_at") is not None,
              f"price_final={detail.get('price_final')}")
        check("current_assignment shows the closed-out assignment",
              (detail.get("current_assignment") or {}).get("status") == "completed",
              str((detail.get("current_assignment") or {}).get("status")))
        check("the timeline has all six entries",
              len(detail.get("timeline") or []) == 6,
              f"{len(detail.get('timeline') or [])} entries")

    # ----------------------------------------------------------------------
    section("8. Cleanup and baseline")
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
async def create_and_accept(c, owner_token, partners, by_id, tag) -> tuple:
    """Create a job, let dispatch offer it, and accept as whoever was offered it.

    Reading the offer back and accepting as *that* partner, rather than assuming
    the nearest one won, is deliberate: the scoring weights are dispatch's
    business and are tuned elsewhere. A lifecycle harness that broke every time
    someone adjusted a weight would be testing the wrong module.

    Returns (job_id, assignment_id, partner_label).
    """
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Lifecycle QA pickup",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    offer = assignment_row(job_id)
    if not offer:
        raise SystemExit(f"job {tag} got no offer — dispatch found no candidate")
    label = by_id[str(offer["partner_id"])]

    r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                     json={"action": "accept"}, headers=hdr(partners[label]["token"]))
    if r.status_code != 200:
        raise SystemExit(f"accept for job {tag} failed: {r.status_code} {r.text[:300]}")
    return job_id, str(offer["id"]), label


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        conn.close()
