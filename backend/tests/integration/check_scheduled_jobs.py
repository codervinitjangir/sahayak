"""Live check: scheduled jobs (ADR-050).

    python tests/integration/check_scheduled_jobs.py

Real database (asyncpg through the app, psycopg2 for setup), fakeredis for
positions, identity by dependency_overrides. Rows are scoped by phone
+91900000083x and the tag below.
"""
import asyncio
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
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

from app.config.redis_client import PARTNER_LOCATIONS_KEY, location_updated_at_key, set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()
PHONE_PREFIX = "+91900000083"
TAG = "QA-SCHED"
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


def rows(sql, params=None):
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def run(sql, params=None):
    conn.cursor().execute(sql, params or {})


def counts():
    return {t: one(f"SELECT count(*) n FROM {t}")["n"] for t in
            ("partners", "users", "vehicles", "jobs", "job_assignments", "job_status_history",
             "notifications", "partner_services")}


def purge():
    p = {"p": PHONE_PREFIX + "%"}
    pids = "(SELECT id FROM partners WHERE phone LIKE %(p)s)"
    uids = "(SELECT id FROM users WHERE phone LIKE %(p)s)"
    jobs = f"(SELECT id FROM jobs WHERE user_id IN {uids})"
    q = conn.cursor()
    q.execute(f"DELETE FROM notifications WHERE recipient_id IN {pids} OR recipient_id IN {uids} OR job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_status_history WHERE job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN {jobs} OR partner_id IN {pids}", p)
    q.execute(f"DELETE FROM jobs WHERE id IN {jobs}", p)
    q.execute(f"DELETE FROM vehicles WHERE user_id IN {uids}", p)
    q.execute(f"DELETE FROM partner_services WHERE partner_id IN {pids}", p)
    q.execute(f"DELETE FROM partners WHERE id IN {pids}", p)
    q.execute(f"DELETE FROM users WHERE id IN {uids}", p)


