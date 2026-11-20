"""Live check: partner documents (ADR-038) against the real database AND the real bucket.

    python tests/integration/check_partner_documents.py

Needs SUPABASE_URL + SUPABASE_SECRET_KEY (Storage) and DATABASE_URL. No Supabase
accounts: identity is injected with dependency_overrides, as in check_admin_ops.
What is under test is the SQL under asyncpg, the signed upload and view URLs
against the private bucket, replacement, the role gate, the verification gate,
tow equipment, and the retention sweep deleting files.

Rows are scoped by phone +91900000085x; every file lives under the QA partners'
own folders and is deleted at the end.
"""
import asyncio
import sys
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

from app.config.redis_client import set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()
PHONE_PREFIX = "+91900000085"
PNG = b"\x89PNG\r\n\x1a\n" + b"QA-DOC" * 10
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


async def purge_files():
    from app.utils import storage
    q = conn.cursor()
    q.execute("SELECT d.partner_id::text, d.id::text, d.file_url, d.content_type FROM partner_documents d "
              "JOIN partners p ON p.id = d.partner_id WHERE p.phone LIKE %(p)s", {"p": PHONE_PREFIX + "%"})
    from app.services.partner_document_service import object_path
    paths = [f or object_path(uuid.UUID(p), uuid.UUID(i), c or "image/jpeg") for p, i, f, c in q.fetchall()]
    await storage.delete_objects(paths + EXTRA_PATHS)


EXTRA_PATHS: list[str] = []


def purge_rows():
    q = conn.cursor()
    p = {"p": PHONE_PREFIX + "%"}
    q.execute("BEGIN")
    q.execute("ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("DELETE FROM admin_audit_log WHERE target_type='partner' AND target_id IN "
              "(SELECT id FROM partners WHERE phone LIKE %(p)s)", p)
    q.execute("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only")
    q.execute("COMMIT")
    q.execute("DELETE FROM partners WHERE phone LIKE %(p)s", p)   # documents, equipment, services cascade


