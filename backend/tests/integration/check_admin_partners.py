"""
Live check of the admin partner-verification handlers against the real ORM + database.

  python tests/integration/check_admin_partners.py

Why this exists: the unit tests for these handlers use fake partner objects, and a fake
happily carries attributes the real `Partner` model does not have. GET /admin/partners
read `Partner.business_name`, which has never existed, so the endpoint 500'd the moment
one partner row existed — with 413 unit tests green. This drives the handlers with a real
AsyncSession and a real row, then removes everything it created.
"""
import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pydantic import ValidationError  # noqa: E402
from sqlalchemy import delete, select, text  # noqa: E402

from app.api.admin import get_partner_detail, list_partners, verify_partner  # noqa: E402
from app.config.database import AsyncSessionLocal  # noqa: E402
from app.models.partner import Partner, PartnerDocument, PartnerEquipment  # noqa: E402
from app.schemas.admin import AdminPartnerVerificationRequest  # noqa: E402
from app.services.auth_service import Identity  # noqa: E402
from app.utils.errors import AppError, NotFoundError  # noqa: E402

# Verification writes an audit row whose admin_id is a foreign key to admins
# (ADR-024), so the identity must be a real admins row, not a random uuid.
ADMIN: Identity | None = None
PHONE = "+919000000862"
FAILED: list[str] = []
PASSED = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global PASSED
    if ok:
        PASSED += 1
    else:
        FAILED.append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))


async def purge(db) -> None:
    ids = select(Partner.id).where(Partner.phone == PHONE)
    # Audit rows are append-only by trigger; cleanup lifts it for its own rows only.
    await db.execute(text("ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_log_append_only"))
    await db.execute(text("DELETE FROM admin_audit_log WHERE target_type = 'partner' AND target_id IN "
                          "(SELECT id FROM partners WHERE phone = :p)"), {"p": PHONE})
    await db.execute(text("ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_log_append_only"))
    await db.execute(delete(PartnerDocument).where(PartnerDocument.partner_id.in_(ids)))
    await db.execute(delete(PartnerEquipment).where(PartnerEquipment.partner_id.in_(ids)))
    await db.execute(delete(Partner).where(Partner.phone == PHONE))
    await db.commit()