async def main():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    set_redis_client(redis)
    from app.main import app
    from app.config.database import AsyncSessionLocal
    from app.repositories import dispatch_repository
    from app.services import push_service, schedule_service
    from app.services.auth_service import Identity
    from app.utils.auth import get_current_identity

    purge()
    baseline = counts()
    print(f"baseline: {baseline}")

    owner_auth, partner_auth = uuid.uuid4(), uuid.uuid4()
    owner = str(one("INSERT INTO users (name, phone, auth_user_id) VALUES ('Sched QA owner', %(p)s, %(a)s) RETURNING id",
                    {"p": PHONE_PREFIX + "0", "a": str(owner_auth)})["id"])
    vehicle = str(one("INSERT INTO vehicles (user_id, vehicle_type, vehicle_number) VALUES "
                      "(%(u)s, 'four_wheeler', 'QA83SCH0001') RETURNING id", {"u": owner})["id"])
    partner = str(one("INSERT INTO partners (name, phone, verification_status, is_available, auth_user_id) "
                      "VALUES ('Sched QA partner', %(p)s, 'verified', true, %(a)s) RETURNING id",
                      {"p": PHONE_PREFIX + "1", "a": str(partner_auth)})["id"])
    sid = one("SELECT id FROM services WHERE code = 'battery_jumpstart'")["id"]
    run("INSERT INTO partner_services (partner_id, service_id) VALUES (%(p)s, %(s)s)", {"p": partner, "s": sid})
    await redis.geoadd(PARTNER_LOCATIONS_KEY, (72.561, 23.031, partner))
    await redis.set(location_updated_at_key(partner), str(time.time()))

    as_owner = Identity(auth_user_id=owner_auth, role="user", local_id=uuid.UUID(owner))
    as_partner = Identity(auth_user_id=partner_auth, role="partner", local_id=uuid.UUID(partner))
    current = {"i": as_owner}
    app.dependency_overrides[get_current_identity] = lambda: current["i"]

    def body(slot, text="booking"):
        return {"vehicle_id": vehicle, "service_code": "battery_jumpstart", "pickup_lat": 23.03, "pickup_lng": 72.56,
                "pickup_address_text": "Sched QA pickup", "issue_description": f"{TAG} {text}", "scheduled_for": slot}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sched.test", timeout=60) as c:
        section("1. Slots on offer")
        r = await c.get("/api/v1/jobs/schedule-slots")
        d = r.json().get("data") or {}
        slots = d.get("slots", [])
        now = datetime.now(timezone.utc)
        first = datetime.fromisoformat(slots[0]["start"]) if slots else None
        check("GET /jobs/schedule-slots is 200 with slots", r.status_code == 200 and len(slots) > 30, f"HTTP {r.status_code}")
        check("the first slot is at least 2 hours away and every slot is 2 hours long",
              first is not None and first >= now + timedelta(hours=2) - timedelta(seconds=5)
              and all(datetime.fromisoformat(s["end"]) - datetime.fromisoformat(s["start"]) == timedelta(hours=2) for s in slots),
              str(slots[:2]))
        check("matching starts 45 minutes before a slot", d.get("release_lead_min") == 45, str(d.get("release_lead_min")))

        section("2. Booking a slot creates a waiting job and offers nobody")
        r = await c.post("/api/v1/jobs", json=body(slots[0]["start"], "main"))
        job = (r.json().get("data") or {})
        jid = job.get("id")
        check("POST /jobs with scheduled_for is 201 'scheduled'", r.status_code == 201 and job.get("status") == "scheduled",
              f"HTTP {r.status_code} {r.text[:200]}")
        check("the slot is echoed back", job.get("scheduled_for") and datetime.fromisoformat(job["scheduled_for"]) == first
              and datetime.fromisoformat(job["slot_end"]) == first + timedelta(hours=2), str(job)[:200])
        check("no partner was offered it", one("SELECT count(*) n FROM job_assignments WHERE job_id=%(j)s", {"j": jid})["n"] == 0)
        h = rows("SELECT status, note FROM job_status_history WHERE job_id=%(j)s ORDER BY changed_at", {"j": jid})
        check("the timeline opens with 'scheduled', 'Booked for ...'",
              len(h) == 1 and h[0]["status"] == "scheduled" and h[0]["note"].startswith("Booked for"), str(h))
        r = await c.post("/api/v1/jobs", json=body((now + timedelta(hours=1)).isoformat(), "too soon"))
        check("a slot under 2 hours away is 400 SLOT_NOT_AVAILABLE", r.status_code == 400
              and r.json()["error"]["code"] == "SLOT_NOT_AVAILABLE", f"HTTP {r.status_code} {r.text[:160]}")

        section("3. Reading and moving the booking")
        r = await c.get(f"/api/v1/jobs/{jid}")
        check("GET /jobs/{id} carries the slot", r.status_code == 200 and r.json()["data"].get("scheduled_for"), r.text[:160])
        r = await c.get("/api/v1/jobs")
        item = next((i for i in r.json()["data"]["items"] if i["id"] == jid), None)
        check("the owner's list shows it as scheduled with its slot", item and item["status"] == "scheduled"
              and item.get("scheduled_for"), str(item)[:200])
        r = await c.patch(f"/api/v1/jobs/{jid}/schedule", json={"scheduled_for": slots[2]["start"]})
        moved = (r.json().get("data") or {}).get("scheduled_for")
        check("PATCH /jobs/{id}/schedule moves it (200)", r.status_code == 200 and moved
              and datetime.fromisoformat(moved) == datetime.fromisoformat(slots[2]["start"]), f"HTTP {r.status_code} {r.text[:160]}")
        check("the move is in the timeline", one("SELECT count(*) n FROM job_status_history WHERE job_id=%(j)s "
                                                  "AND note LIKE 'Moved to %%'", {"j": jid})["n"] == 1)
        current["i"] = as_partner
        r = await c.patch(f"/api/v1/jobs/{jid}/schedule", json={"scheduled_for": slots[3]["start"]})
        check("a partner cannot move an owner's booking (403)", r.status_code == 403, f"HTTP {r.status_code}")
        current["i"] = as_owner

        section("4. At most three upcoming bookings; cancelling one is free")
        extra = []
        for k in (4, 5):
            r = await c.post("/api/v1/jobs", json=body(slots[k]["start"], f"extra {k}"))
            extra.append(r.json()["data"]["id"])
        r = await c.post("/api/v1/jobs", json=body(slots[6]["start"], "fourth"))
        check("a fourth upcoming booking is 409 TOO_MANY_SCHEDULED_JOBS", r.status_code == 409
              and r.json()["error"]["code"] == "TOO_MANY_SCHEDULED_JOBS", f"HTTP {r.status_code} {r.text[:160]}")
        r = await c.post(f"/api/v1/jobs/{extra[0]}/cancel", json={"cancellation_reason": "plans changed"})
        check("POST /jobs/{id}/cancel on a booking is 200 and it is cancelled",
              r.status_code == 200 and one("SELECT status FROM jobs WHERE id=%(j)s", {"j": extra[0]})["status"] == "cancelled",
              f"HTTP {r.status_code} {r.text[:160]}")

        section("5. The worker releases it near the slot, into ordinary matching")
        run("UPDATE jobs SET scheduled_for = now() + interval '30 minutes', slot_end = now() + interval '150 minutes' "
            "WHERE id=%(j)s", {"j": jid})
        async with AsyncSessionLocal() as db:
            due = await dispatch_repository.get_due_scheduled_job_ids(
                db, starts_before=datetime.now(timezone.utc) + schedule_service.RELEASE_LEAD)
        check("the due-bookings read finds it under asyncpg", uuid.UUID(jid) in due, str(due))
        check("a booking further out is not due", uuid.UUID(extra[1]) not in due)
        async with AsyncSessionLocal() as db:
            outcome = await schedule_service.release_scheduled_job(db, uuid.UUID(jid))
        await push_service.drain()
        st = one("SELECT status, requested_at FROM jobs WHERE id=%(j)s", {"j": jid})
        check("released: dispatch ran and the job is matching", outcome == "released" and st["status"] == "matching", f"{outcome} {st}")
        check("requested_at now means when matching started", abs((datetime.now(timezone.utc) - st["requested_at"]).total_seconds()) < 120,
              str(st["requested_at"]))
        offer = one("SELECT status FROM job_assignments WHERE job_id=%(j)s AND partner_id=%(p)s", {"j": jid, "p": partner})
        check("the nearby partner got an ordinary offer", offer and offer["status"] == "offered", str(offer))
        check("the owner was told matching started", one("SELECT count(*) n FROM notifications WHERE recipient_id=%(u)s "
                                                          "AND event='scheduled_job_starting'", {"u": owner})["n"] == 1)
        current["i"] = as_partner
        r = await c.get("/api/v1/partners/me/offers")
        o = next((x for x in (r.json().get("data") or []) if x.get("job_id") == jid), None)
        check("the partner's offer shows the slot", o and o["job"].get("scheduled_for") and o["job"].get("slot_end"), str(o)[:200])
        current["i"] = as_owner
        r = await c.patch(f"/api/v1/jobs/{jid}/schedule", json={"scheduled_for": slots[3]["start"]})
        check("once matching started it cannot be moved (409 JOB_NOT_SCHEDULED)", r.status_code == 409
              and r.json()["error"]["code"] == "JOB_NOT_SCHEDULED", f"HTTP {r.status_code} {r.text[:160]}")

        section("6. A slot that passed while the worker was down is cancelled, not dispatched")
        run("UPDATE jobs SET scheduled_for = now() - interval '3 hours', slot_end = now() - interval '1 hour' "
            "WHERE id=%(j)s", {"j": extra[1]})
        async with AsyncSessionLocal() as db:
            outcome = await schedule_service.release_scheduled_job(db, uuid.UUID(extra[1]))
        await push_service.drain()
        st = one("SELECT status, cancellation_reason FROM jobs WHERE id=%(j)s", {"j": extra[1]})
        check("missed: cancelled with a reason, nobody offered", outcome == "missed" and st["status"] == "cancelled"
              and "slot passed" in (st["cancellation_reason"] or "")
              and one("SELECT count(*) n FROM job_assignments WHERE job_id=%(j)s", {"j": extra[1]})["n"] == 0, f"{outcome} {st}")

        section("7. Staff board")
        from app.services import admin_ops_service
        async with AsyncSessionLocal() as db:
            out = await admin_ops_service.get_alerts(db)
        stuck = next((a for a in out.alerts if a.code == "STUCK_JOBS"), None)
        check("an accepted-early booking is not counted as stuck", not stuck or uuid.UUID(jid) not in stuck.job_ids)

    app.dependency_overrides.clear()
    await push_service.drain()

    section("8. Cleanup")
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
