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
from app.services.auth_service import Identity
from app.utils.errors import BadRequestError, ErrorCode, InternalError, NotFoundError
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


async def create_job(
    db: AsyncSession, payload: JobCreateRequest, user_id: uuid.UUID
) -> Job:
    """Create a job in 'requested' state and open its status audit trail.

    user_id is a parameter rather than a field on payload because it comes from
    the caller's verified token, not from the request body. That separation is
    the point: a value the client can set and a value the server established are
    different kinds of thing, and keeping them in different arguments means no
    future edit can quietly start trusting the wrong one.

    Steps, in order, because each one guards the next:
      1. The vehicle must exist *and* belong to the requesting user. With
         user_id now authenticated, this is a real ownership check rather than a
         consistency check between two client-supplied ids.
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

    Once they are durable, dispatch is triggered automatically: the job is
    normally already in 'matching' with one offer outstanding by the time this
    returns. That happens *after* the commit and inside a guard — see
    _try_dispatch for why a dispatch failure must not fail this call.

    Raises:
        NotFoundError (404): vehicle missing, or not owned by this user.
        BadRequestError (400): unknown service_code.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    vehicle = await job_repository.get_vehicle_by_id(db, payload.vehicle_id)
    if vehicle is None or vehicle.user_id != user_id:
        # One message for both cases on purpose: telling a caller "that vehicle
        # exists but isn't yours" would leak the existence of other users' rows.
        log_event(
            "job_created",
            level=logging.WARNING,
            actor_role="owner",
            outcome="rejected_vehicle_not_found",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise NotFoundError(ErrorCode.VEHICLE_NOT_FOUND, "Vehicle not found for this user")

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
        raise BadRequestError(ErrorCode.INVALID_SERVICE_CODE, "Invalid service_code")

    pickup_location = _build_pickup_point(payload.pickup_lat, payload.pickup_lng)

    try:
        job = await job_repository.create_job_row(
            db,
            user_id=user_id,
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

    await _try_dispatch(db, job)
    return job


async def _try_dispatch(db: AsyncSession, job: Job) -> None:
    """Start matching for a freshly created job, without risking the job itself.

    Dispatch runs the moment a job exists — a stranded driver should not need a
    second API call, and no client should be able to create a job and then
    neglect to ask for help with it.

    Three things about *how* this is called matter more than that it is:

      * **After the commit, not inside it.** The job and its history row are
        already durable before a candidate search is attempted. A search touches
        Redis and runs several more queries; folding it into the creation
        transaction would hold that transaction open across a network call to a
        different system, and a Redis timeout would roll back a job that was
        perfectly valid.

      * **Guarded.** Any failure in dispatch is logged at ERROR and swallowed.
        The POST genuinely succeeded: the job exists, is 'requested', and is
        visible in the timeline. Returning a 500 for it would tell the driver
        their request failed when it did not, and — worse — invite a retry that
        creates a duplicate job for one breakdown. A job stuck in 'requested'
        is recoverable by re-running dispatch; a driver who gave up because they
        saw an error is not.

      * **The status is left alone on failure.** 'requested' is exactly what the
        job is: nobody has been asked yet. Marking it 'no_match_found' would
        conflate "we looked and there was nobody" with "we never got to look",
        and those need different responses from ops.

    The obvious next step, once there is a worker to run it, is a sweep that
    re-dispatches jobs left in 'requested' past some age. That is deliberately
    not built here — it is a background job, and this task is synchronous
    dispatch only.
    """
    # Imported here rather than at module scope: dispatch_service imports
    # job_repository and its own models, and a top-level import in both
    # directions would be a cycle the first time either module is loaded.
    from app.services import dispatch_service

    try:
        await dispatch_service.dispatch_job(db, job.id)
    except Exception as exc:  # noqa: BLE001 - see docstring: never fail the POST
        log_event(
            "dispatch_after_create_failed",
            level=logging.ERROR,
            job_id=job.id,
            job_status=job.status,
            error_type=type(exc).__name__,
            outcome="failure",
        )

    # The job may have moved to 'matching' or 'no_match_found', and the caller is
    # about to serialise it. Refresh so the response reports the status the
    # database holds rather than the one loaded before dispatch ran.
    try:
        await db.refresh(job)
    except SQLAlchemyError:
        pass


async def get_job_with_status(
    db: AsyncSession, job_id: uuid.UUID, identity: Identity
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

    Contact details are released to two callers and withheld from everyone else:

      * the job's owner, who needs to phone the mechanic coming to them;
      * the assigned partner, for whom name and phone are their *own* details,
        so withholding them would protect nobody.

    Any other authenticated caller gets a 200 with the job, but with the
    assignment reduced to `status` and `estimated_arrival_min`. A 404 or 403
    would be the tidier-looking choice and the wrong one: a partner legitimately
    polling a job they are about to be offered, or one they were just unassigned
    from, is not an error case, and turning it into one would make the client
    handle a failure that is really a visibility rule.

    Raises:
        NotFoundError (404): no job with this id.
    """
    job = await job_repository.get_job_by_id(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    is_owner = identity.role == "user" and identity.local_id == job.user_id

    current_assignment = None
    assignment = await job_repository.get_latest_assignment(db, job.id)
    if assignment is not None:
        is_assigned_partner = (
            identity.role == "partner"
            and assignment.partner_id is not None
            and identity.local_id == assignment.partner_id
        )
        may_see_contact_details = is_owner or is_assigned_partner

        # partner_id is nullable on job_assignments, so an offer can exist
        # without a resolvable partner; the partner fields then stay None
        # rather than failing the whole read.
        partner = None
        if may_see_contact_details and assignment.partner_id is not None:
            partner = await job_repository.get_partner_by_id(
                db, assignment.partner_id
            )

        current_assignment = CurrentAssignmentResponse(
            status=assignment.status,
            # partner_id is withheld along with the rest. On its own it is only
            # an opaque uuid, but it is the lookup key for every partner-scoped
            # route, so handing it to an unrelated caller would undo the point
            # of hiding the name and number.
            partner_id=assignment.partner_id if may_see_contact_details else None,
            partner_name=partner.name if partner else None,
            partner_phone=partner.phone if partner else None,
            partner_rating=partner.rating_avg if partner else None,
            # Kept for everyone: an ETA says when, never who.
            estimated_arrival_min=assignment.estimated_arrival_min,
        )

        if not may_see_contact_details:
            log_event(
                "job_contact_details_withheld",
                job_id=str(job.id),
                actor_role=identity.role,
                outcome="redacted",
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
