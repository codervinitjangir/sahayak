"""Live check: the admin back office (ADR-024) against the real database.

Run it directly — it needs no server process and **no Supabase accounts**:

    python tests/integration/check_admin_ops.py

Identity is injected with FastAPI's dependency_overrides rather than a real
token, because what is under test here is the SQL (asyncpg PREPAREs every
statement, so an ORM query that works on psycopg2 can still fail live), the
locking, the append-only trigger and the one-commit pairing of a staff action
with its audit row — not token verification, which check_auth_flow covers.
Suspension *is* checked end to end through auth_service.resolve_identity
against the real users row.

Rows are QA-scoped by phone +91900000087x and the tag ADMOPS-QA. Audit rows are
append-only by trigger, so cleanup disables that trigger for its own DELETE and
re-enables it in the same transaction.
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
PHONE_PREFIX = "+91900000087"
OWNER_PHONE = PHONE_PREFIX + "1"
PARTNER_PHONE = PHONE_PREFIX + "2"
TAG = "ADMOPS-QA"
TABLES = ("users", "partners", "jobs", "job_status_history", "job_assignments",
          "notifications", "admin_audit_log", "device_push_tokens")

conn = psycopg2.connect(S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
conn.autocommit = True
_results: list[tuple[bool, str, str]] = []
_cleaned = False
# Owners whose phone the run rewrites (account deletion), purged by id.
DELETED_OWNERS: list = []


def check(label, ok, detail=""):
    _results.append((bool(ok), label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))


def section(t):
    print(f"\n{t}\n" + "-" * len(t))


def rows(sql, params=None):
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql, params=None):
    r = rows(sql, params)
    return r[0] if r else None


def counts():
    q = conn.cursor()
    out = {}
    for t in TABLES:
        q.execute(f"SELECT count(*) FROM {t}")
        out[t] = q.fetchone()[0]
    return out


ORIGINAL_PRICES: dict = {}


def purge():
    q = conn.cursor()
    if DELETED_OWNERS:
        # Deletion erased issue_description, so these jobs are found by owner.
        q.execute("UPDATE jobs SET issue_description = %(tag)s WHERE user_id = ANY(%(ids)s::uuid[])",
                  {"tag": TAG + " deleted-owner", "ids": [str(i) for i in DELETED_OWNERS]})
    job_ids = "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)"
    user_ids = "(SELECT id FROM users WHERE phone LIKE %(p)s)"
    partner_ids = "(SELECT id FROM partners WHERE phone LIKE %(p)s)"
    params = {"tag": TAG + "%", "p": PHONE_PREFIX + "%"}
    q.execute("BEGIN")
    q.execute("ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("DELETE FROM admin_audit_log WHERE target_type = 'admin' AND (target_id IN "
              "(SELECT id FROM admins WHERE phone LIKE %(p)s) OR target_id IN "
              "(SELECT id FROM admin_invites WHERE phone LIKE %(p)s))", params)
    q.execute(f"DELETE FROM admin_audit_log WHERE target_id IN {job_ids} OR target_id IN {user_ids} "
              f"OR target_id IN {partner_ids} OR (target_type = 'service' AND reason LIKE %(tag)s)", params)
    # Section 5c changes a price; put back whatever it replaced, even after a crash.
    for code, price in ORIGINAL_PRICES.items():
        q.execute("UPDATE services SET base_price = %(p)s WHERE code = %(c)s", {"p": price, "c": code})
    q.execute("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("COMMIT")
    q.execute(f"DELETE FROM device_push_tokens WHERE owner_id IN {user_ids} OR owner_id IN {partner_ids}"
              + (" OR owner_id = ANY(%(ids)s::uuid[])" if DELETED_OWNERS else ""),
              {**params, "ids": [str(i) for i in DELETED_OWNERS]})
    q.execute(f"DELETE FROM notifications WHERE job_id IN {job_ids}", params)
    q.execute(f"DELETE FROM job_status_history WHERE job_id IN {job_ids}", params)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN {job_ids}", params)
    q.execute("DELETE FROM jobs WHERE issue_description LIKE %(tag)s", params)
    q.execute("DELETE FROM partners WHERE phone LIKE %(p)s", params)
    q.execute("DELETE FROM users WHERE phone LIKE %(p)s", params)
    q.execute("DELETE FROM admin_invites WHERE phone LIKE %(p)s", params)
    q.execute("DELETE FROM admins WHERE phone LIKE %(p)s", params)
    if DELETED_OWNERS:
        q.execute("DELETE FROM users WHERE id = ANY(%(ids)s::uuid[])", {"ids": [str(i) for i in DELETED_OWNERS]})


async def main():
    global _cleaned
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    from app.main import app
    from app.config.database import AsyncSessionLocal
    from app.services import auth_service
    from app.services.auth_service import Identity, TokenClaims
    from app.utils.auth import get_current_identity, get_token_claims
    from app.utils.errors import ForbiddenError

    purge()
    baseline = counts()
    print(f"baseline: {baseline}")

    admin_id = one("SELECT id FROM admins ORDER BY name LIMIT 1")["id"]
    owner_auth = uuid.uuid4()
    owner = one("INSERT INTO users (name, phone, auth_user_id) VALUES ('Admin QA owner', %(p)s, %(a)s) "
                "RETURNING id", {"p": OWNER_PHONE, "a": str(owner_auth)})["id"]
    vehicle = one("INSERT INTO vehicles (user_id, vehicle_type, vehicle_number) VALUES "
                  "(%(u)s, 'four_wheeler', 'QA87ADM0001') RETURNING id", {"u": owner})["id"]
    partner = one("INSERT INTO partners (name, phone, verification_status) VALUES "
                  "('Admin QA partner', %(p)s, 'pending') RETURNING id", {"p": PARTNER_PHONE})["id"]

    current = {"identity": None}
    app.dependency_overrides[get_current_identity] = lambda: current["identity"]
    as_admin = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)),
                        admin_role="super_admin")
    as_owner = Identity(auth_user_id=owner_auth, role="user", local_id=uuid.UUID(str(owner)))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://admops.test", timeout=60) as c:
        section("1. A job that found nobody shows on the live board")
        current["identity"] = as_owner
        r = await c.post("/api/v1/jobs", json={
            "service_code": "battery_jumpstart", "pickup_lat": 23.03, "pickup_lng": 72.56,
            "pickup_address_text": "Admin QA pickup", "issue_description": f"{TAG} board",
            "vehicle_id": str(vehicle),
        })
        check("owner creates a job", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}")
        job_id = (r.json().get("data") or {}).get("id")

        current["identity"] = as_admin
        r = await c.get("/api/v1/admin/jobs", params={"q": "Admin QA owner"})
        d = r.json().get("data") or {}
        item = next((i for i in d.get("items", []) if i["id"] == job_id), None)
        check("board finds it by owner name, with owner phone", r.status_code == 200 and item is not None
              and item["owner_phone"] == OWNER_PHONE and item["status"] == "no_match_found",
              f"HTTP {r.status_code} {item}")
        r = await c.get("/api/v1/admin/jobs", params={"status": "bogus"})
        check("an unknown status filter is 400", r.status_code == 400, f"HTTP {r.status_code}")
        current["identity"] = as_owner
        r = await c.get("/api/v1/admin/jobs")
        check("an owner cannot read the board", r.status_code == 403, f"HTTP {r.status_code}")

        section("1a. Zone supply gap (ADR-048) under asyncpg")
        from datetime import datetime as _dt, timezone as _tz
        from app.services import admin_ops_service
        async with AsyncSessionLocal() as db:
            zone = await admin_ops_service.zone_alert(db, _dt.now(_tz.utc), partners_on_duty=1)
        cell = admin_ops_service._centre(admin_ops_service._cell(23.03, 72.56))
        hit = next((z for z in (zone.zones if zone else []) if (z.latitude, z.longitude) == cell), None)
        check("the area of the job that found nobody is reported, by its cell centre",
              hit is not None and hit.no_match >= 1 and hit.partners_nearby == 0, f"{zone}")
        current["identity"] = as_admin
        r = await c.get("/api/v1/admin/alerts")
        check("GET /admin/alerts is still 200 with the zone check in it", r.status_code == 200,
              f"HTTP {r.status_code} {r.text[:160]}")

        section("1b. Device push tokens (ADR-026)")
        from app.services import push_service
        sent: list = []

        async def fake_send(messages):
            sent.extend(messages)
            return []
        push_service._send = fake_send
        TOKEN = "ExponentPushToken[admopsQA87xxxxxx]"
        current["identity"] = as_owner
        r = await c.post("/api/v1/devices/push-token", json={"token": TOKEN, "platform": "android"})
        check("owner registers a push token", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")
        r = await c.post("/api/v1/devices/push-token", json={"token": "not-a-token"})
        check("a malformed token is 422", r.status_code == 422, f"HTTP {r.status_code}")
        current["identity"] = as_admin
        r = await c.post("/api/v1/devices/push-token", json={"token": TOKEN})
        check("an admin cannot register a device (403)", r.status_code == 403, f"HTTP {r.status_code}")
        check("token row stored once", one("SELECT count(*) AS n FROM device_push_tokens WHERE token=%(t)s",
                                          {"t": TOKEN})["n"] == 1)

        # A rolled-back transaction must not push.
        from app.services import notification_service as ns
        async with AsyncSessionLocal() as db:
            await ns._write_notification(db, recipient_type="user", recipient_id=uuid.UUID(str(owner)),
                                         event="job_completed", message="rollback probe", job_id=None, channel="in_app")
            await db.rollback()
        await asyncio.sleep(1.0)
        check("a rolled-back notification sends no push", not any(m["body"] == "rollback probe" for m in sent), f"{sent}")

        section("2. Staff cancel: one commit with history, notification and audit")
        current["identity"] = as_admin
        r = await c.post(f"/api/v1/admin/jobs/{job_id}/cancel", json={"reason": "owner called, duplicate"})
        check("staff cancel -> 200 cancelled", r.status_code == 200
              and (r.json().get("data") or {}).get("status") == "cancelled", f"HTTP {r.status_code} {r.text[:160]}")
        h = one("SELECT note FROM job_status_history WHERE job_id=%(i)s AND status='cancelled'", {"i": job_id})
        check("history row names support", h is not None and h["note"].startswith("Cancelled by support"), f"{h}")
        n = one("SELECT event FROM notifications WHERE job_id=%(i)s AND event='job_cancelled_by_support'", {"i": job_id})
        check("owner is notified it was support", n is not None)
        for _ in range(20):
            if any(m["to"] == TOKEN for m in sent):
                break
            await asyncio.sleep(0.25)
        check("...and the push reached the owner's device after commit",
              any(m["to"] == TOKEN and m["body"] == "This job was cancelled by Sahayak support." for m in sent), f"{sent}")
        a = one("SELECT admin_id, action, reason, details FROM admin_audit_log WHERE target_id=%(i)s", {"i": job_id})
        check("audit row with admin, reason and from_status", a is not None and str(a["admin_id"]) == str(admin_id)
              and a["action"] == "job_cancelled" and a["details"]["from_status"] == "no_match_found", f"{a}")
        r = await c.post(f"/api/v1/admin/jobs/{job_id}/cancel", json={"reason": "again"})
        check("cancelling it again is 409 JOB_ALREADY_TERMINAL", r.status_code == 409
              and r.json()["error"]["code"] == "JOB_ALREADY_TERMINAL", f"HTTP {r.status_code}")

        section("2b. Manual reassign (ADR-030)")
        rj = one("INSERT INTO jobs (user_id, vehicle_id, vehicle_number, service_id, status, pickup_location, "
                 "pickup_address_text, issue_description, price_estimate) "
                 "SELECT user_id, vehicle_id, vehicle_number, service_id, 'assigned', pickup_location, "
                 "pickup_address_text, %(d)s, price_estimate FROM jobs WHERE id=%(i)s RETURNING id",
                 {"i": job_id, "d": TAG + " reassign"})["id"]
        q = conn.cursor()
        q.execute("INSERT INTO job_status_history (job_id, status, note) VALUES (%(j)s, 'assigned', 'QA setup')", {"j": rj})
        q.execute("INSERT INTO job_assignments (job_id, partner_id, status, assignment_rank) "
                  "VALUES (%(j)s, %(p)s, 'accepted', 1)", {"j": rj, "p": partner})
        r = await c.post(f"/api/v1/admin/jobs/{rj}/reassign", json={"reason": "partner unreachable"})
        st = (r.json().get("data") or {}).get("status")
        a_row = one("SELECT status FROM job_assignments WHERE job_id=%(j)s", {"j": rj})
        check("reassign releases the partner as 'cancelled', never 'rejected'", r.status_code == 200
              and a_row["status"] == "cancelled", f"HTTP {r.status_code} {a_row} {r.text[:160]}")
        hist = [h["status"] for h in rows("SELECT status FROM job_status_history WHERE job_id=%(j)s ORDER BY changed_at, id", {"j": rj})]
        check("the job went back to matching, then (nobody else nearby) to no_match_found, each with a history row",
              st == "no_match_found" and hist[-2:] == ["matching", "no_match_found"], f"status={st} history={hist}")
        n_offers = one("SELECT count(*) AS n FROM job_assignments WHERE job_id=%(j)s", {"j": rj})["n"]
        check("the released partner was not offered the job again", n_offers == 1, f"{n_offers} assignment rows")
        ev = {(n["recipient_type"], n["event"]) for n in rows(
            "SELECT recipient_type, event FROM notifications WHERE job_id=%(j)s", {"j": rj})}
        check("partner and owner are each told in their own words",
              ("partner", "job_reassigned_by_support") in ev and ("user", "job_reassigning") in ev, f"{ev}")
        a = one("SELECT action, details FROM admin_audit_log WHERE target_id=%(j)s", {"j": rj})
        check("audit row records who was released", a is not None and a["action"] == "job_reassigned"
              and a["details"]["released_partners"] == [str(partner)], f"{a}")
        r = await c.post(f"/api/v1/admin/jobs/{rj}/reassign", json={"reason": "again"})
        check("a job with nobody on it cannot be reassigned", r.status_code == 409
              and (r.json().get("error") or {}).get("code") == "JOB_NOT_REASSIGNABLE", f"HTTP {r.status_code}")

        section("2c. Reassign: who is responsible and who sees whom afterwards (ADR-030, ADR-017)")
        rj2 = one("INSERT INTO jobs (user_id, vehicle_id, vehicle_number, service_id, status, pickup_location, "
                  "pickup_address_text, issue_description, price_estimate) "
                  "SELECT user_id, vehicle_id, vehicle_number, service_id, 'matching', pickup_location, "
                  "pickup_address_text, %(d)s, price_estimate FROM jobs WHERE id=%(i)s RETURNING id",
                  {"i": job_id, "d": TAG + " reassign offered"})["id"]
        q.execute("INSERT INTO job_status_history (job_id, status, note) VALUES (%(j)s, 'matching', 'QA setup')", {"j": rj2})
        q.execute("INSERT INTO job_assignments (job_id, partner_id, status, assignment_rank) "
                  "VALUES (%(j)s, %(p)s, 'offered', 1)", {"j": rj2, "p": partner})
        as_partner_a = Identity(auth_user_id=uuid.uuid4(), role="partner", local_id=uuid.UUID(str(partner)))

        current["identity"] = as_partner_a
        r = await c.get(f"/api/v1/jobs/{rj2}")
        check("a partner who has only been offered the job is not given the owner's number or pickup point",
              r.status_code == 200 and OWNER_PHONE not in r.text and (r.json()["data"].get("pickup_lat") is None),
              f"HTTP {r.status_code} phone_in_body={OWNER_PHONE in r.text}")
        current["identity"] = as_owner
        r = await c.get(f"/api/v1/jobs/{rj2}")
        d = r.json().get("data") or {}
        check("the owner always sees their own pickup point, and no partner details while it is only an offer",
              d.get("pickup_lat") is not None and "Admin QA partner" not in r.text, f"pickup_lat={d.get('pickup_lat')}")

        current["identity"] = as_admin
        r = await c.post(f"/api/v1/admin/jobs/{rj2}/reassign", json={"reason": "offer not answered"})
        check("an unanswered offer can be withdrawn", r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}")
        hist2 = [h["status"] for h in rows("SELECT status FROM job_status_history WHERE job_id=%(j)s", {"j": rj2})]
        check("withdrawing an offer adds no 'matching' history row (the status did not change)",
              hist2.count("matching") == 1, f"{hist2}")
        current["identity"] = as_owner
        r = await c.get(f"/api/v1/jobs/{rj2}")
        check("the owner is not shown the partner whose offer was withdrawn",
              r.status_code == 200 and "Admin QA partner" not in r.text and PARTNER_PHONE not in r.text, f"HTTP {r.status_code}")

        # The next partner accepts. Set up by SQL: this harness has no second
        # partner with a live location, and the point is the lookup, not dispatch.
        partner_b = one("INSERT INTO partners (name, phone, verification_status) VALUES "
                        "('Admin QA partner B', %(p)s, 'verified') RETURNING id", {"p": PHONE_PREFIX + "3"})["id"]
        q.execute("INSERT INTO job_assignments (job_id, partner_id, status, assignment_rank, accepted_at) "
                  "VALUES (%(j)s, %(p)s, 'accepted', 2, now())", {"j": rj2, "p": partner_b})
        q.execute("UPDATE jobs SET status='assigned' WHERE id=%(j)s", {"j": rj2})
        q.execute("INSERT INTO job_status_history (job_id, status, note) VALUES (%(j)s, 'assigned', 'QA setup')", {"j": rj2})
        as_partner_b = Identity(auth_user_id=uuid.uuid4(), role="partner", local_id=uuid.UUID(str(partner_b)))
        current["identity"] = as_partner_a
        r = await c.post(f"/api/v1/jobs/{rj2}/status", json={"status": "partner_en_route"})
        check("the released partner cannot drive the job", r.status_code == 403, f"HTTP {r.status_code}")
        r = await c.get(f"/api/v1/jobs/{rj2}")
        check("the released partner no longer sees the owner's number", OWNER_PHONE not in r.text, "leaked")
        current["identity"] = as_partner_b
        r = await c.post(f"/api/v1/jobs/{rj2}/status", json={"status": "partner_en_route"})
        check("the partner who accepted after the reassign is the responsible one",
              r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}")
        r = await c.get(f"/api/v1/jobs/{rj2}")
        check("...and sees the owner's number, as an accepted partner does", OWNER_PHONE in r.text, "withheld")
        current["identity"] = as_admin

        section("3. The audit log is append-only at the database")
        q = conn.cursor()
        try:
            q.execute("UPDATE admin_audit_log SET reason='rewritten' WHERE target_id=%(i)s", {"i": job_id})
            check("UPDATE on an audit row is refused", False, "update succeeded")
        except psycopg2.Error as exc:
            check("UPDATE on an audit row is refused", "append-only" in str(exc), str(exc).splitlines()[0])

        section("4. Suspending an owner blocks their identity; reinstating restores it")
        r = await c.patch(f"/api/v1/admin/users/{owner}/suspension", json={"suspended": True, "reason": "abuse report"})
        d = r.json().get("data") or {}
        check("suspend -> 200 with suspended_at", r.status_code == 200 and d.get("suspended_at"), f"HTTP {r.status_code} {d}")
        claims = TokenClaims(auth_user_id=owner_auth)
        async with AsyncSessionLocal() as db:
            try:
                await auth_service.resolve_identity(db, claims)
                check("suspended owner's token resolves to 403 ACCOUNT_SUSPENDED", False, "resolved")
            except ForbiddenError as exc:
                check("suspended owner's token resolves to 403 ACCOUNT_SUSPENDED", exc.code == "ACCOUNT_SUSPENDED")
        r = await c.patch(f"/api/v1/admin/users/{owner}/suspension", json={"suspended": True, "reason": "dup"})
        n_audit = one("SELECT count(*) AS n FROM admin_audit_log WHERE target_id=%(i)s", {"i": owner})["n"]
        check("repeating the suspension writes no second audit row", r.status_code == 200 and n_audit == 1, f"{n_audit}")
        r = await c.patch(f"/api/v1/admin/users/{owner}/suspension", json={"suspended": False})
        async with AsyncSessionLocal() as db:
            ident = await auth_service.resolve_identity(db, claims)
        check("reinstated owner resolves again", r.status_code == 200 and ident.role == "user")
        r = await c.get("/api/v1/admin/users", params={"q": OWNER_PHONE})
        d = r.json().get("data") or {}
        check("owner list finds them with job_count 3 (board job + two reassign jobs)", r.status_code == 200 and d.get("items")
              and d["items"][0]["job_count"] == 3 and d["items"][0]["suspended_at"] is None, f"{d}")

        section("5. Partner verification is audited")
        r = await c.patch(f"/api/v1/admin/partners/{partner}/verify", json={"verification_status": "verified"})
        check("verify without approved documents is 409 PARTNER_DOCUMENTS_INCOMPLETE (ADR-038)",
              r.status_code == 409 and r.json()["error"]["code"] == "PARTNER_DOCUMENTS_INCOMPLETE",
              f"HTTP {r.status_code} {r.text[:120]}")
        for t in ("driving_licence", "photo_id"):
            one("INSERT INTO partner_documents (partner_id, doc_type, status, file_url, content_type) "
                "VALUES (%(p)s, %(t)s, 'approved', %(f)s, 'image/jpeg') RETURNING id",
                {"p": partner, "t": t, "f": f"{partner}/qa-{t}.jpg"})
        r = await c.patch(f"/api/v1/admin/partners/{partner}/verify", json={"verification_status": "verified"})
        a = one("SELECT action, details FROM admin_audit_log WHERE target_id=%(i)s", {"i": partner})
        check("verify writes partner_verified with from_status", r.status_code == 200 and a is not None
              and a["action"] == "partner_verified" and a["details"]["from_status"] == "pending", f"HTTP {r.status_code} {a}")
        r = await c.get("/api/v1/admin/audit-log", params={"target_type": "user", "target_id": str(owner)})
        d = r.json().get("data") or {}
        check("audit-log endpoint filters by target", r.status_code == 200
              and [i["action"] for i in d.get("items", [])] == ["user_reinstated", "user_suspended"], f"{d.get('items')}")

        section("5c. Catalogue pricing (ADR-028)")
        code = "flat_tyre"
        before = one("SELECT base_price FROM services WHERE code=%(c)s", {"c": code})["base_price"]
        ORIGINAL_PRICES[code] = before
        new_price = "412.50" if str(before) != "412.50" else "413.50"
        r = await c.patch(f"/api/v1/admin/services/{code}/price",
                          json={"base_price": new_price, "reason": TAG + " price test"})
        stored = one("SELECT base_price FROM services WHERE code=%(c)s", {"c": code})["base_price"]
        check("PATCH price is stored", r.status_code == 200 and str(stored) == new_price, f"HTTP {r.status_code} {stored}")
        a = one("SELECT admin_id, target_id, details FROM admin_audit_log WHERE target_type='service' "
                "AND reason=%(r)s", {"r": TAG + " price test"})
        check("audit row carries the code and both prices", a is not None and a["target_id"] is None
              and a["details"] == {"service_code": code, "from": str(before), "to": new_price}, f"{a}")
        r = await c.get("/api/v1/services")
        listed = {i["code"]: i["base_price"] for i in (r.json().get("data") or {}).get("items", [])}
        check("the public catalogue shows the new price", str(listed.get(code)) == new_price, f"{listed.get(code)}")
        r = await c.patch(f"/api/v1/admin/services/{code}/price", json={"base_price": "0", "reason": TAG + " zero"})
        check("a zero price is refused", r.status_code == 422, f"HTTP {r.status_code}")
        r = await c.patch("/api/v1/admin/services/no_such_service/price",
                          json={"base_price": "100", "reason": TAG + " missing"})
        check("an unknown service is 404", r.status_code == 404, f"HTTP {r.status_code}")
        r = await c.get("/api/v1/admin/audit-log", params={"target_type": "service"})
        check("audit-log lists service rows with a null target_id", r.status_code == 200
              and any(i["target_id"] is None for i in (r.json().get("data") or {}).get("items", [])), f"HTTP {r.status_code}")

        section("5d. Staff roles and invites (ADR-029)")
        staff_phone = PHONE_PREFIX + "8"
        sup = one("SELECT id FROM admins WHERE role='super_admin' AND auth_user_id IS NOT NULL "
                  "AND disabled_at IS NULL ORDER BY id LIMIT 1")
        if sup is None:
            print("      SKIP: no linked super admin in this database")
        else:
            as_super = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(sup["id"])),
                                admin_role="super_admin")
            as_ops = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)),
                              admin_role="ops")
            invite_body = {"name": "Staff QA", "phone": staff_phone, "role": "support"}

            current["identity"] = as_ops
            r = await c.post("/api/v1/admin/invites", json=invite_body)
            check("an ops admin cannot invite staff", r.status_code == 403, f"HTTP {r.status_code}")

            current["identity"] = as_super
            r = await c.post("/api/v1/admin/invites", json=invite_body)
            token = (r.json().get("data") or {}).get("token") or ""
            inv = one("SELECT token_hash, role FROM admin_invites WHERE phone=%(p)s AND revoked_at IS NULL", {"p": staff_phone})
            check("a super admin gets a token once; only its hash is stored", r.status_code == 201 and len(token) >= 40
                  and inv is not None and inv["token_hash"] != token and len(inv["token_hash"]) == 64, f"HTTP {r.status_code}")
            r2 = await c.post("/api/v1/admin/invites", json=invite_body)
            token2 = (r2.json().get("data") or {}).get("token") or ""
            n_open = one("SELECT count(*) AS n FROM admin_invites WHERE phone=%(p)s AND revoked_at IS NULL "
                         "AND accepted_at IS NULL", {"p": staff_phone})["n"]
            check("inviting again replaces the open invite", r2.status_code == 201 and n_open == 1 and token2 != token, f"{n_open}")

            staff_sub = uuid.uuid4()
            claims = {"value": TokenClaims(auth_user_id=staff_sub, phone="919000000879")}
            app.dependency_overrides[get_token_claims] = lambda: claims["value"]
            r = await c.post("/api/v1/admin/invites/accept", json={"token": token2})
            n = one("SELECT count(*) AS n FROM admins WHERE phone=%(p)s", {"p": staff_phone})["n"]
            check("the right token with someone else's number is 404 and creates nothing",
                  r.status_code == 404 and (r.json().get("error") or {}).get("code") == "INVITE_INVALID" and n == 0,
                  f"HTTP {r.status_code} admins={n}")
            claims["value"] = TokenClaims(auth_user_id=staff_sub, phone=staff_phone.lstrip("+"))
            r = await c.post("/api/v1/admin/invites/accept", json={"token": token})
            check("the replaced token no longer works", r.status_code == 404, f"HTTP {r.status_code}")
            r = await c.post("/api/v1/admin/invites/accept", json={"token": token2})
            row = one("SELECT id, role, auth_user_id, invited_by FROM admins WHERE phone=%(p)s", {"p": staff_phone})
            check("the matching verified number accepts and becomes a support admin", r.status_code == 200
                  and row is not None and row["role"] == "support" and str(row["auth_user_id"]) == str(staff_sub)
                  and str(row["invited_by"]) == str(sup["id"]), f"HTTP {r.status_code} {row}")
            claims["value"] = TokenClaims(auth_user_id=uuid.uuid4(), phone=staff_phone.lstrip("+"))
            r = await c.post("/api/v1/admin/invites/accept", json={"token": token2})
            n = one("SELECT count(*) AS n FROM admins WHERE phone=%(p)s", {"p": staff_phone})["n"]
            check("an invite is single-use", r.status_code == 404 and n == 1, f"HTTP {r.status_code} admins={n}")
            app.dependency_overrides.pop(get_token_claims, None)

            if row is not None:
                async with AsyncSessionLocal() as db:
                    resolved = await auth_service.resolve_identity(db, TokenClaims(auth_user_id=staff_sub))
                check("the new account resolves as an admin carrying its role",
                      resolved.role == "admin" and resolved.admin_role == "support", f"{resolved}")
                current["identity"] = resolved
                r = await c.patch(f"/api/v1/admin/partners/{partner}/verify", json={"verification_status": "verified"})
                check("support cannot verify partners", r.status_code == 403, f"HTTP {r.status_code}")
                r = await c.patch("/api/v1/admin/services/flat_tyre/price", json={"base_price": "1", "reason": TAG + " gate"})
                check("support cannot change prices", r.status_code == 403, f"HTTP {r.status_code}")
                r = await c.post(f"/api/v1/admin/jobs/{uuid.uuid4()}/cancel", json={"reason": TAG + " gate"})
                check("support passes the job-cancel gate (404 for an unknown job, not 403)", r.status_code == 404, f"HTTP {r.status_code}")
                r = await c.get("/api/v1/admin/staff")
                body = r.text
                check("every staff role can read the staff list, and it carries no token",
                      r.status_code == 200 and token2 not in body and "token" not in body, f"HTTP {r.status_code}")
                r = await c.patch(f"/api/v1/admin/staff/{sup['id']}", json={"disabled": True, "reason": TAG + " escalation"})
                check("support cannot switch off a super admin", r.status_code == 403, f"HTTP {r.status_code}")

                current["identity"] = as_super
                r = await c.patch(f"/api/v1/admin/staff/{sup['id']}", json={"role": "ops", "reason": TAG + " self"})
                check("a super admin cannot change their own account", r.status_code == 409
                      and (r.json().get("error") or {}).get("code") == "CANNOT_MODIFY_SELF", f"HTTP {r.status_code}")
                r = await c.patch(f"/api/v1/admin/staff/{row['id']}", json={"disabled": True, "reason": TAG + " left"})
                d = one("SELECT disabled_at FROM admins WHERE id=%(i)s", {"i": row["id"]})
                a = one("SELECT details FROM admin_audit_log WHERE target_id=%(i)s AND action='admin_updated'", {"i": row["id"]})
                check("switching access off is stored and audited", r.status_code == 200 and d["disabled_at"] is not None
                      and a is not None and a["details"]["disabled"] is True, f"HTTP {r.status_code} {a}")
                try:
                    async with AsyncSessionLocal() as db:
                        await auth_service.resolve_identity(db, TokenClaims(auth_user_id=staff_sub))
                    check("a switched-off staff account no longer resolves", False, "resolved")
                except ForbiddenError as exc:
                    check("a switched-off staff account no longer resolves", exc.code == "ACCOUNT_SUSPENDED", exc.code)
            current["identity"] = as_admin

        section("5b. Owner self-service: profile, export, deletion (ADR-025)")
        auth2 = uuid.uuid4()
        owner2 = one("INSERT INTO users (name, phone, email, auth_user_id) VALUES "
                     "('Self QA owner', %(p)s, 'selfqa@sahayak-admopsqa.invalid', %(a)s) RETURNING id",
                     {"p": PHONE_PREFIX + "3", "a": str(auth2)})["id"]
        DELETED_OWNERS.append(owner2)
        veh2 = one("INSERT INTO vehicles (user_id, vehicle_type, vehicle_number) VALUES "
                   "(%(u)s, 'two_wheeler', 'QA87SELF001') RETURNING id", {"u": owner2})["id"]
        current["identity"] = Identity(auth_user_id=auth2, role="user", local_id=uuid.UUID(str(owner2)))

        r = await c.patch("/api/v1/users/me", json={"name": "Self QA renamed"})
        check("PATCH /users/me renames", r.status_code == 200
              and (r.json().get("data") or {}).get("name") == "Self QA renamed", f"HTTP {r.status_code} {r.text[:120]}")
        r = await c.patch("/api/v1/users/me", json={"email": "selfqa@sahayak-admopsqa.invalid"})
        check("re-saving my own email is fine", r.status_code == 200, f"HTTP {r.status_code}")
        r = await c.patch("/api/v1/users/me", json={"phone": "+911"})
        check("phone is not editable (422)", r.status_code == 422, f"HTTP {r.status_code}")

        r = await c.post("/api/v1/jobs", json={
            "service_code": "battery_jumpstart", "pickup_lat": 23.03, "pickup_lng": 72.56,
            "pickup_address_text": "Self QA secret address", "issue_description": f"{TAG} self",
            "vehicle_id": str(veh2),
        })
        job2 = (r.json().get("data") or {}).get("id")
        r = await c.get("/api/v1/users/me/export")
        d = r.json().get("data") or {}
        check("export has profile, vehicle and the job with its timeline", r.status_code == 200
              and d.get("profile", {}).get("phone") == PHONE_PREFIX + "3" and len(d.get("vehicles", [])) == 1
              and any(j["id"] == job2 and j["timeline"] for j in d.get("jobs", [])), f"HTTP {r.status_code}")

        conn.cursor().execute("UPDATE jobs SET status='assigned' WHERE id=%(i)s", {"i": job2})
        r = await c.delete("/api/v1/users/me")
        check("delete refused while a job is live (409 ACCOUNT_HAS_ACTIVE_JOB)", r.status_code == 409
              and r.json()["error"]["code"] == "ACCOUNT_HAS_ACTIVE_JOB", f"HTTP {r.status_code}")
        conn.cursor().execute("UPDATE jobs SET status='completed', completed_at=now() WHERE id=%(i)s", {"i": job2})

        r = await c.delete("/api/v1/users/me")
        check("delete -> 200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}")
        u2 = one("SELECT name, phone, email, auth_user_id, deleted_at FROM users WHERE id=%(i)s", {"i": owner2})
        check("row anonymised: no name, phone, email or login", u2["name"] == "Deleted user"
              and u2["phone"].startswith("del") and u2["email"] is None and u2["auth_user_id"] is None
              and u2["deleted_at"] is not None, f"{u2}")
        j2 = one("SELECT pickup_address_text, issue_description, vehicle_id, vehicle_number FROM jobs WHERE id=%(i)s", {"i": job2})
        check("job kept, free text erased, plate snapshot kept", j2 is not None and j2["pickup_address_text"] is None
              and j2["issue_description"] is None and j2["vehicle_id"] is None and j2["vehicle_number"] == "QA87SELF001", f"{j2}")
        check("vehicles gone", one("SELECT count(*) AS n FROM vehicles WHERE user_id=%(i)s", {"i": owner2})["n"] == 0)
        async with AsyncSessionLocal() as db:
            try:
                await auth_service.resolve_identity(db, TokenClaims(auth_user_id=auth2))
                check("the old login resolves to nothing", False, "resolved")
            except ForbiddenError as exc:
                check("the old login resolves to nothing", exc.code in ("USER_NOT_REGISTERED", "IDENTITY_NOT_LINKED"), exc.code)

    app.dependency_overrides.clear()
    section("6. Cleanup")
    purge()
    _cleaned = True
    after = counts()
    check("every table is back to its baseline", after == baseline, f"{after}" if after != baseline else "unchanged")


def summarise():
    passed = sum(1 for ok, _, _ in _results if ok)
    failed = [(lbl, d) for ok, lbl, d in _results if not ok]
    print(f"\n{'=' * 70}\n{passed}/{len(_results)} checks passed")
    for lbl, d in failed:
        print(f"  - {lbl}" + (f"  ({d})" if d else ""))
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
            except Exception as exc:  # noqa: BLE001
                print(f"  ! cleanup failed: {type(exc).__name__}: {exc}")
    sys.exit(summarise())
