"""
Data-access layer for job creation and job detail reads.

Everything here only talks to the database: it builds and executes queries and
returns ORM objects (or None). It deliberately does not raise HTTP errors and
does not commit — deciding what a missing row *means*, and where the
transaction boundary sits, belongs to app/services/job_service.py.
"""
import uuid
from typing import Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobAssignment, JobStatusHistory
from app.models.partner import Partner
from app.models.service import Service
from app.models.vehicle import Vehicle


async def get_vehicle_by_id(
    db: AsyncSession, vehicle_id: uuid.UUID
) -> Optional[Vehicle]:
    """Fetch a single vehicle by primary key, or None when no such row exists."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    return result.scalar_one_or_none()


async def get_service_by_code(
    db: AsyncSession, service_code: str
) -> Optional[Service]:
    """Resolve a service code (e.g. "flat_tyre") to its services row.

    Clients send codes rather than integer ids so the public API stays stable
    even when services.id values differ between environments.
    """
    result = await db.execute(select(Service).where(Service.code == service_code))
    return result.scalar_one_or_none()


async def create_job_row(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    vehicle_number: Optional[str],
    service_id: int,
    status: str,
    pickup_location: object,
    pickup_address_text: Optional[str] = None,
    issue_description: Optional[str] = None,
) -> Job:
    """Stage a new jobs row and flush it so its generated id is available.

    Flush rather than commit: the matching job_status_history row has to land in
    the same transaction, so the caller owns the commit.
    """
    job = Job(
        user_id=user_id,
        vehicle_id=vehicle_id,
        vehicle_number=vehicle_number,
        service_id=service_id,
        status=status,
        pickup_location=pickup_location,
        pickup_address_text=pickup_address_text,
        issue_description=issue_description,
    )
    db.add(job)
    await db.flush()
    return job


async def create_status_history_row(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    status: str,
    note: Optional[str] = None,
) -> JobStatusHistory:
    """Stage a job_status_history row for a job that just changed state.

    changed_at is stamped by the database (now()) rather than by the API
    process, so every entry in the audit trail is on one clock.
    """
    entry = JobStatusHistory(
        job_id=job_id,
        status=status,
        changed_at=func.now(),
        note=note,
    )
    db.add(entry)
    await db.flush()
    return entry


async def get_job_by_id(db: AsyncSession, job_id: uuid.UUID) -> Optional[Job]:
    """Fetch a single job by primary key, or None when no such row exists."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()


async def get_status_history(
    db: AsyncSession, job_id: uuid.UUID
) -> Sequence[JobStatusHistory]:
    """Fetch a job's full status trail, oldest first.

    Ascending order because the caller renders it as a timeline. id is a
    secondary sort key only to keep the order stable when two transitions share
    a changed_at timestamp; it carries no meaning of its own.
    """
    result = await db.execute(
        select(JobStatusHistory)
        .where(JobStatusHistory.job_id == job_id)
        .order_by(JobStatusHistory.changed_at.asc(), JobStatusHistory.id.asc())
    )
    return result.scalars().all()


async def get_latest_assignment(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[JobAssignment]:
    """Fetch the newest job_assignments row for a job, or None if never offered.

    A job can accumulate several assignment rows as the dispatcher retries after
    rejections and timeouts. Only the most recent offer describes where the job
    stands right now, so we order by offered_at descending and take one.
    """
    result = await db.execute(
        select(JobAssignment)
        .where(JobAssignment.job_id == job_id)
        .order_by(JobAssignment.offered_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_partner_by_id(
    db: AsyncSession, partner_id: uuid.UUID
) -> Optional[Partner]:
    """Fetch a single partner by primary key, or None when no such row exists."""
    result = await db.execute(select(Partner).where(Partner.id == partner_id))
    return result.scalar_one_or_none()
