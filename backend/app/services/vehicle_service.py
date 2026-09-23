"""
Business logic for vehicle registration and lookup.

Same layering as app/services/user_service.py: the handlers in
app/api/vehicles.py stay thin, every database call goes through
app/repositories/vehicle_repository.py, and this module owns the rules, the
transaction boundary and the error mapping.

This closes the second half of the gap ADR-011 opened. Registration gave a new
owner a profile; until now there was still no way for them to register a
*vehicle*, so POST /jobs — which requires a vehicle_id the caller owns — could
only ever be driven by a row someone had inserted by hand. Every job in testing
to date used one. With these three endpoints the owner-facing path (sign up →
add a vehicle → request help → get matched) runs end to end with nothing
inserted manually.

Two decisions here are deliberate and are the kind that look like oversights
later, so both are stated in ADR-014 as well:

  * vehicle_number is normalised, not validated against a format. Indian
    registration formats vary by state, by era and by vehicle class — BH-series,
    diplomatic, military and older state formats all differ in shape — and a
    regex tight enough to be useful would reject real plates. The cost of a false
    rejection is a stranded owner who cannot register the car they are standing
    next to; the cost of a loose check is a typo in a string nothing branches on.
  * vehicle_number is NOT globally unique. Two people registering the same string
    are far more likely to be one typo than one fraud, and blocking the second
    one punishes whoever registers later for a mistake that may be the first
    one's. Genuine duplicates are an admin-review problem — the data to find them
    is all here — and not a reason to hard-fail an insert in an MVP.
"""
import logging
import time
import uuid
from typing import List

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vehicle import Vehicle
from app.repositories import vehicle_repository
from app.schemas.vehicle import VehicleCreateRequest
from app.utils.errors import BadRequestError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event

# vehicles.vehicle_number is String(20), so this is the column's real ceiling and
# not a taste judgement. Checked after normalisation because that is the string
# that actually reaches Postgres.
MAX_VEHICLE_NUMBER_LENGTH = 20

# Comfortably below the shortest real registration this has to accept — older
# short-format plates and diplomatic series still run to five or six characters.
# Its job is to catch an empty or obviously-truncated field, not to describe a
# format.
MIN_VEHICLE_NUMBER_LENGTH = 4

# Removed rather than preserved, because a plate is printed with separators and
# typed inconsistently: " KA 01 AB 1234", "KA-01-AB-1234" and "ka01ab1234" are
# one vehicle to everyone except a string comparison.
_SEPARATORS = frozenset("-–—_")


def normalise_vehicle_number(raw: str) -> str:
    """Reduce a typed registration number to the one form we store.

    Uppercased, with whitespace and separators removed. The goal is narrow and
    worth stating exactly: two people typing the same real plate differently must
    produce the same stored string. Without it, "KA01AB1234" and "ka01 ab 1234"
    are two vehicles, and an owner who registers a plate twice gets two rows and
    a picker that shows their one car twice.

    The dashes stripped include the Unicode en- and em-dash, not just ASCII
    hyphen-minus. A phone keyboard and an autocorrecting text field both produce
    them, and a stored "KA–01AB1234" would be invisibly different from the
    "KA-01AB1234" typed on a laptop.

    Validation, and the line it does not cross:

      * the result must be non-empty and within the column's width
      * the result must be ASCII alphanumeric

    The ASCII rule is not pedantry. `str.isalnum()` is Unicode-aware, so Cyrillic
    "А" and Greek "Α" pass it while looking identical to Latin "A" — which would
    reintroduce the exact duplicate this function exists to prevent, in the one
    form nobody can see by reading the data. Indian plates are Latin letters and
    digits, so requiring ASCII costs a legitimate caller nothing.

    What it deliberately does not do is check the *shape*. See the module
    docstring: a state-code-and-series regex is where an MVP starts refusing real
    vehicles it has never heard of.

    Raises:
        BadRequestError (400): nothing usable left, wrong characters, or too long.
    """
    normalised = "".join(
        character.upper()
        for character in raw
        if not character.isspace() and character not in _SEPARATORS
    )

    if len(normalised) < MIN_VEHICLE_NUMBER_LENGTH:
        raise BadRequestError(
            ErrorCode.INVALID_VEHICLE_NUMBER,
            "Enter the vehicle's registration number as it appears on the plate.",
        )

    if not (normalised.isascii() and normalised.isalnum()):
        raise BadRequestError(
            ErrorCode.INVALID_VEHICLE_NUMBER,
            "A registration number can contain only letters and numbers.",
        )

    if len(normalised) > MAX_VEHICLE_NUMBER_LENGTH:
        raise BadRequestError(
            ErrorCode.INVALID_VEHICLE_NUMBER,
            f"A registration number cannot be longer than "
            f"{MAX_VEHICLE_NUMBER_LENGTH} characters.",
        )

    return normalised


