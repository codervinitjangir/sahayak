"""
Data-access layer for vehicle-owner registration.

Same contract as app/repositories/partner_repository.py: everything here only
talks to the database and returns ORM objects, rows or None. It deliberately
does not raise HTTP errors and does not commit — deciding what a missing row
*means*, and where the transaction boundary sits, belongs to
app/services/user_service.py.

Kept separate from app/repositories/auth_repository.py even though both touch
the `users` table. That module exists for one narrow job — resolving a Supabase
`sub` to a local row on every authenticated request — and its lookups are keyed
on auth_user_id. Registration is a different question asked of the same table
("is this person already on the platform?", keyed on phone), and it belongs with
the feature it serves rather than inside the auth join.
"""
import uuid
from typing import Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatusHistory
from app.models.notification import Notification
from app.models.payment import Payment
from app.models.rating import Rating
from app.models.user import User
from app.models.vehicle import Vehicle

# Job statuses during which an owner may not delete their account: someone is
# on the way, or the search is still running.
ACTIVE_JOB_STATUSES = ("requested", "matching", "assigned", "partner_en_route", "in_progress")


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    """Fetch a vehicle owner by primary key, or None when no such row exists.

    Used by the job read path to release the owner's name and phone to the
    assigned partner. The token only carries the owner's local id; the contact
    details live on this row.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_phone(db: AsyncSession, phone: str) -> Optional[User]:
    """Look up a vehicle owner by phone number, which is unique in the schema.

    Used to answer "is this person already registered?" before attempting an
    insert, so the caller can return a meaningful error instead of letting a
    unique-constraint violation surface. Mirrors
    partner_repository.get_partner_by_phone.
    """
    result = await db.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """Look up a vehicle owner by email, which is also unique in the schema.

    Separate from the phone lookup because email is optional at registration:
    there is nothing to check when it was not supplied, and querying for NULL
    would match every row that never provided one.
    """
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user_row(
    db: AsyncSession,
    *,
    name: str,
    phone: str,
    email: Optional[str],
    phone_verified: bool,
    auth_user_id: uuid.UUID,
) -> User:
    """Stage a new users row and flush it so its generated id is available.

    auth_user_id is written in the same INSERT as the rest of the profile rather
    than by a follow-up UPDATE. That is what makes registration a single
    round-trip and, more importantly, atomic: there is no window in which a
    users row exists with no owner, which is exactly the state that would be
    left behind if the link call were separate and the client crashed between
    the two.

    created_at is left to the column default so Postgres, not this process,
    decides what "now" means.
    """
    user = User(
        name=name,
        phone=phone,
        email=email,
        phone_verified=phone_verified,
        auth_user_id=auth_user_id,
    )
    db.add(user)
    await db.flush()
    return user


async def update_user_fields(db: AsyncSession, user: User, **fields: object) -> User:
    for key, value in fields.items():
        setattr(user, key, value)
    await db.flush()
    return user


async def count_active_jobs(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count(Job.id)).where(Job.user_id == user_id).where(Job.status.in_(ACTIVE_JOB_STATUSES))
    )
    return int(result.scalar_one() or 0)


async def export_rows(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Everything stored about one owner, as ORM objects, for the data export."""
    vehicles = (await db.execute(select(Vehicle).where(Vehicle.user_id == user_id))).scalars().all()
    jobs = (await db.execute(
        select(Job).where(Job.user_id == user_id).order_by(Job.requested_at.desc())
    )).scalars().all()
    job_ids = [j.id for j in jobs]
    history = payments = ratings = []
    if job_ids:
        history = (await db.execute(
            select(JobStatusHistory).where(JobStatusHistory.job_id.in_(job_ids))
            .order_by(JobStatusHistory.changed_at, JobStatusHistory.id)
        )).scalars().all()
        payments = (await db.execute(select(Payment).where(Payment.job_id.in_(job_ids)))).scalars().all()
        ratings = (await db.execute(select(Rating).where(Rating.job_id.in_(job_ids)))).scalars().all()
    notifications = (await db.execute(
        select(Notification).where(Notification.recipient_type == "user")
        .where(Notification.recipient_id == user_id).order_by(Notification.sent_at.desc())
    )).scalars().all()
    from app.models.care import CareMembership
    care = (await db.execute(
        select(CareMembership).where(CareMembership.user_id == user_id).order_by(CareMembership.starts_at.desc())
    )).scalars().all()
    return {
        "vehicles": vehicles, "jobs": jobs, "history": history,
        "payments": payments, "ratings": ratings, "notifications": notifications,
        "care_memberships": care,
    }


async def erase_owner_data(db: AsyncSession, user_id: uuid.UUID) -> None:
    """The deletes and scrubs behind account deletion (ADR-025). Flush only.

    Jobs stay (partners' earnings and payments point at them) but lose the
    owner's free text; vehicles go (jobs keep their own vehicle_number); the
    owner's notifications go.
    """
    await db.execute(
        update(Job).where(Job.user_id == user_id)
        .values(pickup_address_text=None, issue_description=None, vehicle_id=None)
    )
    # The owner's own words about a partner. The score stays (it is part of the
    # partner's average, ADR-018); the free text, which can name the owner, goes.
    await db.execute(
        update(Rating).where(Rating.rated_by == "user")
        .where(Rating.job_id.in_(select(Job.id).where(Job.user_id == user_id)))
        .values(comment=None)
    )
    await db.execute(delete(Vehicle).where(Vehicle.user_id == user_id))
    await db.execute(
        delete(Notification).where(Notification.recipient_type == "user").where(Notification.recipient_id == user_id)
    )
    # ADR-045: a deleted owner's devices are not told anything again.
    from app.models.device_push_token import DevicePushToken
    await db.execute(
        delete(DevicePushToken).where(DevicePushToken.owner_type == "user").where(DevicePushToken.owner_id == user_id)
    )
