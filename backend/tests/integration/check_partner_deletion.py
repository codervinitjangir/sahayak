"""Live check: partner account deletion and the shared-login rule (ADR-045).

    python tests/integration/check_partner_deletion.py

Real database and real storage, fakeredis for positions. No Supabase accounts:
identity is injected with dependency_overrides, and the Supabase admin delete is
replaced by a recorder, so what is checked is the decision (delete the login or
keep it) taken from the real tables.

Rows are scoped by phone +91900000082x and by the ids this run creates; a
deleted partner's phone is rewritten, so the purge also goes by id.
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

from app.config.redis_client import PARTNER_LOCATIONS_KEY, set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()
PHONE_PREFIX = "+91900000082"
TAG = "QA-PDEL"
conn = psycopg2.connect(S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
conn.autocommit = True
_results: list[bool] = []
CREATED_PARTNERS: list[str] = []
CREATED_USERS: list[str] = []


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
            ("partners", "users", "jobs", "job_assignments", "ratings", "notifications",
             "device_push_tokens", "partner_documents", "partner_equipment", "partner_services", "admin_audit_log")}


def purge():
    p = {"p": PHONE_PREFIX + "%", "tag": TAG + "%",
         "pids": CREATED_PARTNERS or [str(uuid.uuid4())], "uids": CREATED_USERS or [str(uuid.uuid4())]}
    pids = "(SELECT id FROM partners WHERE phone LIKE %(p)s OR id = ANY(%(pids)s::uuid[]))"
    uids = "(SELECT id FROM users WHERE phone LIKE %(p)s OR id = ANY(%(uids)s::uuid[]))"
    jobs = f"(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s OR user_id IN {uids})"
    q = conn.cursor()
    q.execute("BEGIN")
    q.execute("ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute(f"DELETE FROM admin_audit_log WHERE target_id IN {pids} OR target_id IN {uids} OR target_id IN {jobs}", p)
    q.execute("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("COMMIT")
    q.execute(f"DELETE FROM notifications WHERE recipient_id IN {pids} OR recipient_id IN {uids} OR job_id IN {jobs}", p)
    q.execute(f"DELETE FROM device_push_tokens WHERE owner_id IN {pids} OR owner_id IN {uids}", p)
    q.execute(f"DELETE FROM ratings WHERE job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_status_history WHERE job_id IN {jobs}", p)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN {jobs} OR partner_id IN {pids}", p)
    q.execute(f"DELETE FROM jobs WHERE id IN {jobs}", p)
    q.execute(f"DELETE FROM vehicles WHERE user_id IN {uids}", p)
    q.execute(f"DELETE FROM partners WHERE id IN {pids}", p)
    q.execute(f"DELETE FROM users WHERE id IN {uids}", p)


def new_partner(n, auth=None, name=None):
    pid = str(one("INSERT INTO partners (name, phone, verification_status, is_available, auth_user_id) "
                  "VALUES (%(n)s, %(p)s, 'verified', true, %(a)s) RETURNING id",
                  {"n": name or f"PDel QA {n}", "p": PHONE_PREFIX + str(n), "a": auth})["id"])
    CREATED_PARTNERS.append(pid)
    return pid


def new_owner(n, auth):
    uid = str(one("INSERT INTO users (name, phone, auth_user_id) VALUES (%(n)s, %(p)s, %(a)s) RETURNING id",
                  {"n": f"PDel QA owner {n}", "p": PHONE_PREFIX + str(n), "a": auth})["id"])
    CREATED_USERS.append(uid)
    return uid


def new_job(owner, status, partner=None, a_status=None):
    sid = one("SELECT id FROM services WHERE code = 'battery_jumpstart'")["id"]
    jid = str(one("INSERT INTO jobs (user_id, vehicle_number, service_id, status, pickup_location, issue_description) "
                  "VALUES (%(u)s, 'QA82PD0001', %(s)s, %(st)s, "
                  "ST_SetSRID(ST_MakePoint(72.56, 23.03), 4326)::geography, %(d)s) RETURNING id",
                  {"u": owner, "s": sid, "st": status, "d": f"{TAG} {status}"})["id"])
    if partner:
        run("INSERT INTO job_assignments (job_id, partner_id, status, assignment_rank, accepted_at) "
            "VALUES (%(j)s, %(p)s, %(s)s, 1, CASE WHEN %(s)s = 'offered' THEN NULL ELSE now() END)",
            {"j": jid, "p": partner, "s": a_status})
    return jid


async def main():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    set_redis_client(redis)
    from app.main import app
    from app.services import auth_service
    from app.services.auth_service import Identity
    from app.utils.auth import get_current_identity

    purge()
    baseline = counts()
    print(f"baseline: {baseline}")

    login_deletes: list = []

    async def record_delete(auth_user_id):
        login_deletes.append(str(auth_user_id))
        return True
    auth_service.delete_supabase_user = record_delete

    admin_id = one("SELECT id FROM admins ORDER BY name LIMIT 1")["id"]
    shared_auth, solo_auth = str(uuid.uuid4()), str(uuid.uuid4())
    owner = new_owner(0, shared_auth)                 # owner + partner on one login (ADR-034)
    dual = new_partner(1, shared_auth, "PDel QA dual")
    solo = new_partner(2, solo_auth)
    busy = new_partner(3, str(uuid.uuid4()))

    current = {"i": None}
    app.dependency_overrides[get_current_identity] = lambda: current["i"]

    def as_partner(pid, auth):
        current["i"] = Identity(auth_user_id=uuid.UUID(auth), role="partner", local_id=uuid.UUID(pid))

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pdel.test", timeout=60) as c:
        section("1. Refused while an owner is waiting")
        busy_auth = one("SELECT auth_user_id::text a FROM partners WHERE id=%(p)s", {"p": busy})["a"]
        as_partner(busy, busy_auth)
        offered = new_job(owner, "matching", busy, "offered")
        r = await c.delete("/api/v1/partners/me")
        check("an open offer is 409 ACCOUNT_HAS_ACTIVE_JOB", r.status_code == 409
              and r.json()["error"]["code"] == "ACCOUNT_HAS_ACTIVE_JOB", f"HTTP {r.status_code} {r.text[:120]}")
        run("UPDATE job_assignments SET status='timed_out' WHERE job_id=%(j)s", {"j": offered})
        run("UPDATE jobs SET status='cancelled', cancelled_at=now() WHERE id=%(j)s", {"j": offered})
        live = new_job(owner, "partner_en_route", busy, "accepted")
        r = await c.delete("/api/v1/partners/me")
        check("an accepted job en route is 409", r.status_code == 409, f"HTTP {r.status_code}")
        row = one("SELECT name, auth_user_id, deleted_at FROM partners WHERE id=%(p)s", {"p": busy})
        check("the refused deletion changed nothing", row["name"] == "PDel QA 3" and row["auth_user_id"]
              and row["deleted_at"] is None, str(row))
        run("UPDATE jobs SET status='completed', completed_at=now() WHERE id=%(j)s", {"j": live})
        run("UPDATE job_assignments SET status='completed' WHERE job_id=%(j)s", {"j": live})
        r = await c.delete("/api/v1/partners/me")
        check("once the job is completed the deletion goes through", r.status_code == 200
              and r.json()["data"] == {"deleted": True}, f"HTTP {r.status_code} {r.text[:120]}")

        section("2. Everything personal goes; the history the owner keeps stays")
        sid = one("SELECT id FROM services WHERE code = 'battery_jumpstart'")["id"]
        run("INSERT INTO partner_services (partner_id, service_id) VALUES (%(p)s, %(s)s)", {"p": dual, "s": sid})
        run("INSERT INTO partner_equipment (partner_id, equipment_type, registration_number) "
            "VALUES (%(p)s, 'flatbed', 'QA82TOW1')", {"p": dual})
        run("INSERT INTO partner_documents (partner_id, doc_type, file_url, status, content_type) "
            "VALUES (%(p)s, 'photo_id', %(f)s, 'approved', 'image/png')",
            {"p": dual, "f": f"{dual}/qa-never-uploaded.png"})
        run("INSERT INTO notifications (recipient_type, recipient_id, channel, message, event) "
            "VALUES ('partner', %(p)s, 'in_app', 'QA', 'document_expiring')", {"p": dual})
        run("INSERT INTO device_push_tokens (owner_type, owner_id, token) VALUES ('partner', %(p)s, %(t)s)",
            {"p": dual, "t": f"ExponentPushToken[{TAG}-{uuid.uuid4().hex[:8]}]"})
        done = new_job(owner, "completed", dual, "completed")
        run("INSERT INTO ratings (job_id, rated_by, rating, comment) VALUES "
            "(%(j)s, 'partner', 4, 'QA partner words'), (%(j)s, 'user', 5, 'QA owner words')", {"j": done})
        await redis.geoadd(PARTNER_LOCATIONS_KEY, (72.56, 23.03, dual))

        section("2a. Before deleting: the partner can download everything (DPDP access)")
        as_partner(dual, shared_auth)
        r = await c.get("/api/v1/partners/me/export")
        ex = r.json().get("data") or {}
        check("GET /partners/me/export is 200 under asyncpg", r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}")
        check("profile, services and equipment are in it",
              ex.get("profile", {}).get("phone") == PHONE_PREFIX + "1"
              and [x["code"] for x in ex.get("services", [])] == ["battery_jumpstart"]
              and ex.get("equipment", [{}])[0].get("registration_number") == "QA82TOW1", str(ex)[:200])
        check("documents are listed without their storage path",
              ex.get("documents", [{}])[0].get("type") == "photo_id" and "qa-never-uploaded" not in r.text, r.text[:200])
        jobs = {j["job_id"]: j for j in ex.get("jobs", [])}
        check("the completed job has the partner's own rating and not the owner's (ADR-053)",
              done in jobs and {x["by"] for x in jobs[done]["ratings"]} == {"you"}, str(jobs.get(done))[:200])
        check("the owner's number is not in the partner's export",
              PHONE_PREFIX + "0" not in r.text and "PDel QA owner" not in r.text)
        check("the alert notification is there", any(n["event"] == "document_expiring" for n in ex.get("notifications", [])))
        current["i"] = Identity(auth_user_id=uuid.UUID(shared_auth), role="user", local_id=uuid.UUID(owner))
        r = await c.get("/api/v1/partners/me/export")
        check("an owner identity cannot call the partner export (403)", r.status_code == 403, f"HTTP {r.status_code}")

        section("2b. Staff alerts run end to end against the real tables (ADR-047)")
        from types import SimpleNamespace
        from app.config.database import AsyncSessionLocal
        from app.services import staff_alert_service
        posted: list = []

        async def fake_post(url, text):
            posted.append(text)
            return True
        real_post, real_settings = staff_alert_service._post, staff_alert_service.get_settings
        staff_alert_service._post = fake_post
        staff_alert_service.get_settings = lambda: SimpleNamespace(
            STAFF_ALERT_WEBHOOK_URL="https://hooks.example/qa", STAFF_ALERT_REPEAT_MIN=60)
        staff_alert_service._last_check = None
        try:
            out = await staff_alert_service.check(AsyncSessionLocal)
        finally:
            staff_alert_service._post, staff_alert_service.get_settings = real_post, real_settings
            staff_alert_service._last_check = None
        check("the check reads /admin/alerts data and decides what to send", isinstance(out, dict), str(out))
        check("every message sent is about a critical alert and names nobody",
              all(t.startswith("Sahayak alert") and PHONE_PREFIX not in t for t in posted), str(posted))

        as_partner(dual, shared_auth)
        r = await c.delete("/api/v1/partners/me")
        check("the dual-profile partner deletes their partner account (200)", r.status_code == 200,
              f"HTTP {r.status_code} {r.text[:160]}")
        row = one("SELECT name, phone, auth_user_id, is_available, verification_status, verification_note, deleted_at "
                  "FROM partners WHERE id=%(p)s", {"p": dual})
        check("the row is anonymised", row["name"] == "Deleted partner" and row["phone"].startswith("del")
              and row["auth_user_id"] is None and row["is_available"] is False
              and row["verification_status"] == "suspended" and row["deleted_at"] is not None, str(row))
        left = one("SELECT (SELECT count(*) FROM partner_services WHERE partner_id=%(p)s) s, "
                   "(SELECT count(*) FROM partner_equipment WHERE partner_id=%(p)s) e, "
                   "(SELECT count(*) FROM partner_documents WHERE partner_id=%(p)s) d, "
                   "(SELECT count(*) FROM notifications WHERE recipient_id=%(p)s) n, "
                   "(SELECT count(*) FROM device_push_tokens WHERE owner_id=%(p)s) t", {"p": dual})
        check("services, equipment, documents, notifications and push tokens are gone",
              all(v == 0 for v in left.values()), str(left))
        rt = {b: one("SELECT rating, comment FROM ratings WHERE job_id=%(j)s AND rated_by=%(b)s",
                     {"j": done, "b": b}) for b in ("partner", "user")}
        check("the partner's own words are erased, the score kept",
              rt["partner"]["comment"] is None and rt["partner"]["rating"] == 4, str(rt["partner"]))
        check("what the owner wrote is untouched", rt["user"]["comment"] == "QA owner words", str(rt["user"]))
        kept = one("SELECT (SELECT count(*) FROM jobs WHERE id=%(j)s) j, "
                   "(SELECT count(*) FROM job_assignments WHERE job_id=%(j)s AND partner_id=%(p)s) a",
                   {"j": done, "p": dual})
        check("the job and the assignment stay for the owner's history", kept["j"] == 1 and kept["a"] == 1, str(kept))
        check("the live position is dropped", await redis.geopos(PARTNER_LOCATIONS_KEY, dual) == [None])
        check("the login was KEPT: the owner profile still signs in with it", shared_auth not in login_deletes,
              str(login_deletes))
        o = one("SELECT auth_user_id::text a, deleted_at FROM users WHERE id=%(u)s", {"u": owner})
        check("the owner profile is untouched", o["a"] == shared_auth and o["deleted_at"] is None, str(o))

        section("3. A partner-only login is deleted")
        as_partner(solo, solo_auth)
        r = await c.delete("/api/v1/partners/me")
        check("deleted (200)", r.status_code == 200, f"HTTP {r.status_code}")
        check("and the Supabase login with it", login_deletes.count(solo_auth) == 1, str(login_deletes))
        check("so was the first partner's (section 1)", login_deletes.count(busy_auth) == 1, str(login_deletes))

        section("4. Staff cannot bring a deleted partner back")
        current["i"] = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)),
                                admin_role="super_admin")
        r = await c.patch(f"/api/v1/admin/partners/{dual}/verify", json={"verification_status": "pending"})
        check("verify on a deleted partner is 409 PARTNER_ACCOUNT_DELETED", r.status_code == 409
              and r.json()["error"]["code"] == "PARTNER_ACCOUNT_DELETED", f"HTTP {r.status_code} {r.text[:120]}")

        section("5. The owner side of the same rule")
        auth3 = str(uuid.uuid4())
        owner3 = new_owner(5, auth3)
        partner3 = new_partner(6, auth3)
        current["i"] = Identity(auth_user_id=uuid.UUID(auth3), role="user", local_id=uuid.UUID(owner3))
        r = await c.delete("/api/v1/users/me")
        check("an owner who is also a partner deletes the owner account (200)", r.status_code == 200,
              f"HTTP {r.status_code} {r.text[:120]}")
        check("the login is kept for the partner profile", auth3 not in login_deletes, str(login_deletes))
        p3 = one("SELECT auth_user_id::text a, deleted_at FROM partners WHERE id=%(p)s", {"p": partner3})
        check("the partner profile still holds the login", p3["a"] == auth3 and p3["deleted_at"] is None, str(p3))
        current["i"] = Identity(auth_user_id=uuid.UUID(shared_auth), role="user", local_id=uuid.UUID(owner))
        r = await c.delete("/api/v1/users/me")
        check("the first owner, whose partner side is already gone, deletes too (200)", r.status_code == 200,
              f"HTTP {r.status_code} {r.text[:120]}")
        check("now nobody uses that login, so it is deleted", login_deletes.count(shared_auth) == 1, str(login_deletes))

    app.dependency_overrides.clear()

    section("6. Cleanup")
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