async def register_vehicle(
    db: AsyncSession, payload: VehicleCreateRequest, user_id: uuid.UUID
) -> Vehicle:
    """Register a vehicle to the caller, and return the row Postgres stored.

    user_id is a parameter rather than a field on payload for the same reason as
    in create_job: a value the client can set and a value the server established
    are different kinds of thing, and keeping them in separate arguments means no
    future edit can quietly start trusting the wrong one. VehicleCreateRequest
    has no user_id field at all, so there is nothing here to confuse it with.

    No duplicate check runs — not against this owner's other vehicles and not
    against anyone else's. Re-registering the same plate produces a second row.
    That is the documented choice (see the module docstring and ADR-014), and the
    same-owner case is included on purpose: an owner who ends up with their car
    listed twice can delete one, whereas an owner refused at registration because
    a stranger typed their plate first has no move at all.

    Raises:
        BadRequestError (400): the registration number is unusable. See
            normalise_vehicle_number.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    def _elapsed_ms() -> float:
        return round((time.perf_counter() - started) * 1000, 2)

    # Before the try block on purpose: a rejected number must not open a
    # transaction it then has to roll back.
    vehicle_number = normalise_vehicle_number(payload.vehicle_number)

    try:
        vehicle = await vehicle_repository.create_vehicle_row(
            db,
            user_id=user_id,
            vehicle_type=payload.vehicle_type,
            make=payload.make,
            model=payload.model,
            vehicle_number=vehicle_number,
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "vehicle_registered",
            level=logging.ERROR,
            actor_role="owner",
            user_id=user_id,
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=_elapsed_ms(),
        )
        raise InternalError("Could not register vehicle") from exc

    # created_at is a database default, so re-read the row to return what
    # Postgres actually stored rather than a ClauseElement this process is
    # holding in place of a timestamp.
    await db.refresh(vehicle)

    # vehicle_number is not logged. A registration number identifies a specific
    # car and, joined to the owner row two columns away, a specific person; it is
    # in _REDACTED_KEYS as a backstop, and simply not passed here as the rule.
    log_event(
        "vehicle_registered",
        vehicle_id=vehicle.id,
        user_id=user_id,
        vehicle_type=vehicle.vehicle_type,
        actor_role="owner",
        outcome="success",
        duration_ms=_elapsed_ms(),
    )
    return vehicle


async def list_user_vehicles(db: AsyncSession, user_id: uuid.UUID) -> List[Vehicle]:
    """Every vehicle the caller owns, newest first.

    An owner with none gets an empty list, and the handler returns it as an empty
    array with a 200. It is not a 404: having no vehicles yet is the state every
    single user is in between finishing signup and adding their first car, and
    calling that an error would make a client treat the most ordinary moment in
    the product as a failure — most would show an error screen where the right
    answer is the "add your first vehicle" prompt.

    Scoped by user_id from the token, so there is no ownership rule to enforce
    afterwards: a row that is not the caller's is never in the result to begin
    with. That is the difference between this and get_user_vehicle, where the
    caller names the id and the check has to be explicit.
    """
    return await vehicle_repository.list_vehicles_for_user(db, user_id)


async def get_user_vehicle(
    db: AsyncSession, vehicle_id: uuid.UUID, user_id: uuid.UUID
) -> Vehicle:
    """One vehicle, provided it belongs to the caller.

    Missing and not-yours return exactly the same 404 with the same message. That
    is the anti-enumeration precedent already set by GET /jobs/{job_id} and by
    create_job's vehicle check, and it is followed here rather than re-argued:
    a 403 that only appears for ids that exist turns this endpoint into an
    existence oracle, and someone walking UUIDs could use it to count the
    platform's vehicles. A client has no use for the distinction either — the
    remedy is the same both times.

    The two cases are still distinguished in the log, where the reader is us.

    Raises:
        NotFoundError (404): no such vehicle, or it is not the caller's.
    """
    vehicle = await vehicle_repository.get_vehicle_by_id(db, vehicle_id)

    if vehicle is None or vehicle.user_id != user_id:
        log_event(
            "vehicle_fetched",
            level=logging.WARNING,
            actor_role="owner",
            user_id=user_id,
            vehicle_id=vehicle_id,
            outcome=(
                "rejected_vehicle_not_found"
                if vehicle is None
                else "rejected_not_owner"
            ),
        )
        raise NotFoundError(ErrorCode.VEHICLE_NOT_FOUND, "Vehicle not found")

    return vehicle