async def main() -> None:
    global ADMIN
    async with AsyncSessionLocal() as db:
        admin_id = (await db.execute(text("SELECT id FROM admins ORDER BY name LIMIT 1"))).scalar_one()
        ADMIN = Identity(auth_user_id=uuid.uuid4(), role="admin", local_id=admin_id, admin_role="super_admin")
        await purge(db)
        try:
            partner = Partner(name="Admin QA Partner", phone=PHONE)
            db.add(partner)
            await db.flush()
            pid = partner.id
            db.add(PartnerDocument(partner_id=pid, doc_type="driving_licence", status="approved",
                                   file_url=f"{pid}/x.pdf", content_type="application/pdf"))
            db.add(PartnerDocument(partner_id=pid, doc_type="photo_id",
                                   file_url=f"{pid}/y.jpg", content_type="image/jpeg"))
            # An upload started and never confirmed (ADR-038): not a document to review.
            db.add(PartnerDocument(partner_id=pid, doc_type="photo_id", content_type="image/jpeg"))
            db.add(PartnerEquipment(partner_id=pid, equipment_type="flatbed",
                                    registration_number="KA01QA0001"))
            await db.commit()

            print("1. Roster")
            res = (await list_partners(status_filter=None, identity=ADMIN, db=db))["data"]
            mine = [i for i in res.items if i.id == pid]
            check("the roster serialises a real partner row", len(mine) == 1, f"total={res.total}")
            pend = (await list_partners(status_filter="pending", identity=ADMIN, db=db))["data"]
            check("the pending filter includes the new partner", any(i.id == pid for i in pend.items))

            print("2. Detail")
            d = (await get_partner_detail(pid, identity=ADMIN, db=db))["data"]
            check("detail returns both confirmed documents, not the unfinished upload",
                  len(d.documents) == 2, str(len(d.documents)))
            check("detail lists what is required and that it is not complete (ADR-038)",
                  d.documents_required == ["driving_licence", "photo_id"] and d.documents_complete is False,
                  f"{d.documents_required} {d.documents_complete}")
            check("detail returns the equipment", len(d.equipment) == 1
                  and d.equipment[0].registration_number == "KA01QA0001")
            by_type = {x.doc_type: x for x in d.documents}
            check("has_file reflects a stored file without exposing its path",
                  by_type["driving_licence"].has_file and by_type["photo_id"].has_file
                  and "file_url" not in d.model_dump()["documents"][0])
            try:
                await get_partner_detail(uuid.uuid4(), identity=ADMIN, db=db)
                check("an unknown partner is a 404", False)
            except NotFoundError as e:
                check("an unknown partner is a 404", e.code == "PARTNER_NOT_FOUND")

            print("3. Reject needs a reason")
            for bad in (None, "", "  ", "ab"):
                try:
                    AdminPartnerVerificationRequest(verification_status="rejected", notes=bad)
                    check(f"rejecting with notes={bad!r} is refused", False)
                except ValidationError:
                    check(f"rejecting with notes={bad!r} is refused", True)
            try:
                AdminPartnerVerificationRequest(verification_status="suspended")
                check("suspending without a reason is refused", False)
            except ValidationError:
                check("suspending without a reason is refused", True)

            print("4. Reason is stored, shown, and cleared")
            r = (await verify_partner(pid, AdminPartnerVerificationRequest(
                verification_status="rejected", notes="  RC book expired  "),
                identity=ADMIN, db=db))["data"]
            check("reject stores the trimmed reason",
                  r.verification_status == "rejected" and r.verification_note == "RC book expired")
            d = (await get_partner_detail(pid, identity=ADMIN, db=db))["data"]
            check("the reason is visible on the detail view", d.verification_note == "RC book expired")
            try:
                await verify_partner(pid, AdminPartnerVerificationRequest(
                    verification_status="verified"), identity=ADMIN, db=db)
                check("verifying with a pending photo ID is refused (ADR-038)", False)
            except AppError as e:
                check("verifying with a pending photo ID is refused (ADR-038)",
                      e.code == "PARTNER_DOCUMENTS_INCOMPLETE" and e.status_code == 409)
                await db.rollback()
            retain = (await db.execute(text("SELECT count(*) FROM partner_documents WHERE partner_id = :p "
                                            "AND retain_until > now() + interval '89 days'"), {"p": pid})).scalar_one()
            check("the rejection started the 90-day retention clock on every document", retain == 3, str(retain))
            await db.execute(text("UPDATE partner_documents SET status = 'approved' WHERE partner_id = :p "
                                  "AND file_url IS NOT NULL"), {"p": pid})
            await db.commit()
            r = (await verify_partner(pid, AdminPartnerVerificationRequest(
                verification_status="verified", notes="ignored"), identity=ADMIN, db=db))["data"]
            retain = (await db.execute(text("SELECT count(*) FROM partner_documents WHERE partner_id = :p "
                                            "AND retain_until IS NOT NULL"), {"p": pid})).scalar_one()
            check("verifying again stops the clock", retain == 0, str(retain))
            check("verifying clears the reason (and drops stray notes)",
                  r.verification_status == "verified" and r.verification_note is None)
            try:
                await verify_partner(uuid.uuid4(), AdminPartnerVerificationRequest(
                    verification_status="verified"), identity=ADMIN, db=db)
                check("verifying an unknown partner is a 404", False)
            except NotFoundError:
                check("verifying an unknown partner is a 404", True)
        finally:
            await db.rollback()
            await purge(db)
            left = (await db.execute(select(Partner).where(Partner.phone == PHONE))).first()
            check("cleanup: no test partner left behind", left is None)

    print(f"\n{PASSED}/{PASSED + len(FAILED)} checks passed")
    if FAILED:
        print("Failures:\n" + "\n".join(f"  - {f}" for f in FAILED))
        sys.exit(1)


asyncio.run(main())
