"""
Data-access layer for partner registration, availability and service linkage.

Same contract as app/repositories/job_repository.py: everything here only talks
to the database and returns ORM objects, rows or None. It deliberately does not
raise HTTP errors and does not commit — deciding what a missing row *means*,
and where the transaction boundary sits, belongs to
app/services/partner_service.py.
"""
import uuid
from typing import Iterable, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner, PartnerService
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
