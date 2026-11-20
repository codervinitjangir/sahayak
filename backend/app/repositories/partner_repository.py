"""
Data-access layer for partner registration, availability and service linkage.

Same contract as app/repositories/job_repository.py: everything here only talks
to the database and returns ORM objects, rows or None. It deliberately does not
raise HTTP errors and does not commit — deciding what a missing row *means*,
and where the transaction boundary sits, belongs to
app/services/partner_service.py.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import and_, exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job import Job, JobAssignment
from app.models.partner import Partner, PartnerEquipment, PartnerService
from app.models.service import Service, ServiceCategory


async def get_partner_by_id(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[Partner]:
    """Fetch a single partner by primary key, or None when no such row exists.

    (job_repository keeps its own narrow copy of this lookup for the job-detail
    read path; the two are intentionally independent so neither feature's
    repository has to import the other's.)
    """
    result = await db.execute(select(Partner).where(Partner.id == partner_id))
    return result.scalar_one_or_none()


async def get_partner_by_phone(db: AsyncSession, phone: str) -> Optional[Partner]:
    """Look up a partner by phone number, which is unique in the schema.

    Used to answer "is this person already registered?" before attempting an
    insert, so the caller can return a meaningful error instead of letting a
    unique-constraint violation surface.
    """
    result = await db.execute(select(Partner).where(Partner.phone == phone))
    return result.scalar_one_or_none()


async def get_category_by_code(
    db: AsyncSession, category_code: str
) -> Optional[ServiceCategory]:
    """Resolve a service category code (e.g. "towing") to its row."""
    result = await db.execute(
        select(ServiceCategory).where(ServiceCategory.code == category_code)
    )
    return result.scalar_one_or_none()


async def get_services_by_codes(
    db: AsyncSession, service_codes: Iterable[str]
) -> Sequence[Service]:
    """Resolve many service codes in one round trip.

    Returns only the rows that matched; the caller compares what came back
    against what it asked for to discover which codes were bogus. One query
    rather than one per code keeps the check cheap as the list grows.
    """
    codes = list(service_codes)
    if not codes:
        return []
    result = await db.execute(select(Service).where(Service.code.in_(codes)))
    return result.scalars().all()


async def create_partner_row(
    db: AsyncSession,
    *,
    name: str,
    phone: str,
    primary_category_id: Optional[int] = None,
) -> Partner:
    """Stage a new partners row and flush it so its generated id is available.

    Only the caller-supplied fields are set. verification_status, is_available,
    rating_avg and rating_count are left to the column defaults ('pending',
    false, 0.0, 0) rather than restated here, so the schema stays the single
    source of truth for what a brand-new partner looks like.
    """
    partner = Partner(
        name=name,
        phone=phone,
        primary_category_id=primary_category_id,
    )
    db.add(partner)
    await db.flush()
    return partner


async def set_partner_availability(
    db: AsyncSession, partner: Partner, is_available: bool
) -> Partner:
    """Stage an availability change on an already-loaded partner.

    updated_at is refreshed by the model's onupdate hook, so the partner app can
    tell how stale a shift status is.
    """
    partner.is_available = is_available
    await db.flush()
    return partner


async def link_services(
    db: AsyncSession, *, partner_id: uuid.UUID, service_ids: Iterable[int]
) -> None:
    """Stage partner_services links, ignoring pairs that already exist.

    ON CONFLICT DO NOTHING against the composite primary key is what makes the
    endpoint safely repeatable: a partner app re-sending its full service list
    on every sync must not fail merely because nothing changed.
    """
    ids = list(dict.fromkeys(service_ids))  # de-duplicate, preserve order
    if not ids:
        return

    statement = (
        pg_insert(PartnerService)
        .values([{"partner_id": partner_id, "service_id": sid} for sid in ids])
        .on_conflict_do_nothing(index_elements=["partner_id", "service_id"])
    )
    await db.execute(statement)
    await db.flush()


async def get_partner_services(
    db: AsyncSession, partner_id: uuid.UUID
) -> Sequence[Service]:
    """Fetch every service a partner currently offers, joined to services.

    Ordered by id so a client polling this endpoint sees a stable list rather
    than rows in whatever order Postgres returns them.
    """
    result = await db.execute(
        select(Service)
        .join(PartnerService, PartnerService.service_id == Service.id)
        .where(PartnerService.partner_id == partner_id)
        .order_by(Service.id)
    )
    return result.scalars().all()


async def has_verified_equipment(db: AsyncSession, partner_id: uuid.UUID) -> bool:
    """Whether the partner holds at least one verified partner_equipment row.

    The same test dispatch_repository.get_eligible_partners applies to services
    with requires_vehicle_equipment, asked for one partner so the partner app
    can say which of their services dispatch will actually send them.
    """
    result = await db.execute(
        select(
            exists().where(
                and_(
                    PartnerEquipment.partner_id == partner_id,
                    PartnerEquipment.verification_status == "verified",
                )
            )
        )
    )
    return bool(result.scalar())


async def get_partner_stats(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[dict]:
    """Fetch partner trust/performance metrics: rating, count, verification status,
    plus aggregated lifetime jobs and acceptance rate from job_assignments.
    """
    partner = await get_partner_by_id(db, partner_id)
    if partner is None:
        return None

    stmt = (
        select(
            func.count().filter(JobAssignment.status == "completed").label("lifetime_jobs"),
            func.count().filter(JobAssignment.status.in_(("accepted", "completed"))).label("accepted_offers"),
            func.count().filter(JobAssignment.status.in_(("accepted", "completed", "rejected", "timed_out"))).label("total_decided_offers"),
        )
        .where(JobAssignment.partner_id == partner_id)
    )
    result = await db.execute(stmt)
    row = result.one()
    lifetime_jobs = int(row.lifetime_jobs or 0)
    accepted_offers = int(row.accepted_offers or 0)
    total_decided_offers = int(row.total_decided_offers or 0)

    if total_decided_offers > 0:
        acceptance_rate_pct = round((accepted_offers / total_decided_offers) * 100)
    else:
        acceptance_rate_pct = 100

    return {
        "partner_id": partner.id,
        "verification_status": partner.verification_status,
        "is_available": bool(partner.is_available),
        "rating_avg": partner.rating_avg or Decimal("0.0"),
        "rating_count": partner.rating_count or 0,
        "acceptance_rate_pct": acceptance_rate_pct,
        "lifetime_jobs": lifetime_jobs,
    }


async def get_partner_earnings(
    db: AsyncSession,
    partner_id: uuid.UUID,
    today_start: datetime,
    week_start: datetime,
) -> dict:
    """Aggregate completed-job payouts for today, this week and lifetime.

    One query with FILTER clauses rather than three round trips: the three
    windows share the same join and the same "this partner actually completed
    it" predicate, so splitting them would repeat both for no gain. The join
    to job_assignments is what makes the sum belong to *this* partner; a job
    has one accepted assignment, and `status='completed'` excludes offers that
    were declined or cancelled.
    """
    stmt = (
        select(
            func.coalesce(
                func.sum(Job.price_final).filter(Job.completed_at >= today_start),
                0,
            ).label("today_amount"),
            func.count()
            .filter(Job.completed_at >= today_start)
            .label("today_jobs"),
            func.coalesce(
                func.sum(Job.price_final).filter(Job.completed_at >= week_start),
                0,
            ).label("week_amount"),
            func.count()
            .filter(Job.completed_at >= week_start)
            .label("week_jobs"),
            func.coalesce(func.sum(Job.price_final), 0).label("lifetime_amount"),
            func.count().label("lifetime_jobs"),
        )
        .select_from(Job)
        .join(JobAssignment, JobAssignment.job_id == Job.id)
        .where(
            JobAssignment.partner_id == partner_id,
            JobAssignment.status == "completed",
            Job.status == "completed",
        )
    )
    result = await db.execute(stmt)
    row = result.one()
    return {
        "partner_id": partner_id,
        "today_amount": Decimal(str(row.today_amount or 0)),
        "today_jobs": int(row.today_jobs or 0),
        "week_amount": Decimal(str(row.week_amount or 0)),
        "week_jobs": int(row.week_jobs or 0),
        "lifetime_amount": Decimal(str(row.lifetime_amount or 0)),
        "lifetime_jobs": int(row.lifetime_jobs or 0),
    }


async def list_partners(
    db: AsyncSession, status: Optional[str] = None
) -> Sequence[Partner]:
    """List partners, optionally filtered by verification_status, newest first."""
    stmt = select(Partner)
    if status:
        stmt = stmt.where(Partner.verification_status == status)
    stmt = stmt.order_by(Partner.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def update_partner_verification(
    db: AsyncSession,
    partner_id: uuid.UUID,
    verification_status: str,
    note: Optional[str] = None,
) -> Optional[Partner]:
    """Update a partner's verification status and the reason behind it."""
    partner = await get_partner_by_id(db, partner_id)
    if not partner:
        return None
    partner.verification_status = verification_status
    partner.verification_note = note
    await db.flush()
    return partner


async def get_partner_with_credentials(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[Partner]:
    """One partner with documents and equipment eagerly loaded (async: no lazy loads)."""
    result = await db.execute(
        select(Partner)
        .options(selectinload(Partner.documents), selectinload(Partner.equipment))
        .where(Partner.id == partner_id)
    )
    return result.scalar_one_or_none()


async def count_live_work(db: AsyncSession, partner_id: uuid.UUID) -> int:
    """Open offers plus accepted assignments on a job that is still active.

    ADR-045: a partner cannot delete their account while an owner is waiting on
    them, or while an offer they could still accept is open.
    """
    result = await db.execute(
        select(func.count(JobAssignment.id))
        .join(Job, Job.id == JobAssignment.job_id)
        .where(JobAssignment.partner_id == partner_id)
        .where(
            (JobAssignment.status == "offered")
            | ((JobAssignment.status == "accepted") & Job.status.in_(("assigned", "partner_en_route", "in_progress")))
        )
    )
    return int(result.scalar_one() or 0)


async def erase_partner_data(db: AsyncSession, partner: Partner) -> list[str]:
    """The deletes and scrubs behind partner account deletion (ADR-045). Flush only.

    Removed: services, equipment, documents (rows here, files by the caller after
    commit), feature-interest rows, the partner's notifications and push tokens,
    and the free text of ratings the partner wrote. Kept, anonymised through the
    row: jobs, assignments, the scores owners gave, payments, disputes and tow
    photos, because the owners on the other side keep their history and an open
    dispute still needs its evidence.

    Returns the storage paths of the deleted documents.
    """
    from sqlalchemy import delete, update
    from app.models.device_push_token import DevicePushToken
    from app.models.feature_interest import FeatureInterest
    from app.models.notification import Notification
    from app.models.partner import PartnerDocument
    from app.models.rating import Rating

    pid = partner.id
    paths = list((await db.execute(
        select(PartnerDocument.file_url)
        .where(PartnerDocument.partner_id == pid, PartnerDocument.file_url.is_not(None))
    )).scalars().all())
    await db.execute(delete(PartnerDocument).where(PartnerDocument.partner_id == pid))
    await db.execute(delete(PartnerEquipment).where(PartnerEquipment.partner_id == pid))
    await db.execute(delete(PartnerService).where(PartnerService.partner_id == pid))
    await db.execute(delete(FeatureInterest).where(FeatureInterest.partner_id == pid))
    await db.execute(delete(Notification).where(
        Notification.recipient_type == "partner", Notification.recipient_id == pid))
    await db.execute(delete(DevicePushToken).where(
        DevicePushToken.owner_type == "partner", DevicePushToken.owner_id == pid))
    # The partner's own words about owners. The score stays (it is in the
    # owner-facing history); the free text, which can name the owner, goes.
    await db.execute(
        update(Rating).where(Rating.rated_by == "partner")
        .where(Rating.job_id.in_(
            select(JobAssignment.job_id).where(JobAssignment.partner_id == pid)))
        .values(comment=None)
    )
    partner.name = "Deleted partner"
    # 15 chars, unique, never dialable: 'del' + 12 hex of the id (as for owners).
    partner.phone = "del" + pid.hex[:12]
    partner.auth_user_id = None
    partner.is_available = False
    partner.verification_status = "suspended"
    partner.verification_note = "Account deleted by the partner"
    partner.deleted_at = func.now()
    await db.flush()
    return paths


async def export_partner_rows(db: AsyncSession, partner_id: uuid.UUID) -> dict:
    """Everything stored about one partner, for the data export (ADR-045 amendment).

    Rows only; the service decides which columns leave. Owner details on the
    partner's jobs are not loaded at all: they are the owner's data.
    """
    from app.models.job_trust import JobPhoto, JobPriceRevision
    from app.models.notification import Notification
    from app.models.partner import PartnerDocument
    from app.models.payment import Payment
    from app.models.rating import Rating

    services = (await db.execute(
        select(Service.code, Service.name)
        .join(PartnerService, PartnerService.service_id == Service.id)
        .where(PartnerService.partner_id == partner_id)
        .order_by(Service.code)
    )).all()
    equipment = (await db.execute(
        select(PartnerEquipment).where(PartnerEquipment.partner_id == partner_id)
    )).scalars().all()
    documents = (await db.execute(
        select(PartnerDocument).where(PartnerDocument.partner_id == partner_id)
        .order_by(PartnerDocument.uploaded_at.desc())
    )).scalars().all()
    assignments = (await db.execute(
        select(JobAssignment, Job.status, Job.price_final, Job.requested_at, Job.completed_at,
               Job.cancelled_at, Service.code)
        .join(Job, Job.id == JobAssignment.job_id)
        .join(Service, Service.id == Job.service_id)
        .where(JobAssignment.partner_id == partner_id)
        .order_by(JobAssignment.offered_at.desc().nulls_last())
    )).all()
    job_ids = list({a[0].job_id for a in assignments})
    payments = ratings = []
    if job_ids:
        payments = (await db.execute(select(Payment).where(Payment.job_id.in_(job_ids)))).scalars().all()
        ratings = (await db.execute(select(Rating).where(Rating.job_id.in_(job_ids)))).scalars().all()
    revisions = (await db.execute(
        select(JobPriceRevision).where(JobPriceRevision.partner_id == partner_id)
        .order_by(JobPriceRevision.created_at.desc())
    )).scalars().all()
    photos = (await db.execute(
        select(JobPhoto).where(JobPhoto.partner_id == partner_id).order_by(JobPhoto.created_at.desc())
    )).scalars().all()
    notifications = (await db.execute(
        select(Notification).where(Notification.recipient_type == "partner")
        .where(Notification.recipient_id == partner_id).order_by(Notification.sent_at.desc())
    )).scalars().all()
    return {
        "services": services, "equipment": equipment, "documents": documents,
        "assignments": assignments, "payments": payments, "ratings": ratings,
        "revisions": revisions, "photos": photos, "notifications": notifications,
    }
