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
          "notifications", "admin_audit_log")

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
    q.execute(f"DELETE FROM admin_audit_log WHERE target_id IN {job_ids} OR target_id IN {user_ids} "
              f"OR target_id IN {partner_ids}", params)
    q.execute("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("COMMIT")
    q.execute(f"DELETE FROM notifications WHERE job_id IN {job_ids}", params)
    q.execute(f"DELETE FROM job_status_history WHERE job_id IN {job_ids}", params)
    q.execute(f"DELETE FROM job_assignments WHERE job_id IN {job_ids}", params)
    q.execute("DELETE FROM jobs WHERE issue_description LIKE %(tag)s", params)
    q.execute("DELETE FROM partners WHERE phone LIKE %(p)s", params)
    q.execute("DELETE FROM users WHERE phone LIKE %(p)s", params)
    if DELETED_OWNERS:
        q.execute("DELETE FROM users WHERE id = ANY(%(ids)s::uuid[])", {"ids": [str(i) for i in DELETED_OWNERS]})


async def main():
    global _cleaned
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    from app.main import app
    from app.config.database import AsyncSessionLocal
    from app.services import auth_service
    from app.services.auth_service import Identity, TokenClaims
    from app.utils.auth import get_current_identity
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
    as_admin = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)))
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

        section("2. Staff cancel: one commit with history, notification and audit")
        current["identity"] = as_admin
        r = await c.post(f"/api/v1/admin/jobs/{job_id}/cancel", json={"reason": "owner called, duplicate"})
        check("staff cancel -> 200 cancelled", r.status_code == 200
              and (r.json().get("data") or {}).get("status") == "cancelled", f"HTTP {r.status_code} {r.text[:160]}")
        h = one("SELECT note FROM job_status_history WHERE job_id=%(i)s AND status='cancelled'", {"i": job_id})
        check("history row names support", h is not None and h["note"].startswith("Cancelled by support"), f"{h}")
        n = one("SELECT event FROM notifications WHERE job_id=%(i)s AND event='job_cancelled_by_support'", {"i": job_id})
        check("owner is notified it was support", n is not None)
        a = one("SELECT admin_id, action, reason, details FROM admin_audit_log WHERE target_id=%(i)s", {"i": job_id})
        check("audit row with admin, reason and from_status", a is not None and str(a["admin_id"]) == str(admin_id)
              and a["action"] == "job_cancelled" and a["details"]["from_status"] == "no_match_found", f"{a}")
        r = await c.post(f"/api/v1/admin/jobs/{job_id}/cancel", json={"reason": "again"})
        check("cancelling it again is 409 JOB_ALREADY_TERMINAL", r.status_code == 409
              and r.json()["error"]["code"] == "JOB_ALREADY_TERMINAL", f"HTTP {r.status_code}")

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
        check("owner list finds them with job_count 1", r.status_code == 200 and d.get("items")
              and d["items"][0]["job_count"] == 1 and d["items"][0]["suspended_at"] is None, f"{d}")

        section("5. Partner verification is audited")
        r = await c.patch(f"/api/v1/admin/partners/{partner}/verify", json={"verification_status": "verified"})
        a = one("SELECT action, details FROM admin_audit_log WHERE target_id=%(i)s", {"i": partner})
        check("verify writes partner_verified with from_status", r.status_code == 200 and a is not None
              and a["action"] == "partner_verified" and a["details"]["from_status"] == "pending", f"HTTP {r.status_code} {a}")
        r = await c.get("/api/v1/admin/audit-log", params={"target_type": "user", "target_id": str(owner)})
        d = r.json().get("data") or {}
        check("audit-log endpoint filters by target", r.status_code == 200
              and [i["action"] for i in d.get("items", [])] == ["user_reinstated", "user_suspended"], f"{d.get('items')}")

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
