"""2026-11-21 trust and safety pass: ADR-039 (extra charges need the owner),
ADR-040 (start only at the pickup), ADR-041 (new partner when overdue),
ADR-042 (tow photos), ADR-043 (off-app payment reports)."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.schemas.dispute import DisputeCreate
from app.schemas.job_safeguards import PriceRevisionCreate
from app.services import dispute_service, job_safeguard_service as svc, job_service
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ConflictError, ErrorCode, ForbiddenError, NotFoundError

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)
PARTNER = uuid.uuid4()
OWNER = uuid.uuid4()


def _job(status="in_progress", estimate="500", service_id=1, user_id=OWNER):
    return SimpleNamespace(id=uuid.uuid4(), status=status, user_id=user_id, service_id=service_id,
                           price_estimate=Decimal(estimate) if estimate is not None else None,
                           pickup_location=None)


def _assignment(partner_id=PARTNER, status="accepted", accepted_at=NOW, eta=10):
    return SimpleNamespace(partner_id=partner_id, status=status, accepted_at=accepted_at,
                           estimated_arrival_min=eta)


def _owner(local_id=OWNER):
    return Identity(role="user", local_id=local_id, auth_user_id="a")


@pytest.fixture
def wired(monkeypatch):
    """In-memory repositories. `calls` records every write the service asked for."""
    st = SimpleNamespace(job=_job(), assignment=_assignment(), approved=None, stages=set(),
                         towing=False, revisions=[], revision=None, open=[], calls=[])
    repo, jr = svc.repo, svc.job_repository

    async def job_by_id(_db, _id):
        return st.job

    monkeypatch.setattr(jr, "get_job_by_id", job_by_id)
    monkeypatch.setattr(jr, "get_job_by_id_for_update", job_by_id)
    monkeypatch.setattr(jr, "get_responsible_assignment", AsyncMock(side_effect=lambda *_: st.assignment))
    monkeypatch.setattr(jr, "get_open_assignments", AsyncMock(side_effect=lambda *_: st.open))
    monkeypatch.setattr(jr, "set_assignment_status",
                        AsyncMock(side_effect=lambda _db, a, s: st.calls.append(("assignment", s))))
    monkeypatch.setattr(jr, "update_job_fields",
                        AsyncMock(side_effect=lambda _db, j, **f: st.calls.append(("job", f))))
    monkeypatch.setattr(jr, "create_status_history_row",
                        AsyncMock(side_effect=lambda _db, **k: st.calls.append(("history", k["note"]))))
    monkeypatch.setattr(repo, "highest_approved", AsyncMock(side_effect=lambda *_: st.approved))
    monkeypatch.setattr(repo, "confirmed_stages", AsyncMock(side_effect=lambda *_: st.stages))
    monkeypatch.setattr(repo, "withdraw_pending",
                        AsyncMock(side_effect=lambda *_: st.calls.append(("withdraw",)) or 0))
    monkeypatch.setattr(repo, "get_revision", AsyncMock(side_effect=lambda *_: st.revision))
    monkeypatch.setattr(repo, "list_revisions", AsyncMock(side_effect=lambda *_: st.revisions))
    monkeypatch.setattr(repo, "list_photos", AsyncMock(return_value=[]))
    monkeypatch.setattr(repo, "set_revision_status",
                        AsyncMock(side_effect=lambda _db, r, s: setattr(r, "status", s)))

    async def add_revision(_db, **k):
        st.calls.append(("revision", k["amount"]))
        return SimpleNamespace(id=uuid.uuid4(), proposed_amount=k["amount"], reason=k["reason"],
                               status="pending", created_at=NOW, decided_at=None)

    monkeypatch.setattr(repo, "add_revision", add_revision)

    async def photos_required(_db, _job):
        return st.towing

    monkeypatch.setattr(svc, "photos_required", photos_required)
    monkeypatch.setattr(svc.notification_service, "notify_event",
                        AsyncMock(side_effect=lambda _db, **k: st.calls.append(("notify", k["recipient_type"], k["event"]))))
    return st


# ---------- ADR-039: the completion gate ----------

def test_free_margin_is_ten_percent_rounded_to_paise():
    assert svc.free_limit(Decimal("399")) == Decimal("438.90")
    assert svc.free_limit(None) is None


@pytest.mark.asyncio
async def test_completion_within_estimate_plus_ten_percent_passes_and_withdraws_pending(wired):
    await svc.check_completion(AsyncMock(), wired.job, Decimal("550"))
    assert ("withdraw",) in wired.calls


@pytest.mark.asyncio
async def test_completion_above_the_free_margin_without_approval_is_409(wired):
    with pytest.raises(ConflictError) as exc:
        await svc.check_completion(AsyncMock(), wired.job, Decimal("551"))
    assert exc.value.code == ErrorCode.PRICE_APPROVAL_REQUIRED
    assert ("withdraw",) not in wired.calls


@pytest.mark.asyncio
async def test_an_approved_revision_raises_the_limit_to_exactly_that_amount(wired):
    wired.approved = Decimal("900")
    await svc.check_completion(AsyncMock(), wired.job, Decimal("900"))
    with pytest.raises(ConflictError):
        await svc.check_completion(AsyncMock(), wired.job, Decimal("900.01"))


@pytest.mark.asyncio
async def test_a_job_with_no_estimate_needs_approval_for_any_price(wired):
    wired.job = _job(estimate=None)
    with pytest.raises(ConflictError) as exc:
        await svc.check_completion(AsyncMock(), wired.job, Decimal("100"))
    assert exc.value.code == ErrorCode.PRICE_APPROVAL_REQUIRED


# ---------- ADR-042: tow photos ----------

@pytest.mark.asyncio
@pytest.mark.parametrize("stages", [set(), {"pickup"}, {"drop"}])
async def test_a_tow_without_both_photos_cannot_complete(wired, stages):
    wired.towing, wired.stages = True, stages
    with pytest.raises(ConflictError) as exc:
        await svc.check_completion(AsyncMock(), wired.job, Decimal("500"))
    assert exc.value.code == ErrorCode.JOB_PHOTOS_REQUIRED


@pytest.mark.asyncio
async def test_a_tow_with_pickup_and_drop_photos_completes(wired):
    wired.towing, wired.stages = True, {"pickup", "drop"}
    await svc.check_completion(AsyncMock(), wired.job, Decimal("500"))


@pytest.mark.asyncio
async def test_photo_path_is_inside_the_job_prefix():
    j, p = uuid.uuid4(), uuid.uuid4()
    assert svc.photo_path(j, p, "image/jpeg") == f"jobs/{j}/{p}.jpg"


# ---------- ADR-039: proposing and deciding ----------

@pytest.mark.asyncio
async def test_a_partner_not_on_the_job_cannot_propose(wired):
    with pytest.raises(ForbiddenError):
        await svc.propose_revision(AsyncMock(), wired.job.id, PriceRevisionCreate(amount=900, reason="new battery"),
                                   uuid.uuid4())
    assert wired.calls == []


@pytest.mark.asyncio
async def test_proposal_inside_the_free_margin_is_refused_as_unneeded(wired):
    with pytest.raises(BadRequestError) as exc:
        await svc.propose_revision(AsyncMock(), wired.job.id, PriceRevisionCreate(amount=540, reason="round up"), PARTNER)
    assert exc.value.code == ErrorCode.PRICE_REVISION_NOT_NEEDED


@pytest.mark.asyncio
async def test_proposal_above_the_hard_ceiling_is_refused(wired):
    with pytest.raises(BadRequestError) as exc:
        await svc.propose_revision(AsyncMock(), wired.job.id, PriceRevisionCreate(amount=5001, reason="engine"), PARTNER)
    assert exc.value.code == ErrorCode.PRICE_FINAL_OUT_OF_RANGE


@pytest.mark.asyncio
async def test_proposal_on_a_finished_job_is_409(wired):
    wired.job = _job(status="completed")
    with pytest.raises(ConflictError) as exc:
        await svc.propose_revision(AsyncMock(), wired.job.id, PriceRevisionCreate(amount=900, reason="battery"), PARTNER)
    assert exc.value.code == ErrorCode.PRICE_REVISION_CLOSED


@pytest.mark.asyncio
async def test_a_second_pending_proposal_maps_the_unique_index_to_409(wired, monkeypatch):
    monkeypatch.setattr(svc.repo, "add_revision", AsyncMock(side_effect=IntegrityError("x", {}, Exception())))
    db = AsyncMock()
    with pytest.raises(ConflictError) as exc:
        await svc.propose_revision(db, wired.job.id, PriceRevisionCreate(amount=900, reason="battery"), PARTNER)
    assert exc.value.code == ErrorCode.PRICE_REVISION_PENDING
    db.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_a_proposal_is_stored_and_the_owner_is_told(wired):
    db = AsyncMock()
    res = await svc.propose_revision(db, wired.job.id, PriceRevisionCreate(amount=900, reason="new battery"), PARTNER)
    assert res.status == "pending"
    assert ("notify", "user", "price_revision_requested") in wired.calls
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_only_the_owner_may_answer_and_a_stranger_gets_404(wired):
    with pytest.raises(NotFoundError):
        await svc.decide_revision(AsyncMock(), wired.job.id, uuid.uuid4(), True, _owner(uuid.uuid4()))


@pytest.mark.asyncio
async def test_an_answered_revision_cannot_be_answered_again(wired):
    wired.revision = SimpleNamespace(id=uuid.uuid4(), status="rejected", partner_id=PARTNER)
    with pytest.raises(ConflictError) as exc:
        await svc.decide_revision(AsyncMock(), wired.job.id, wired.revision.id, True, _owner())
    assert exc.value.code == ErrorCode.PRICE_REVISION_CLOSED


@pytest.mark.asyncio
async def test_approval_is_recorded_and_the_partner_is_told(wired):
    wired.revision = SimpleNamespace(id=uuid.uuid4(), status="pending", partner_id=PARTNER,
                                     proposed_amount=Decimal("900"), reason="battery",
                                     created_at=NOW, decided_at=None)
    res = await svc.decide_revision(AsyncMock(), wired.job.id, wired.revision.id, True, _owner())
    assert res.status == "approved"
    assert ("notify", "partner", "price_revision_approved") in wired.calls


# ---------- ADR-041: a new partner when the first is overdue ----------

def test_overdue_is_the_longest_of_double_eta_eta_plus_20_and_30_minutes():
    assert svc.overdue_at(_assignment(eta=10)) == NOW + timedelta(minutes=30)
    assert svc.overdue_at(_assignment(eta=25)) == NOW + timedelta(minutes=50)
    assert svc.overdue_at(_assignment(eta=None)) == NOW + timedelta(minutes=60)
    assert svc.overdue_at(_assignment(accepted_at=None)) is None


@pytest.mark.asyncio
async def test_asking_before_the_overdue_point_is_409_and_writes_nothing(wired):
    wired.job = _job(status="partner_en_route")
    wired.open = [_assignment()]
    with pytest.raises(ConflictError) as exc:
        await svc.request_new_partner(AsyncMock(), wired.job.id, _owner(), now=NOW + timedelta(minutes=29))
    assert exc.value.code == ErrorCode.PARTNER_NOT_OVERDUE
    assert wired.calls == []


@pytest.mark.asyncio
async def test_once_work_has_started_the_partner_cannot_be_swapped(wired):
    wired.job = _job(status="in_progress")
    wired.open = [_assignment()]
    with pytest.raises(ConflictError) as exc:
        await svc.request_new_partner(AsyncMock(), wired.job.id, _owner(), now=NOW + timedelta(hours=3))
    assert exc.value.code == ErrorCode.JOB_NOT_REASSIGNABLE


@pytest.mark.asyncio
async def test_an_overdue_partner_is_released_and_the_search_runs_again(wired, monkeypatch):
    wired.job = _job(status="assigned")
    wired.open = [_assignment()]
    offered = AsyncMock()
    monkeypatch.setattr("app.services.dispatch_service._offer_next", offered)
    monkeypatch.setattr(svc, "get_safeguards", AsyncMock(return_value="ok"))
    res = await svc.request_new_partner(AsyncMock(), wired.job.id, _owner(), now=NOW + timedelta(minutes=31))
    assert res == "ok"
    assert ("assignment", "cancelled") in wired.calls
    assert ("job", {"status": "matching"}) in wired.calls
    assert any(c[0] == "history" and "Owner asked for another partner" in c[1] for c in wired.calls)
    assert ("notify", "partner", "job_reassigned_by_owner") in wired.calls
    offered.assert_awaited()


@pytest.mark.asyncio
async def test_someone_elses_job_is_404(wired):
    with pytest.raises(NotFoundError):
        await svc.request_new_partner(AsyncMock(), wired.job.id, _owner(uuid.uuid4()), now=NOW)


# ---------- ADR-040: the start code only works at the pickup ----------

@pytest.fixture
def fix(monkeypatch):
    holder = {"value": (None, None, None)}

    async def partner_fix(_pid):
        return holder["value"]

    monkeypatch.setattr(job_service, "_partner_fix", partner_fix)
    monkeypatch.setattr(job_service, "_pickup_coordinates", lambda job: job.coords)
    return holder


def _job_coords(lat=12.9716, lng=77.5946):
    return SimpleNamespace(id=uuid.uuid4(), coords=(lat, lng))


@pytest.mark.asyncio
async def test_a_fresh_fix_far_from_the_pickup_refuses_the_start(fix):
    fix["value"] = (12.9716 + 0.02, 77.5946, 30.0)        # about 2.2 km north
    with pytest.raises(ConflictError) as exc:
        await job_service._check_partner_at_pickup(_job_coords(), PARTNER)
    assert exc.value.code == ErrorCode.PARTNER_NOT_AT_PICKUP


@pytest.mark.asyncio
async def test_a_fresh_fix_at_the_pickup_starts_with_no_note(fix):
    fix["value"] = (12.9716 + 0.002, 77.5946, 30.0)       # about 220 m
    assert await job_service._check_partner_at_pickup(_job_coords(), PARTNER) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [(None, None, None), (13.5, 77.5, 3600.0)])
async def test_no_fix_or_a_stale_one_starts_but_the_history_says_unverified(fix, value):
    fix["value"] = value
    note = await job_service._check_partner_at_pickup(_job_coords(), PARTNER)
    assert note == "Start location not verified (no recent GPS fix)"


def test_distance_is_haversine_metres():
    assert 2200 < job_service._distance_m(12.9716, 77.5946, 12.9916, 77.5946) < 2240


# ---------- ADR-043: off-app payment reports on cancelled jobs ----------

@pytest.mark.asyncio
async def test_a_cancelled_job_a_partner_accepted_can_be_reported_for_off_app_payment(monkeypatch):
    job = SimpleNamespace(id=uuid.uuid4(), user_id=OWNER, status="cancelled")
    monkeypatch.setattr(dispute_service.job_repository, "get_job_by_id", AsyncMock(return_value=job))
    monkeypatch.setattr(dispute_service.job_repository, "get_responsible_assignment",
                        AsyncMock(return_value=_assignment(status="cancelled")))
    row = SimpleNamespace(id=uuid.uuid4(), job_id=job.id, reason="off_app_payment", description=None,
                          status="open", resolution_note=None, created_at=NOW, resolved_at=None)
    monkeypatch.setattr(dispute_service.dispute_repository, "create_dispute", AsyncMock(return_value=row))
    res = await dispute_service.open_dispute(AsyncMock(), job.id, DisputeCreate(reason="off_app_payment"), _owner())
    assert res.reason == "off_app_payment"


@pytest.mark.asyncio
async def test_a_cancelled_job_nobody_accepted_cannot_be_reported(monkeypatch):
    job = SimpleNamespace(id=uuid.uuid4(), user_id=OWNER, status="cancelled")
    monkeypatch.setattr(dispute_service.job_repository, "get_job_by_id", AsyncMock(return_value=job))
    monkeypatch.setattr(dispute_service.job_repository, "get_responsible_assignment", AsyncMock(return_value=None))
    with pytest.raises(ConflictError) as exc:
        await dispute_service.open_dispute(AsyncMock(), job.id, DisputeCreate(reason="off_app_payment"), _owner())
    assert exc.value.code == ErrorCode.JOB_NOT_DISPUTABLE


@pytest.mark.asyncio
async def test_overcharged_makes_no_sense_on_a_cancelled_job(monkeypatch):
    job = SimpleNamespace(id=uuid.uuid4(), user_id=OWNER, status="cancelled")
    monkeypatch.setattr(dispute_service.job_repository, "get_job_by_id", AsyncMock(return_value=job))
    monkeypatch.setattr(dispute_service.job_repository, "get_responsible_assignment",
                        AsyncMock(return_value=_assignment(status="cancelled")))
    with pytest.raises(ConflictError):
        await dispute_service.open_dispute(AsyncMock(), job.id, DisputeCreate(reason="overcharged"), _owner())



# ---------- ADR-043: risk alerts ----------

def _alerts(**kw):
    from app.services.admin_ops_service import evaluate_alerts
    return evaluate_alerts(now=NOW, live_jobs=[], window_counts={}, partners_on_duty=5,
                           partners_verified=5, **kw)


def test_one_cancel_after_start_is_life_two_is_a_flag():
    p1, p2 = uuid.uuid4(), uuid.uuid4()
    res = _alerts(partner_risk=[(p1, "A", 1, 0, 0), (p2, "B", 2, 0, 0)])
    flags = [a for a in res.alerts if a.code == "PARTNER_CANCELS_AFTER_START"]
    assert len(flags) == 1 and flags[0].partner_ids == [p2] and flags[0].severity == "critical"


def test_unverified_starts_and_owner_swaps_have_their_own_flags():
    p = uuid.uuid4()
    codes = {a.code for a in _alerts(partner_risk=[(p, "A", 0, 3, 2)]).alerts}
    assert {"PARTNER_STARTS_WITHOUT_GPS", "PARTNER_OFTEN_LATE"} <= codes


def test_open_off_app_reports_raise_a_critical_alert():
    res = _alerts(off_app_reports=2)
    assert [a.count for a in res.alerts if a.code == "OFF_APP_PAYMENT_REPORTS"] == [2]


def test_no_risk_no_new_alerts():
    assert _alerts().alerts == []


# ---------- ADR-055: the owner's photos of the problem ----------

def _photo_wiring(monkeypatch, wired, confirmed=0, rows=0):
    from app.schemas.job_safeguards import OwnerPhotoUploadRequest
    added = []
    monkeypatch.setattr(svc.repo, "count_issue_photos", AsyncMock(return_value=(confirmed, rows)))
    monkeypatch.setattr(svc.repo, "add_photo", AsyncMock(side_effect=lambda _db, **k: added.append(k)))
    monkeypatch.setattr(svc.storage, "signed_upload_url", AsyncMock(return_value="https://u"))
    return added, OwnerPhotoUploadRequest(content_type="image/jpeg")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["scheduled", "requested", "matching", "assigned", "partner_en_route"])
async def test_owner_adds_an_issue_photo_before_work_starts(monkeypatch, wired, status):
    wired.job = _job(status=status)
    added, req = _photo_wiring(monkeypatch, wired)
    ticket = await svc.start_owner_photo_upload(AsyncMock(), wired.job.id, OWNER, req)
    assert ticket.upload_url == "https://u"
    assert added[0]["stage"] == "issue" and added[0]["user_id"] == OWNER and added[0]["partner_id"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status,code", [("in_progress", ErrorCode.INVALID_STATUS_TRANSITION),
                                         ("completed", ErrorCode.JOB_ALREADY_TERMINAL),
                                         ("cancelled", ErrorCode.JOB_ALREADY_TERMINAL)])
async def test_no_issue_photo_once_work_started_or_the_job_ended(monkeypatch, wired, status, code):
    wired.job = _job(status=status)
    _, req = _photo_wiring(monkeypatch, wired)
    with pytest.raises(ConflictError) as exc:
        await svc.start_owner_photo_upload(AsyncMock(), wired.job.id, OWNER, req)
    assert exc.value.code == code


@pytest.mark.asyncio
async def test_someone_elses_job_is_a_404_not_a_403(monkeypatch, wired):
    wired.job = _job(status="requested")
    _, req = _photo_wiring(monkeypatch, wired)
    with pytest.raises(NotFoundError) as exc:
        await svc.start_owner_photo_upload(AsyncMock(), wired.job.id, uuid.uuid4(), req)
    assert exc.value.code == ErrorCode.JOB_NOT_FOUND


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmed,rows", [(3, 3), (1, 6)])
async def test_three_photos_and_a_cap_on_unfinished_uploads(monkeypatch, wired, confirmed, rows):
    wired.job = _job(status="requested")
    added, req = _photo_wiring(monkeypatch, wired, confirmed, rows)
    with pytest.raises(ConflictError):
        await svc.start_owner_photo_upload(AsyncMock(), wired.job.id, OWNER, req)
    assert added == []


@pytest.mark.asyncio
async def test_owner_cannot_confirm_a_partners_tow_photo(monkeypatch, wired):
    wired.job = _job(status="partner_en_route")
    tow = SimpleNamespace(id=uuid.uuid4(), stage="pickup", user_id=None, partner_id=PARTNER,
                          file_url=None, content_type="image/jpeg", uploaded_at=None)
    monkeypatch.setattr(svc.repo, "get_photo", AsyncMock(return_value=tow))
    with pytest.raises(NotFoundError) as exc:
        await svc.confirm_owner_photo(AsyncMock(), wired.job.id, tow.id, OWNER)
    assert exc.value.code == ErrorCode.JOB_PHOTO_NOT_FOUND


@pytest.mark.asyncio
async def test_an_offered_partner_cannot_see_the_owners_photos(monkeypatch, wired):
    """ADR-055 follows ADR-017: photos are released with the assignment, not the offer."""
    wired.job = _job(status="matching")
    wired.assignment = None  # an open offer is not a responsible assignment
    with pytest.raises(NotFoundError):
        await svc.photo_view_url(AsyncMock(), wired.job.id, uuid.uuid4(),
                                 Identity(role="partner", local_id=PARTNER, auth_user_id="p"))


@pytest.mark.asyncio
async def test_photo_retention_deletes_files_before_rows(monkeypatch):
    due = [SimpleNamespace(id=uuid.uuid4(), file_url="jobs/a/1.jpg"), SimpleNamespace(id=uuid.uuid4(), file_url=None)]
    order = []
    monkeypatch.setattr(svc.repo, "photos_past_retention", AsyncMock(return_value=due))
    monkeypatch.setattr(svc.storage, "delete_objects", AsyncMock(side_effect=lambda p: order.append(("files", p))))
    monkeypatch.setattr(svc.repo, "delete_photo_rows", AsyncMock(side_effect=lambda _db, ids: order.append(("rows", ids))))
    db = AsyncMock()
    assert await svc.sweep_photo_retention(db, now=NOW) == 2
    assert order == [("files", ["jobs/a/1.jpg"]), ("rows", [d.id for d in due])]
    kw = svc.repo.photos_past_retention.call_args.kwargs
    assert kw["ended_before"] == NOW - timedelta(days=90) and kw["abandoned_before"] == NOW - timedelta(days=1)


@pytest.mark.asyncio
async def test_a_storage_failure_keeps_the_rows_for_the_next_sweep(monkeypatch):
    monkeypatch.setattr(svc.repo, "photos_past_retention",
                        AsyncMock(return_value=[SimpleNamespace(id=uuid.uuid4(), file_url="jobs/a/1.jpg")]))
    monkeypatch.setattr(svc.storage, "delete_objects", AsyncMock(side_effect=svc.storage.StorageError("x")))
    rows = AsyncMock()
    monkeypatch.setattr(svc.repo, "delete_photo_rows", rows)
    assert await svc.sweep_photo_retention(AsyncMock(), now=NOW) == 0
    rows.assert_not_called()