async def main():
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    from app.config.database import AsyncSessionLocal
    from app.main import app
    from app.services import partner_document_service
    from app.services.auth_service import Identity
    from app.utils import storage
    from app.utils.auth import get_current_identity

    await purge_files()
    purge_rows()
    before = one("SELECT count(*) n FROM partner_documents")["n"]

    admin_id = one("SELECT id FROM admins ORDER BY name LIMIT 1")["id"]
    p1 = one("INSERT INTO partners (name, phone) VALUES ('Docs QA one', %(p)s) RETURNING id", {"p": PHONE_PREFIX + "1"})["id"]
    p2 = one("INSERT INTO partners (name, phone) VALUES ('Docs QA two', %(p)s) RETURNING id", {"p": PHONE_PREFIX + "2"})["id"]
    tow_service = one("SELECT id FROM services WHERE requires_vehicle_equipment ORDER BY id LIMIT 1")["id"]

    def partner(pid):
        return Identity(auth_user_id=uuid.uuid4(), role="partner", local_id=uuid.UUID(str(pid)))

    def staff(role):
        return Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=uuid.UUID(str(admin_id)), admin_role=role)

    current = {"i": None}
    app.dependency_overrides[get_current_identity] = lambda: current["i"]
    as_ = lambda ident: current.__setitem__("i", ident)  # noqa: E731

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://docs.test", timeout=60) as c, \
            httpx.AsyncClient(timeout=60) as raw:

        async def upload(doc_type, content_type="image/png", body=PNG, ref=None):
            payload = {"doc_type": doc_type, "content_type": content_type}
            if ref:
                payload["reference_number"] = ref
            r = await c.post("/api/v1/partners/me/documents", json=payload)
            assert r.status_code == 201, r.text
            t = r.json()["data"]
            put = await raw.put(t["upload_url"], content=body, headers={"Content-Type": content_type})
            return t["document_id"], put

        section("1. Checklist and refusals")
        as_(partner(p1))
        r = await c.get("/api/v1/partners/me/documents")
        d = r.json()["data"]
        check("a mechanic needs licence and photo ID, both missing", r.status_code == 200
              and d["required"] == ["driving_licence", "photo_id"]
              and [x["status"] for x in d["documents"]] == ["missing", "missing"] and d["complete"] is False, r.text[:200])
        r = await c.post("/api/v1/partners/me/documents", json={"doc_type": "tow_equipment_photo", "content_type": "image/png"})
        check("tow documents from a non-towing partner are 400 DOCUMENT_NOT_REQUIRED",
              r.status_code == 400 and r.json()["error"]["code"] == "DOCUMENT_NOT_REQUIRED", r.text[:120])
        r = await c.post("/api/v1/partners/me/documents", json={"doc_type": "photo_id", "content_type": "text/html"})
        check("a non-image, non-PDF type is 422", r.status_code == 422)
        as_(staff("super_admin"))
        r = await c.get("/api/v1/partners/me/documents")
        check("staff cannot use the partner endpoint (403)", r.status_code == 403, f"HTTP {r.status_code}")

        section("2. Upload, confirm, replace")
        as_(partner(p1))
        r = await c.post("/api/v1/partners/me/documents", json={"doc_type": "photo_id", "content_type": "image/png"})
        early = r.json()["data"]["document_id"]
        r = await c.post(f"/api/v1/partners/me/documents/{early}/confirm")
        check("confirming before the file arrives is 409 DOCUMENT_NOT_UPLOADED",
              r.status_code == 409 and r.json()["error"]["code"] == "DOCUMENT_NOT_UPLOADED", r.text[:120])
        lic, put = await upload("driving_licence")
        check("the signed URL accepts the file", put.status_code == 200, f"HTTP {put.status_code} {put.text[:100]}")
        as_(partner(p2))
        r = await c.post(f"/api/v1/partners/me/documents/{lic}/confirm")
        check("another partner confirming it is 404", r.status_code == 404, f"HTTP {r.status_code}")
        as_(partner(p1))
        r = await c.post(f"/api/v1/partners/me/documents/{lic}/confirm")
        d = r.json()["data"]
        check("confirm makes it pending review", r.status_code == 200
              and d["documents"][0]["status"] == "pending" and d["documents"][0]["document_id"] == lic, r.text[:200])
        r = await c.post(f"/api/v1/partners/me/documents/{lic}/confirm")
        check("confirming twice is harmless", r.status_code == 200)
        first_path = one("SELECT file_url FROM partner_documents WHERE id=%(i)s", {"i": lic})["file_url"]
        lic2, _ = await upload("driving_licence", "image/png", PNG + b"v2")
        await c.post(f"/api/v1/partners/me/documents/{lic2}/confirm")
        n = one("SELECT count(*) n FROM partner_documents WHERE partner_id=%(p)s AND doc_type='driving_licence' "
                "AND file_url IS NOT NULL", {"p": p1})["n"]
        check("a second licence replaces the first (one row)", n == 1, str(n))
        check("and the first file is deleted from the bucket", await storage.object_info(first_path) is None)
        pid_doc, _ = await upload("photo_id", "image/jpeg", b"\xff\xd8\xff" + b"jpg" * 10)
        await c.post(f"/api/v1/partners/me/documents/{pid_doc}/confirm")

        section("3. Staff: who may see a file, and every view audited")
        for role, code in (("support", 403), ("finance", 403)):
            as_(staff(role))
            r = await c.get(f"/api/v1/admin/partners/{p1}/documents/{lic2}/view")
            check(f"{role} cannot open a document ({code})", r.status_code == code, f"HTTP {r.status_code}")
        as_(staff("ops"))
        r = await c.get(f"/api/v1/admin/partners/{p1}/documents/{lic2}/view")
        url = (r.json().get("data") or {}).get("url", "")
        got = await raw.get(url) if url else None
        check("ops gets a 60 s link that serves the exact file", r.status_code == 200 and got is not None
              and got.status_code == 200 and got.content == PNG + b"v2", f"HTTP {r.status_code}")
        a = one("SELECT count(*) n FROM admin_audit_log WHERE target_id=%(p)s AND action='partner_document_viewed'", {"p": p1})["n"]
        check("the view wrote a partner_document_viewed audit row", a == 1, str(a))
        r = await c.get(f"/api/v1/admin/partners/{p2}/documents/{lic2}/view")
        check("the document under another partner's id is 404", r.status_code == 404, f"HTTP {r.status_code}")
        check("the bucket refuses a public read", (await raw.get(
            f"{S.SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{storage.BUCKET}/{first_path}")).status_code != 200)

        section("4. Review and the verification gate")
        r = await c.patch(f"/api/v1/admin/partners/{p1}/documents/{pid_doc}", json={"status": "rejected"})
        check("a rejection without a reason is 400", r.status_code == 400, f"HTTP {r.status_code}")
        r = await c.patch(f"/api/v1/admin/partners/{p1}/documents/{pid_doc}", json={"status": "rejected", "reason": "Photo is blurred"})
        check("reject with a reason", r.status_code == 200, r.text[:150])
        as_(partner(p1))
        d = (await c.get("/api/v1/partners/me/documents")).json()["data"]
        mine = {x["doc_type"]: x for x in d["documents"]}
        check("the partner sees the reason", mine["photo_id"]["status"] == "rejected"
              and mine["photo_id"]["rejection_reason"] == "Photo is blurred")
        as_(staff("ops"))
        await c.patch(f"/api/v1/admin/partners/{p1}/documents/{lic2}", json={"status": "approved", "expiry_date": "2040-01-01"})
        r = await c.patch(f"/api/v1/admin/partners/{p1}/verify", json={"verification_status": "verified"})
        check("verify with a rejected photo ID is 409 PARTNER_DOCUMENTS_INCOMPLETE",
              r.status_code == 409 and r.json()["error"]["code"] == "PARTNER_DOCUMENTS_INCOMPLETE", r.text[:150])
        as_(partner(p1))
        pid2, _ = await upload("photo_id")
        await c.post(f"/api/v1/partners/me/documents/{pid2}/confirm")
        as_(staff("ops"))
        await c.patch(f"/api/v1/admin/partners/{p1}/documents/{pid2}", json={"status": "approved"})
        r = await c.get(f"/api/v1/admin/partners/{p1}")
        d = r.json()["data"]
        check("detail shows the documents complete", d["documents_complete"] is True and len(d["documents"]) == 2, str(d)[:200])
        r = await c.patch(f"/api/v1/admin/partners/{p1}/verify", json={"verification_status": "verified"})
        check("now verify succeeds", r.status_code == 200, r.text[:150])
        acts = [x["action"] for x in (await c.get("/api/v1/admin/audit-log",
                params={"target_type": "partner", "target_id": str(p1)})).json()["data"]["items"]]
        check("approvals and the rejection are audited", acts.count("partner_document_approved") == 2
              and "partner_document_rejected" in acts, str(acts))

        section("5. Towing: two more documents, then verified equipment")
        one("INSERT INTO partner_services (partner_id, service_id) VALUES (%(p)s, %(s)s)", {"p": p2, "s": tow_service})
        as_(partner(p2))
        d = (await c.get("/api/v1/partners/me/documents")).json()["data"]
        check("a towing partner needs four documents", len(d["required"]) == 4, str(d["required"]))
        r = await c.post("/api/v1/partners/me/documents", json={"doc_type": "tow_vehicle_rc", "content_type": "image/png"})
        check("a tow RC without its registration number is 400", r.status_code == 400, f"HTTP {r.status_code}")
        rc, _ = await upload("tow_vehicle_rc", ref="ka 01 qa 8501")
        await c.post(f"/api/v1/partners/me/documents/{rc}/confirm")
        ph, _ = await upload("tow_equipment_photo")
        await c.post(f"/api/v1/partners/me/documents/{ph}/confirm")
        as_(staff("super_admin"))
        await c.patch(f"/api/v1/admin/partners/{p2}/documents/{rc}", json={"status": "approved"})
        e = one("SELECT verification_status, registration_number FROM partner_equipment WHERE partner_id=%(p)s", {"p": p2})
        check("one approved tow document is not enough", e is not None and e["verification_status"] == "pending", str(e))
        await c.patch(f"/api/v1/admin/partners/{p2}/documents/{ph}", json={"status": "approved"})
        e = one("SELECT verification_status, registration_number FROM partner_equipment WHERE partner_id=%(p)s", {"p": p2})
        check("both approved: verified tow equipment with the normalised RC number",
              e["verification_status"] == "verified" and e["registration_number"] == "KA01QA8501", str(e))

        section("6. Retention")
        r = await c.patch(f"/api/v1/admin/partners/{p2}/verify", json={"verification_status": "rejected", "notes": "QA rejection"})
        n = one("SELECT count(*) n FROM partner_documents WHERE partner_id=%(p)s AND retain_until > now() + interval '89 days'", {"p": p2})["n"]
        check("rejecting a partner starts the 90-day clock", r.status_code == 200 and n == 2, f"{r.status_code} {n}")
        paths = [x["file_url"] for x in [one("SELECT file_url FROM partner_documents WHERE id=%(i)s", {"i": i}) for i in (rc, ph)]]
        one("UPDATE partner_documents SET retain_until = now() - interval '1 minute' WHERE partner_id=%(p)s", {"p": p2})
        one("UPDATE partner_documents SET uploaded_at = now() - interval '2 days' WHERE id=%(i)s", {"i": early})
        async with AsyncSessionLocal() as db:
            deleted, _ = await partner_document_service.sweep_retention(db)
        left = one("SELECT count(*) n FROM partner_documents WHERE partner_id=%(p)s", {"p": p2})["n"]
        check("the sweep deletes the expired rows and the abandoned upload", left == 0 and deleted >= 3
              and one("SELECT 1 FROM partner_documents WHERE id=%(i)s", {"i": early}) is None, f"left={left} deleted={deleted}")
        gone = [await storage.object_info(pth) is None for pth in paths]
        check("and their files are gone from the bucket", all(gone), str(gone))
        one("UPDATE partner_documents SET expiry_date = current_date - 1 WHERE id=%(i)s", {"i": lic2})
        async with AsyncSessionLocal() as db:
            _, expired = await partner_document_service.sweep_retention(db)
        st = one("SELECT status FROM partner_documents WHERE id=%(i)s", {"i": lic2})["status"]
        check("an approved licence past its expiry date is marked expired", st == "expired" and expired >= 1, st)

    app.dependency_overrides.clear()
    await purge_files()
    purge_rows()
    after = one("SELECT count(*) n FROM partner_documents")["n"]
    check("cleanup: partner_documents back to its baseline", after == before, f"{before} -> {after}")
    print(f"\n{sum(_results)}/{len(_results)} checks passed")
    return all(_results)


if __name__ == "__main__":
    ok = False
    try:
        ok = asyncio.run(main())
    finally:
        if not ok:
            try:
                asyncio.run(purge_files())
            except Exception as exc:  # noqa: BLE001
                print(f"file cleanup failed: {exc}")
            purge_rows()
    sys.exit(0 if ok else 1)
