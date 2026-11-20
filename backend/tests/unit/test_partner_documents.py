"""ADR-038: partner documents. Pure rules and the service's refusals.

The real bucket, the real SQL and the role checks over HTTP are
tests/integration/check_partner_documents.py's job.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.repositories import partner_document_repository as repo
from app.schemas.partner_document import DocumentReviewRequest, DocumentUploadRequest
from app.services import partner_document_service as svc
from app.utils import storage
from app.utils.errors import AppError, ErrorCode
from app.utils.auth import STAFF_WRITE_ROLES

PID = uuid.uuid4()
STAFF = SimpleNamespace(local_id=uuid.uuid4(), role="admin", admin_role="ops")


class Session:
    def __init__(self):
        self.commits = self.rollbacks = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def flush(self):
        pass


def _doc(doc_type, status="pending", **kw):
    base = dict(id=uuid.uuid4(), partner_id=PID, doc_type=doc_type, status=status, file_url=f"{PID}/x.jpg",
                content_type="image/jpeg", rejection_reason=None, expiry_date=None,
                uploaded_at=datetime.now(timezone.utc), reference_number=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_towing_partners_need_two_more_documents():
    assert svc.required_for(False) == ("driving_licence", "photo_id")
    assert svc.required_for(True) == ("driving_licence", "photo_id", "tow_vehicle_rc", "tow_equipment_photo")


def test_checklist_is_complete_only_when_every_required_document_is_approved():
    req = svc.required_for(False)
    half = svc.summarise(req, [_doc("driving_licence", "approved")])
    assert half.complete is False
    assert [(d.doc_type, d.status) for d in half.documents] == [("driving_licence", "approved"), ("photo_id", "missing")]
    full = svc.summarise(req, [_doc("driving_licence", "approved"), _doc("photo_id", "approved")])
    assert full.complete is True
    expired = svc.summarise(req, [_doc("driving_licence", "expired"), _doc("photo_id", "approved")])
    assert expired.complete is False


def test_the_object_path_is_the_partners_folder_and_never_user_text():
    did = uuid.uuid4()
    assert svc.object_path(PID, did, "application/pdf") == f"{PID}/{did}.pdf"


def test_only_ops_and_super_admin_may_open_documents():
    assert STAFF_WRITE_ROLES["documents"] == ("super_admin", "ops")


def test_tow_documents_are_refused_for_a_partner_who_does_not_tow(monkeypatch):
    async def no(_db, _pid):
        return False
    monkeypatch.setattr(repo, "partner_does_towing", no)
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.start_upload(Session(), PID, DocumentUploadRequest(
            doc_type="tow_equipment_photo", content_type="image/jpeg")))
    assert exc.value.code == ErrorCode.DOCUMENT_NOT_REQUIRED


def test_a_tow_rc_needs_its_registration_number(monkeypatch):
    async def yes(_db, _pid):
        return True
    monkeypatch.setattr(repo, "partner_does_towing", yes)
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.start_upload(Session(), PID, DocumentUploadRequest(
            doc_type="tow_vehicle_rc", content_type="image/jpeg")))
    assert exc.value.status_code == 400


def test_storage_down_is_a_503_and_writes_nothing(monkeypatch):
    added = []

    async def no(_db, _pid):
        return False

    async def down(_path):
        raise storage.StorageError("timeout")

    async def add(_db, **kw):
        added.append(kw)

    monkeypatch.setattr(repo, "partner_does_towing", no)
    monkeypatch.setattr(storage, "signed_upload_url", down)
    monkeypatch.setattr(repo, "add_document", add)
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.start_upload(Session(), PID, DocumentUploadRequest(
            doc_type="photo_id", content_type="image/png")))
    assert exc.value.status_code == 503 and exc.value.code == ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE
    assert added == []


def test_confirming_before_the_file_arrives_is_409(monkeypatch):
    doc = _doc("photo_id", file_url=None)

    async def get(_db, _pid, _did, for_update=False):
        return doc

    async def missing(_path):
        return None

    monkeypatch.setattr(repo, "get_document", get)
    monkeypatch.setattr(storage, "object_info", missing)
    s = Session()
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.confirm_upload(s, PID, doc.id))
    assert exc.value.code == ErrorCode.DOCUMENT_NOT_UPLOADED and s.commits == 0
    assert doc.file_url is None


def test_another_partners_document_is_a_404(monkeypatch):
    async def none(_db, _pid, _did, for_update=False):
        return None
    monkeypatch.setattr(repo, "get_document", none)
    for call in (lambda: svc.confirm_upload(Session(), PID, uuid.uuid4()),
                 lambda: svc.view_url(Session(), PID, uuid.uuid4(), STAFF)):
        with pytest.raises(AppError) as exc:
            asyncio.run(call())
        assert exc.value.status_code == 404 and exc.value.code == ErrorCode.DOCUMENT_NOT_FOUND


def test_a_rejection_needs_a_reason():
    with pytest.raises(AppError) as exc:
        asyncio.run(svc.review(Session(), PID, uuid.uuid4(), DocumentReviewRequest(status="rejected"), STAFF))
    assert exc.value.status_code == 400


def test_approving_the_second_tow_document_verifies_tow_equipment(monkeypatch):
    rc = _doc("tow_vehicle_rc", "approved", reference_number="KA01AB1234")
    photo = _doc("tow_equipment_photo", "pending")
    equipment, audits = [], []

    async def get(_db, _pid, did, for_update=False):
        return photo

    async def confirmed(_db, _pid):
        return [rc, photo]

    async def upsert(_db, pid, reg, status, now):
        equipment.append((reg, status))

    async def audit(_db, **kw):
        audits.append(kw["action"])

    async def checklist(_db, _pid):
        return "ok"

    monkeypatch.setattr(repo, "get_document", get)
    monkeypatch.setattr(repo, "confirmed_documents", confirmed)
    monkeypatch.setattr(repo, "upsert_tow_equipment", upsert)
    monkeypatch.setattr(svc.admin_ops_repository, "add_audit", audit)
    monkeypatch.setattr(svc, "checklist", checklist)
    s = Session()
    asyncio.run(svc.review(s, PID, photo.id, DocumentReviewRequest(status="approved"), STAFF))
    assert equipment == [("KA01AB1234", "verified")]
    assert audits == ["partner_document_approved"] and s.commits == 1
