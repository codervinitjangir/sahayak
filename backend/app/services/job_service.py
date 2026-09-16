"""
Business logic for creating and reading roadside-assistance jobs.

The route handlers in app/api/jobs.py stay thin — they validate the request body
and delegate here. This module owns the rules (does this vehicle belong to this
user? is this service code real?), the transaction boundary, and the assembly of
the read model. Every database call goes through app/repositories/job_repository.
"""
import logging
import time
import uuid

from geoalchemy2 import WKTElement
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.repositories import job_repository
from app.schemas.job import (
    CurrentAssignmentResponse,
    JobCreateRequest,
    JobDetailResponse,
    JobTimelineEntry,
)
from app.utils.errors import BadRequestError, InternalError, NotFoundError
from app.utils.logging import log_event

# The status every job starts in; dispatch moves it on from here.
INITIAL_JOB_STATUS = "requested"


def _build_pickup_point(latitude: float, longitude: float) -> WKTElement:
    """Turn a lat/lng pair into a PostGIS geography POINT (SRID 4326).

    Note the argument order in the WKT: PostGIS reads a point as "POINT(x y)",
    i.e. longitude first, then latitude — the reverse of how humans and phone
    GPS APIs quote coordinates. Getting this backwards silently places the job
    in the wrong hemisphere, so it lives in one place instead of inline.
    """
    return WKTElement(f"POINT({longitude} {latitude})", srid=4326)


async def create_job(db: AsyncSession, payload: JobCreateRequest) -> Job:
    """Create a job in 'requested' state and open its status audit trail.

    Steps, in order, because each one guards the next:
      1. The vehicle must exist *and* belong to the requesting user. Checking
         ownership (not just existence) stops a caller from raising a job
         against somebody else's vehicle by guessing an id.
      2. The service_code must resolve to a services row, which gives us the
         service_id actually stored on the job.
      3. vehicle_number is copied onto the job rather than read through the
         vehicle_id foreign key. This is an intentional snapshot: a partner
         arriving on scene needs the plate as it was when the job was raised,
         and the job history has to stay truthful even if the owner later edits
         or deletes the vehicle record.
      4. A job_status_history row is written in the same transaction. The audit
         trail starts at creation rather than at the first *change*, so
         "how long did this job sit in requested?" is answerable from history
         alone, with no special case for the initial state.

    Both inserts commit together — a job with no history row, or a history row
    with no job, would both be corrupt states.

    SECURITY TODO (auth task): payload.user_id is currently supplied by the
    caller, so the API trusts the client's claim about who it is. The ownership
    check in step 1 limits the damage — an impersonator needs a vehicle id that
    genuinely belongs to the user being impersonated — but once authentication
    lands, user_id must come from the verified token and be dropped from the
    request body entirely. Client-supplied identity must never decide access.

    Raises:
        NotFoundError (404): vehicle missing, or not owned by this user.
        BadRequestError (400): unknown service_code.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    vehicle = await job_repository.get_vehicle_by_id(db, payload.vehicle_id)
    if vehicle is None or vehicle.user_id != payload.user_id:
        # One message for both cases on purpose: telling a caller "that vehicle
        # exists but isn't yours" would leak the existence of other users' rows.
        log_event(
            "job_created",
            level=logging.WARNING,
            actor_role="owner",
            outcome="rejected_vehicle_not_found",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise NotFoundError("VEHICLE_NOT_FOUND", "Vehicle not found for this user")

    service = await job_repository.get_service_by_code(db, payload.service_code)
    if service is None:
        log_event(
            "job_created",
            level=logging.WARNING,
            actor_role="owner",
            service_code=payload.service_code,
            outcome="rejected_invalid_service_code",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise BadRequestError("INVALID_SERVICE_CODE", "Invalid service_code")

    pickup_location = _build_pickup_point(payload.pickup_lat, payload.pickup_lng)

    try:
        job = await job_repository.create_job_row(
            db,
            user_id=payload.user_id,
            vehicle_id=vehicle.id,
            vehicle_number=vehicle.vehicle_number,
            service_id=service.id,
            status=INITIAL_JOB_STATUS,
            pickup_location=pickup_location,
            pickup_address_text=payload.pickup_address_text,
            issue_description=payload.issue_description,
        )
        await job_repository.create_status_history_row(
            db,
            job_id=job.id,
            status=INITIAL_JOB_STATUS,
            note="Job created",
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "job_created",
            level=logging.ERROR,
            actor_role="owner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not create job") from exc

    # requested_at is a database default (now()), so re-read the row to return
    # the value Postgres actually stored instead of an unloaded attribute.
    await db.refresh(job)

    # Deliberately no coordinates here: the log store is not the place for a
    # stranded person's exact position. See app/utils/logging.py.
    log_event(
        "job_created",
        job_id=job.id,
        user_id=job.user_id,
        service_code=payload.service_code,
        status=job.status,
        actor_role="owner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return job


async def get_job_with_status(
    db: AsyncSession, job_id: uuid.UUID
) -> JobDetailResponse:
    """Read one job together with its current assignment and status timeline.

    This is the endpoint a tracking screen polls, so it answers every question a
    waiting driver has in a single response: what state is my job in, has anyone
    been sent, and how did it get here. The assignment is looked up separately
    (newest offer first) and merged with the partner's contact details, which is
    why the return value is an assembled JobDetailResponse and not the raw jobs
    row — the client should not have to know that "who is coming" lives in two
    other tables and "what happened so far" in a third.

    current_assignment is None when the dispatcher has not offered the job yet.
    Nothing here writes to job_assignments; matching is a separate concern.

    SECURITY TODO (auth task): this returns the assigned partner's name and
    phone number to anyone who knows the job id. A random UUID is not hard to
    guess, but it is not authorization either — once authentication lands, this
    must verify the caller owns the job (or is the assigned partner, or an
    admin) before releasing contact details.

    Raises:
        NotFoundError (404): no job with this id.
    """
    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError("JOB_NOT_FOUND", "Job not found")

    current_assignment = None
    assignment = await job_repository.get_latest_assignment(db, job.id)
    if assignment is not None:
        # partner_id is nullable on job_assignments, so an offer can exist
        # without a resolvable partner; the partner fields then stay None
        # rather than failing the whole read.
        partner = None
        if assignment.partner_id is not None:
            partner = await job_repository.get_partner_by_id(
                db, assignment.partner_id
            )

        current_assignment = CurrentAssignmentResponse(
            status=assignment.status,
            partner_id=assignment.partner_id,
            partner_name=partner.name if partner else None,
            partner_phone=partner.phone if partner else None,
            partner_rating=partner.rating_avg if partner else None,
            estimated_arrival_min=assignment.estimated_arrival_min,
        )

    history = await job_repository.get_status_history(db, job.id)

    return JobDetailResponse(
        id=job.id,
        status=job.status,
        service_id=job.service_id,
        vehicle_number=job.vehicle_number,
        pickup_address_text=job.pickup_address_text,
        issue_description=job.issue_description,
        price_estimate=job.price_estimate,
        price_final=job.price_final,
        requested_at=job.requested_at,
        completed_at=job.completed_at,
        current_assignment=current_assignment,
        timeline=[JobTimelineEntry.model_validate(entry) for entry in history],
    )
