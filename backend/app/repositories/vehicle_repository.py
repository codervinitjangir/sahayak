"""
Data-access layer for a vehicle owner's own vehicles.

Same contract as every other repository here: this module only talks to the
database and returns ORM objects, rows, lists or None. It raises no HTTP errors
and never commits — deciding what a missing row *means*, and where the
transaction boundary sits, belongs to app/services/vehicle_service.py.

get_vehicle_by_id lived in app/repositories/job_repository.py until this module
existed, because job creation was the only thing that had ever needed to read a
vehicle. It moved here rather than being copied: two functions running the same
SELECT is how the two drift, and the job flow's ownership check and this
feature's 404 must agree about what "this vehicle" means or the same id answers
differently depending on which endpoint is asked.
"""
import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vehicle import Vehicle


async def get_vehicle_by_id(
    db: AsyncSession, vehicle_id: uuid.UUID
) -> Optional[Vehicle]:
    """Fetch a single vehicle by primary key, or None when no such row exists.

    Deliberately not filtered by owner. Ownership is a *rule*, and the callers
    enforce it differently: job creation refuses a vehicle that is not the
    requester's, while a future admin view would not. Baking the filter in here
    would leave the service unable to tell "no such vehicle" from "not yours",
    which is exactly the distinction its logging needs even where its response
    deliberately collapses the two.
    """
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    return result.scalar_one_or_none()


async def list_vehicles_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> List[Vehicle]:
    """Every vehicle belonging to one owner, newest first.

    Newest first because the list feeds a "which vehicle needs help?" picker, and
    the vehicle someone just added is overwhelmingly the one they are about to
    select — a new owner's first action after registering a car is to request
    help for it.

    id descending is a tie-break, not decoration. created_at defaults to now(),
    which in Postgres is *transaction start* time, so two rows written by
    overlapping transactions can carry the same timestamp; without a second key
    the order between them would be whatever the planner felt like that day, and
    a paginated version of this endpoint would then be able to skip or repeat a
    row. A total order costs one clause now and avoids that class of bug later.

    Returns an empty list when the owner has none. That is a normal state, not an
    error — see list_user_vehicles.
    """
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.user_id == user_id)
        .order_by(Vehicle.created_at.desc(), Vehicle.id.desc())
    )
    return list(result.scalars().all())


async def create_vehicle_row(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    vehicle_type: str,
    make: Optional[str],
    model: Optional[str],
    vehicle_number: str,
) -> Vehicle:
    """Stage a new vehicles row and flush it so its generated id is available.

    vehicle_number arrives already normalised — this layer stores what it is
    given and does not reformat it. Normalisation is a rule about what two
    strings mean, which is service business; a repository that quietly rewrote
    its input would make the value read back differ from the value written with
    no visible reason in the caller.

    user_id is keyword-only and required, even though the column is nullable. The
    column permits an orphan vehicle for rows that arrived by other routes; this
    function will not create one, because a vehicle nobody owns cannot be
    listed, fetched or used for a job, and would simply be litter.

    created_at is left to the column default so Postgres, not this process,
    decides what "now" means.
    """
    vehicle = Vehicle(
        user_id=user_id,
        vehicle_type=vehicle_type,
        make=make,
        model=model,
        vehicle_number=vehicle_number,
    )
    db.add(vehicle)
    await db.flush()
    return vehicle
