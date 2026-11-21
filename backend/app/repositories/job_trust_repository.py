"""SQL for price revisions (ADR-039) and towing photos (ADR-042). Flush only."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_trust import JobPhoto, JobPriceRevision


# --- price revisions -------------------------------------------------------------

async def add_revision(
    db: AsyncSession, *, job_id: uuid.UUID, partner_id: uuid.UUID, amount: Decimal, reason: str
) -> JobPriceRevision:
    row = JobPriceRevision(job_id=job_id, partner_id=partner_id, proposed_amount=amount,
                           reason=reason, status="pending")
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def list_revisions(db: AsyncSession, job_id: uuid.UUID) -> list[JobPriceRevision]:
    result = await db.execute(
        select(JobPriceRevision).where(JobPriceRevision.job_id == job_id)
        .order_by(JobPriceRevision.created_at, JobPriceRevision.id)
    )
    return list(result.scalars().all())


async def get_revision(db: AsyncSession, job_id: uuid.UUID, revision_id: uuid.UUID) -> Optional[JobPriceRevision]:
    result = await db.execute(
        select(JobPriceRevision).where(JobPriceRevision.id == revision_id, JobPriceRevision.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def highest_approved(db: AsyncSession, job_id: uuid.UUID) -> Optional[Decimal]:
    result = await db.execute(
        select(func.max(JobPriceRevision.proposed_amount))
        .where(JobPriceRevision.job_id == job_id, JobPriceRevision.status == "approved")
    )
    return result.scalar_one_or_none()


async def set_revision_status(db: AsyncSession, row: JobPriceRevision, status: str) -> None:
    row.status = status
    row.decided_at = datetime.now(timezone.utc)
    await db.flush()


async def withdraw_pending(db: AsyncSession, job_id: uuid.UUID) -> int:
    result = await db.execute(
        update(JobPriceRevision)
        .where(JobPriceRevision.job_id == job_id, JobPriceRevision.status == "pending")
        .values(status="withdrawn", decided_at=func.now())
    )
    await db.flush()
    return result.rowcount or 0


# --- photos ----------------------------------------------------------------------

async def add_photo(db: AsyncSession, *, id: uuid.UUID, job_id: uuid.UUID, partner_id: Optional[uuid.UUID],
                    stage: str, content_type: str, user_id: Optional[uuid.UUID] = None) -> JobPhoto:
    row = JobPhoto(id=id, job_id=job_id, partner_id=partner_id, user_id=user_id, stage=stage,
                   content_type=content_type)
    db.add(row)
    await db.flush()
    return row


async def get_photo(db: AsyncSession, job_id: uuid.UUID, photo_id: uuid.UUID) -> Optional[JobPhoto]:
    result = await db.execute(select(JobPhoto).where(JobPhoto.id == photo_id, JobPhoto.job_id == job_id))
    return result.scalar_one_or_none()


async def list_photos(db: AsyncSession, job_id: uuid.UUID) -> list[JobPhoto]:
    result = await db.execute(
        select(JobPhoto).where(JobPhoto.job_id == job_id, JobPhoto.file_url.is_not(None))
        .order_by(JobPhoto.uploaded_at, JobPhoto.id)
    )
    return list(result.scalars().all())


async def confirmed_stages(db: AsyncSession, job_id: uuid.UUID) -> set[str]:
    result = await db.execute(
        select(JobPhoto.stage).where(JobPhoto.job_id == job_id, JobPhoto.file_url.is_not(None)).distinct()
    )
    return set(result.scalars().all())


async def count_issue_photos(db: AsyncSession, job_id: uuid.UUID) -> tuple[int, int]:
    """(confirmed, all rows) of the owner's 'issue' photos on a job (ADR-055)."""
    rows = (await db.execute(
        select(JobPhoto.file_url).where(JobPhoto.job_id == job_id, JobPhoto.stage == "issue")
    )).scalars().all()
    return sum(1 for r in rows if r is not None), len(rows)


async def photos_past_retention(db: AsyncSession, *, ended_before: datetime,
                                abandoned_before: datetime, limit: int = 200) -> list[JobPhoto]:
    """Photos due for deletion (ADR-055): every photo of a job that ended before
    `ended_before` and has no open dispute, plus uploads never confirmed since
    `abandoned_before`."""
    from sqlalchemy import and_, exists, or_
    from app.models.dispute import JobDispute
    from app.models.job import Job

    ended = func.coalesce(Job.completed_at, Job.cancelled_at)
    open_dispute = exists().where(JobDispute.job_id == JobPhoto.job_id, JobDispute.status == "open")
    query = (
        select(JobPhoto).join(Job, Job.id == JobPhoto.job_id)
        .where(or_(
            and_(Job.status.in_(("completed", "cancelled")), ended < ended_before, ~open_dispute),
            and_(JobPhoto.file_url.is_(None), JobPhoto.created_at < abandoned_before),
        ))
        .order_by(JobPhoto.created_at).limit(limit)
    )
    return list((await db.execute(query)).scalars().all())


async def delete_photo_rows(db: AsyncSession, ids: list[uuid.UUID]) -> None:
    from sqlalchemy import delete
    if ids:
        await db.execute(delete(JobPhoto).where(JobPhoto.id.in_(ids)))

