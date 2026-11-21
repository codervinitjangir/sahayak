"""Live check: Sahayak Care memberships without payments (ADR-051).

    python tests/integration/check_care.py

Real database (asyncpg through the app, psycopg2 for setup), fakeredis, identity
by dependency_overrides. Rows are scoped by phone +91900000079x. Jobs are made as
bookings (ADR-050) so no dispatch runs and every status is the harness's choice.
"""
import asyncio
import sys
import uuid
from pathlib import Path

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
PHONE_PREFIX = "+91900000079"
TAG = "QA-CARE"
conn = psycopg2.connect(S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
conn.autocommit = True
_results: list[bool] = []


def check(label, ok, detail=""):
    _results.append(bool(ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  — {detail}" if detail and not ok else ""))


def section(t):
    print(f"\n{t}\n" + "-" * len(t))


def one(sql, params=None):
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    r = q.fetchall() if q.description else []
    return r[0] if r else None


def run(sql, params=None):
    conn.cursor().execute(sql, params or {})


def counts():
    return {t: one(f"SELECT count(*) n FROM {t}")["n"] for t in
            ("users", "vehicles", "jobs", "job_status_history", "notifications",
             "care_memberships", "care_plans", "admin_audit_log")}


def purge():
    p = {"p": PHONE_PREFIX + "%"}
    uids = "(SELECT id FROM users WHERE phone LIKE %(p)s)"
    jobs = f"(SELECT id FROM jobs WHERE user_id IN {uids})"
    q = conn.cursor()
    # The audit log is append-only by trigger (ADR-029); the harness's own rows
    # are the one exception, removed in one transaction with the trigger off.
    q.execute("BEGIN")
    q.execute("ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute(f"DELETE FROM admin_audit_log WHERE target_type = 'user' AND target_id IN {uids}", p)
    q.execute("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("COMMIT")
    q.execute(f"DELETE FROM notifications WHERE recipient_id IN {uids} OR job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_status_history WHERE job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN {jobs}", p)
    q.execute(f"DELETE FROM jobs WHERE id IN {jobs}", p)
    q.execute(f"DELETE FROM care_memberships WHERE user_id IN {uids}", p)
    q.execute(f"DELETE FROM vehicles WHERE user_id IN {uids}", p)
    q.execute(f"DELETE FROM users WHERE id IN {uids}", p)


async def main():
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    from app.main import app
    from app.services import push_service
    from app.services.auth_service import Identity
    from app.utils.auth import get_current_identity

    purge()
    baseline = counts()
    print(f"baseline: {baseline}")

    admin_id = one("SELECT id FROM admins ORDER BY name LIMIT 1")["id"]
    owner_auth = uuid.uuid4()
    owner = str(one("INSERT INTO users (name, phone, auth_user_id) VALUES ('Care QA owner', %(p)s, %(a)s) RETURNING id",
                    {"p": PHONE_PREFIX + "0", "a": str(owner_auth)})["id"])
    vehicle = str(one("INSERT INTO vehicles (user_id, vehicle_type, vehicle_number) VALUES "
                      "(%(u)s, 'four_wheeler', 'QA79CAR0001') RETURNING id", {"u": owner})["id"])

    as_owner = Identity(auth_user_id=owner_auth, role="user", local_id=uuid.UUID(owner))
    as_ops = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)), admin_role="ops")
    as_support = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)),
                          admin_role="support")
    current = {"i": as_owner}
    app.dependency_overrides[get_current_identity] = lambda: current["i"]

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://care.test", timeout=60) as c:
        slots = (await c.get("/api/v1/jobs/schedule-slots")).json()["data"]["slots"]

        async def book(i, text):
            r = await c.post("/api/v1/jobs", json={
                "vehicle_id": vehicle, "service_code": "battery_jumpstart", "pickup_lat": 23.03, "pickup_lng": 72.56,
                "pickup_address_text": "Care QA pickup", "issue_description": f"{TAG} {text}",
                "scheduled_for": slots[i]["start"]})
            return r.status_code, (r.json().get("data") or {})

        def complete(jid):
            run("UPDATE jobs SET status='completed', completed_at=now() WHERE id=%(j)s", {"j": jid})

        async def mine():
            return (await c.get("/api/v1/users/me/care")).json()["data"]

        section("1. No membership")
        d = await mine()
        plan = next((p for p in d.get("plans", []) if p["code"] == "care"), None)
        check("GET /users/me/care: no membership, the plan on offer, the pricing note",
              d["membership"] is None and plan and plan["callouts"] == 4 and plan["term_days"] == 365
              and "price is the same" in d["pricing_note"], str(d)[:200])
        code, job0 = await book(0, "before care")
        check("a job before any membership is not covered", code == 201 and job0.get("care_covered") is False, str(job0)[:160])
        complete(job0["id"])

        section("2. Who may grant")
        r = await c.post(f"/api/v1/admin/users/{owner}/care", json={"reason": "pilot owner"})
        check("an owner cannot grant (403)", r.status_code == 403, f"HTTP {r.status_code}")
        current["i"] = as_support
        r = await c.post(f"/api/v1/admin/users/{owner}/care", json={"reason": "pilot owner"})
        check("support staff cannot grant (403)", r.status_code == 403, f"HTTP {r.status_code}")
        r = await c.get(f"/api/v1/admin/users/{owner}/care")
        check("any staff can read it", r.status_code == 200 and r.json()["data"]["current"] is None, f"HTTP {r.status_code}")

        section("3. Grant")
        current["i"] = as_ops
        r = await c.post(f"/api/v1/admin/users/{owner}/care", json={"plan_code": "gold", "reason": "pilot owner"})
        check("an unknown plan is 400 CARE_PLAN_NOT_FOUND", r.status_code == 400
              and r.json()["error"]["code"] == "CARE_PLAN_NOT_FOUND", r.text[:160])
        r = await c.post(f"/api/v1/admin/users/{owner}/care", json={"reason": "pilot owner"})
        cur = (r.json().get("data") or {}).get("current") or {}
        check("ops grants it: 201, active, 4 call-outs left", r.status_code == 201 and cur.get("active")
              and cur.get("callouts_left") == 4, r.text[:200])
        check("the grant is audited", one("SELECT count(*) n FROM admin_audit_log WHERE action='care_granted' "
                                          "AND target_id=%(u)s", {"u": owner})["n"] == 1)
        r = await c.post(f"/api/v1/admin/users/{owner}/care", json={"reason": "again"})
        check("a second grant while one is in force is 409 CARE_ALREADY_ACTIVE", r.status_code == 409
              and r.json()["error"]["code"] == "CARE_ALREADY_ACTIVE", r.text[:160])
        r = await c.get("/api/v1/admin/users", params={"q": PHONE_PREFIX + "0"})
        row = next((u for u in r.json()["data"]["items"] if u["id"] == owner), {})
        check("the owners list shows Care until", row.get("care_until") is not None, str(row)[:200])

        section("4. Jobs use call-outs; cancelled ones give them back")
        current["i"] = as_owner
        covered = []
        for i in (1, 2, 3):
            code, j = await book(i, f"covered {i}")
            covered.append(j)
            complete(j["id"])
        check("three jobs in a row are covered", all(j.get("care_covered") for j in covered), str([j.get("care_covered") for j in covered]))
        d = await mine()
        check("3 used, 1 left", d["membership"]["callouts_used"] == 3 and d["membership"]["callouts_left"] == 1,
              str(d["membership"]))
        r = await c.get(f"/api/v1/jobs/{covered[0]['id']}")
        check("GET /jobs/{id} says covered", r.json()["data"].get("care_covered") is True)
        r = await c.get("/api/v1/jobs")
        items = {j["id"]: j for j in r.json()["data"]["items"]}
        check("GET /jobs says covered per row", items[covered[0]["id"]]["care_covered"] is True
              and items[job0["id"]]["care_covered"] is False)

        # Deterministic race: session A takes the last call-out and holds the
        # membership lock; session B must wait for A's commit, then see none left.
        from datetime import datetime, timezone
        from sqlalchemy import update
        from app.config.database import AsyncSessionLocal
        from app.models.job import Job
        from app.services import care_service
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as a, AsyncSessionLocal() as b:
            got_a = await care_service.membership_for_new_job(a, uuid.UUID(owner), now)
            task_b = asyncio.create_task(care_service.membership_for_new_job(b, uuid.UUID(owner), now))
            await asyncio.sleep(1.5)
            b_waited = not task_b.done()
            await a.execute(update(Job).where(Job.id == uuid.UUID(job0["id"])).values(care_membership_id=got_a))
            await a.commit()
            got_b = await task_b
            await b.rollback()
        check("the second creation waits on the membership lock and then finds none left",
              got_a is not None and b_waited and got_b is None, f"a={got_a} waited={b_waited} b={got_b}")
        run("UPDATE jobs SET care_membership_id = NULL WHERE id=%(j)s", {"j": job0["id"]})

        (c1, d1), (c2, d2) = await asyncio.gather(book(4, "race a"), book(5, "race b"))
        check("two jobs raised at once with one call-out left: exactly one is covered",
              c1 == c2 == 201 and [d1.get("care_covered"), d2.get("care_covered")].count(True) == 1,
              f"{c1} {c2} {d1.get('care_covered')} {d2.get('care_covered')}")
        d = await mine()
        check("4 used, 0 left", d["membership"]["callouts_used"] == 4 and d["membership"]["callouts_left"] == 0,
              str(d["membership"]))
        won = d1 if d1.get("care_covered") else d2
        r = await c.post(f"/api/v1/jobs/{won['id']}/cancel", json={"cancellation_reason": "plans changed"})
        d = await mine()
        check("cancelling a covered job gives the call-out back", r.status_code == 200
              and d["membership"]["callouts_left"] == 1, f"HTTP {r.status_code} {d['membership']}")

        section("5. Revoke")
        current["i"] = as_ops
        r = await c.post(f"/api/v1/admin/users/{owner}/care/revoke", json={"reason": "left the pilot"})
        body = r.json().get("data") or {}
        check("ops ends it: 200, nothing in force, history keeps it", r.status_code == 200 and body.get("current") is None
              and len(body.get("history", [])) == 1 and body["history"][0]["revoke_reason"] == "left the pilot", r.text[:200])
        check("the revoke is audited", one("SELECT count(*) n FROM admin_audit_log WHERE action='care_revoked' "
                                           "AND target_id=%(u)s", {"u": owner})["n"] == 1)
        r = await c.post(f"/api/v1/admin/users/{owner}/care/revoke", json={"reason": "again"})
        check("revoking again is 409 CARE_NOT_ACTIVE", r.status_code == 409
              and r.json()["error"]["code"] == "CARE_NOT_ACTIVE", r.text[:160])
        current["i"] = as_owner
        check("the owner sees no membership", (await mine())["membership"] is None)
        r = await c.get(f"/api/v1/jobs/{covered[0]['id']}")
        check("jobs raised while covered stay covered", r.json()["data"].get("care_covered") is True)
        run("UPDATE jobs SET status='cancelled', cancelled_at=now(), cancellation_reason='qa' "
            "WHERE user_id=%(u)s AND status='scheduled'", {"u": owner})
        code, j = await book(6, "after revoke")
        check("a job after the revoke is not covered", code == 201 and j.get("care_covered") is False, str(j)[:160])

        section("6. Data export")
        r = await c.get("/api/v1/users/me/export")
        ex = r.json()["data"]
        check("the export lists the membership and marks covered jobs", len(ex.get("care_memberships", [])) == 1
              and any(x.get("care_covered") for x in ex["jobs"]), str(ex.get("care_memberships"))[:160])

    app.dependency_overrides.clear()
    await push_service.drain()

    section("7. Cleanup")
    purge()
    after = counts()
    check("every table is back to its baseline", after == baseline,
          str({k: (baseline[k], after[k]) for k in after if after[k] != baseline[k]}))

    passed = sum(_results)
    print("\n" + "=" * 70 + f"\n{passed}/{len(_results)} checks passed\n" + "=" * 70)
    sys.exit(0 if passed == len(_results) else 1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        try:
            purge()
        except Exception as exc:  # noqa: BLE001
            print(f"final purge failed: {exc}")
