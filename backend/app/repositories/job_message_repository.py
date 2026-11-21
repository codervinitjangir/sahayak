"""SQL for job chat (ADR-058). flush(), never commit()."""
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_message import JobMessage

PAGE_LIMIT = 200


async def add_message(db: AsyncSession, *, job_id: uuid.UUID, sender_type: str,
                      sender_id: uuid.UUID, body: str) -> JobMessage:
    row = JobMessage(job_id=job_id, sender_type=sender_type, sender_id=sender_id, body=body)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def list_messages(db: AsyncSession, job_id: uuid.UUID,
                        after: Optional[datetime] = None) -> Sequence[JobMessage]:
    q = select(JobMessage).where(JobMessage.job_id == job_id)
    if after is not None:
        q = q.where(JobMessage.created_at > after)
    q = q.order_by(JobMessage.created_at.asc()).limit(PAGE_LIMIT)
    return (await db.execute(q)).scalars().all()


async def last_message(db: AsyncSession, job_id: uuid.UUID) -> Optional[JobMessage]:
    q = (select(JobMessage).where(JobMessage.job_id == job_id)
         .order_by(JobMessage.created_at.desc()).limit(1))
    return (await db.execute(q)).scalars().first()
