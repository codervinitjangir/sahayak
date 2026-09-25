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
from typing import Optional

from geoalchemy2 import WKTElement
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.repositories import job_repository, vehicle_repository
from app.schemas.job import (
    CurrentAssignmentResponse,
    JobCancelRequest,
    JobCancelResponse,
    JobCreateRequest,
    JobDetailResponse,
    JobStatusTransitionRequest,
    JobStatusTransitionResponse,
    JobTimelineEntry,
)
from app.services.auth_service import Identity
from app.utils.errors import (
    BadRequestError,
    ConflictError,
    DispatchUnavailableError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event

# The status every job starts in; dispatch moves it on from here.
INITIAL_JOB_STATUS = "requested"

# Which statuses are reachable from which, for a partner working a job.
#
# A map rather than a chain of ifs because the legal moves *are* data, and
# written this way the whole policy is auditable in eight lines instead of
# being spread across branches. It is also the thing a reviewer will want to
# read first, so it should not have to be reconstructed from control flow.
#
# Two properties are deliberate:
#
#   * Every active state can reach 'cancelled'. A driver whose car started on
#     its own, or a mechanic who arrives to find the vehicle already towed,
#     happens at every point in the job. Allowing cancellation only at the
#     start would leave those jobs to sit 'in_progress' forever, which is both
#     a wrong record and — because active jobs count against a partner's load —
#     a partner who slowly stops receiving work.
#
#   * 'completed' and 'cancelled' map to nothing. They are terminal: a finished
#     job that can be reopened is a finished job whose price, completion time
#     and audit trail can all be rewritten after the fact. If a job genuinely
#     needs to resume, the honest representation is a new job that references
#     the old one, not a resurrection that erases what the timeline said.
#
# Statuses the *server* owns ('requested', 'matching', 'assigned',
# 'no_match_found') appear only as sources, never as targets. Dispatch writes
# those; a partner reaching one would be rewinding a job.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "requested": frozenset(),
    "matching": frozenset(),
    "assigned": frozenset({"partner_en_route", "cancelled"}),
    "partner_en_route": frozenset({"in_progress", "cancelled"}),
    "in_progress": frozenset({"completed", "cancelled"}),
    "no_match_found": frozenset(),
    "completed": frozenset(),
    "cancelled": frozenset(),
}

# What the accepted job_assignments row becomes when a job reaches a terminal
# state. Anything not listed leaves the assignment at 'accepted', which is
# correct for the intermediate moves: the partner is still on the job.
#
# 'cancelled' is a status added by db/migrations/003 specifically for this,
# rather than reusing 'rejected'. See ADR-012 — in short, 'rejected' is the
# partner's answer to an offer and feeds acceptance rate, so recording a
# customer's cancellation as a rejection would quietly charge the partner for
# somebody else's decision, in a metric that may later drive ranking or pay.
TERMINAL_ASSIGNMENT_STATUS: dict[str, str] = {
    "completed": "completed",
    "cancelled": "cancelled",
}

# The statuses that mean a job is over, for the purpose of owner cancellation.
#
# Note what is *not* here: 'no_match_found'. ALLOWED_TRANSITIONS gives it an
# empty set, so it looks terminal, and for a partner it is — nobody was ever
# assigned, so no partner has standing to move it. The owner's question is a
# different one. A job that found nobody is not a finished job; it is a request
# that was never served, and from the owner's side it is still open. Refusing
# to cancel it would leave a driver who has given up and called a tow truck
# with a booking they cannot clear, and would leave a row that the re-dispatch
# sweep (when it exists) would keep picking up.
#
# Nothing is lost by allowing it: job_status_history keeps the
# 'no_match_found' entry, so the timeline still records that the search failed
# before the owner walked away. The two facts stay distinguishable, which is
# the only thing that would have argued for refusing.
#
# A separate constant rather than `ALLOWED_TRANSITIONS[s] == frozenset()`
# precisely because the two rules disagree on that status, and deriving one
# from the other would silently make them agree the next time either changes.
TERMINAL_JOB_STATUSES: frozenset[str] = frozenset({"completed", "cancelled"})


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

    vehicle = await vehicle_repository.get_vehicle_by_id(db, payload.vehicle_id)
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

      * **The status is left alone on failure — with one exception.** For most
        faults 'requested' is exactly what the job is: nobody has been asked yet,
        and marking it 'no_match_found' would conflate "we looked and there was
        nobody" with "we never got to look". The exception is the fault where
        *nothing will ever look again*: if the location store is unreachable
        there is no worker to come back, so the job would sit in 'requested'
        forever with a live-looking card in the driver's app and no signal
        anywhere that their request had been dropped. That case is recorded — see
        dispatch_service.mark_dispatch_unavailable, and ADR-016 for why it shares
        a status with "nobody available" while staying distinguishable in the
        timeline.

    The obvious next step, once there is a worker to run it, is a sweep that
    re-dispatches jobs left in 'requested' past some age. That is deliberately
    not built here — it is a background job, and this task is synchronous
    dispatch only. Note that nothing below retries: a retry inside the request
    would block the driver's POST on a dependency that has just timed out.
    """
    # Imported here rather than at module scope: dispatch_service imports
    # job_repository and its own models, and a top-level import in both
    # directions would be a cycle the first time either module is loaded.
    from app.services import dispatch_service

    try:
        await dispatch_service.dispatch_job(db, job.id)
    except DispatchUnavailableError as exc:
        log_event(
            "dispatch_after_create_failed",
            level=logging.ERROR,
            job_id=job.id,
            job_status=job.status,
            error_type=type(exc).__name__,
            reason="location_store_unavailable",
            outcome="failure",
        )
        # Guarded in its own right: this is recovery from a failure, and a
        # failure in the recovery must still not fail the POST. Worst case the
        # job stays in 'requested', which is where it was a moment ago.
        try:
            await dispatch_service.mark_dispatch_unavailable(db, job.id)
        except Exception:  # noqa: BLE001 - see docstring: never fail the POST
            log_event(
                "dispatch_unavailable_not_recorded",
                level=logging.ERROR,
                job_id=job.id,
                outcome="failure",
            )
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


# job_status_history has no actor column, so a row reading 'cancelled' cannot
# by itself say whether the customer called the job off or the mechanic did —
# which is the single most useful thing to know about a cancellation, and the
# difference between a refund conversation and a reliability problem.
#
# Adding `changed_by_role` is the real fix and is deliberately not done here:
# it is a schema change plus a backfill decision for existing rows, and this
# task is an endpoint. Until then the note carries the actor, written by one
# helper used on both paths so the two spellings cannot drift apart and leave
# the column unqueryable. See ADR-013.
def _cancellation_note(actor: str, reason: Optional[str]) -> str:
    """The job_status_history note for a cancellation, always naming the actor."""
    prefix = f"Cancelled by {actor}"
    return f"{prefix}: {reason}" if reason else prefix


def _check_body_applies(payload: JobStatusTransitionRequest) -> None:
    """Reject a body whose optional fields do not belong to the target status.

    Two rules, both refusals rather than quiet drops:

      * completing a job requires price_final. Its absence cannot be a
        schema-level "required" without forcing a price onto every other
        transition, so it is checked here — and the specified failure is a 400
        with a branchable code, which a Pydantic model_validator could not
        produce (it raises 422 VALIDATION_ERROR).

      * a field that belongs to a *different* transition is an error, not
        noise. A price sent with 'in_progress' means the client has the wrong
        endpoint state in mind; accepting it and discarding it is how a
        completed job ends up with a null price, a 200 in the client's log,
        and nothing anywhere saying why.
    """
    if payload.status == "completed" and payload.price_final is None:
        raise BadRequestError(
            ErrorCode.PRICE_FINAL_REQUIRED,
            "price_final is required when completing a job",
        )
    if payload.status != "completed" and payload.price_final is not None:
        raise BadRequestError(
            ErrorCode.FIELD_NOT_APPLICABLE,
            "price_final may only be sent when status is 'completed'",
        )
    if payload.status != "cancelled" and payload.cancellation_reason is not None:
        raise BadRequestError(
            ErrorCode.FIELD_NOT_APPLICABLE,
            "cancellation_reason may only be sent when status is 'cancelled'",
        )


async def transition_job_status(
    db: AsyncSession,
    job_id: uuid.UUID,
    payload: JobStatusTransitionRequest,
    partner_id: uuid.UUID,
) -> JobStatusTransitionResponse:
    """Move a job through its remaining lifecycle on behalf of the assigned partner.

    This is the half of the job lifecycle that did not exist until now. Dispatch
    could get a job as far as 'assigned' and no further, which meant — because a
    partner's load is counted from their active jobs — that accepting one offer
    left a partner permanently one job busier, forever. Completion is what ends
    that, and it had nowhere to happen. See ADR-012.

    The checks run in a fixed order, and the order is load-bearing:

      1. **404** the job does not exist.
      2. **403** the caller is not the partner responsible for this job. Before
         the legality check on purpose: a stranger must not be able to learn a
         job's current status by watching which of their attempted transitions
         come back 409 and which come back 403.
      3. **409** the move is not in ALLOWED_TRANSITIONS. Includes both skipped
         steps and anything at all out of a terminal state.
      4. **400** the body does not match the target status — a completion with
         no price, or a price attached to something that is not a completion.

    "Responsible" is deliberately wider than "currently holding an accepted
    offer" — see RESPONSIBLE_ASSIGNMENT_STATUSES. A partner who has just
    completed a job is still that job's partner, so a second attempt on it is
    answered with the truthful 409 rather than a 403 claiming they were never
    on it. The probing defence is untouched: a partner who was never on the job
    still cannot get past step 2 to find out what state it is in.

    Steps 3 and 4 are in that order so that a client transitioning a
    *finished* job is told the job is finished, rather than being told to add a
    price to a request that will be refused for a different reason once they
    do.

    Everything then lands in one transaction: the job columns, the assignment
    status, and the job_status_history row. Partial success here would be worse
    than failure — a job marked completed whose assignment still reads
    'accepted' is a partner carrying phantom load, and a status change with no
    history row is a timeline that lies.

    The job row is read **under a row lock** (get_job_by_id_for_update), which
    is what makes step 3 mean anything under concurrency. Without it a partner
    completing a job while its owner cancels it produced two legal transitions
    from the same 'assigned' read and two successful writes, the second of
    which silently overwrote the first. The lock is taken as this
    transaction's first statement and held to commit, so the legality check and
    the write are one indivisible decision; whichever request gets there second
    re-reads the committed status and is answered with a 409. The owner path
    takes the same lock, on the same row, before the same tables — one side
    locking alone would buy nothing, and locking in a different order would
    trade a lost update for a deadlock. See ADR-013.

    Raises:
        NotFoundError (404): no job with this id.
        ForbiddenError (403): caller is not this job's responsible partner.
        ConflictError (409): the transition is not legal from the current status.
        BadRequestError (400): body fields do not match the target status.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()
    target = payload.status

    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    assignment = await job_repository.get_responsible_assignment(db, job.id)
    if assignment is None or assignment.partner_id != partner_id:
        # One message for both cases: "no partner has accepted this job" and
        # "a different partner has" are different facts about someone else's
        # job, and neither is the caller's to learn.
        log_event(
            "job_status_transitioned",
            level=logging.WARNING,
            job_id=str(job.id),
            partner_id=str(partner_id),
            target_status=target,
            actor_role="partner",
            outcome="rejected_not_assigned_partner",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ForbiddenError(
            ErrorCode.FORBIDDEN, "You are not the partner assigned to this job"
        )

    if target not in ALLOWED_TRANSITIONS.get(job.status, frozenset()):
        log_event(
            "job_status_transitioned",
            level=logging.WARNING,
            job_id=str(job.id),
            partner_id=str(partner_id),
            from_status=job.status,
            target_status=target,
            actor_role="partner",
            outcome="rejected_invalid_transition",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ConflictError(
            ErrorCode.INVALID_STATUS_TRANSITION,
            f"A job in '{job.status}' cannot move to '{target}'",
        )

    _check_body_applies(payload)

    # func.now() rather than a Python datetime so completed_at, cancelled_at and
    # the history row's changed_at all come off the database clock. Timestamps
    # that decide "how long did this job take" must not depend on which API
    # process handled the request.
    job_fields: dict[str, object] = {"status": target}
    if target == "completed":
        job_fields["price_final"] = payload.price_final
        job_fields["completed_at"] = func.now()
    elif target == "cancelled":
        job_fields["cancelled_at"] = func.now()
        job_fields["cancellation_reason"] = payload.cancellation_reason

    new_assignment_status = TERMINAL_ASSIGNMENT_STATUS.get(target)

    try:
        await job_repository.update_job_fields(db, job, **job_fields)
        if new_assignment_status is not None:
            await job_repository.set_assignment_status(
                db, assignment, new_assignment_status
            )
        await job_repository.create_status_history_row(
            db,
            job_id=job.id,
            status=target,
            note=(
                _cancellation_note("partner", payload.cancellation_reason)
                if target == "cancelled"
                else None
            ),
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "job_status_transitioned",
            level=logging.ERROR,
            job_id=str(job.id),
            partner_id=str(partner_id),
            target_status=target,
            actor_role="partner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not update the job status") from exc

    # completed_at/cancelled_at were written as func.now(), so the in-memory
    # objects hold a SQL expression until they are re-read.
    await db.refresh(job)
    await db.refresh(assignment)

    log_event(
        "job_status_transitioned",
        job_id=str(job.id),
        partner_id=str(partner_id),
        target_status=target,
        assignment_status=assignment.status,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )

    return JobStatusTransitionResponse(
        id=job.id,
        status=job.status,
        assignment_status=assignment.status,
        price_final=job.price_final,
        completed_at=job.completed_at,
        cancelled_at=job.cancelled_at,
        cancellation_reason=job.cancellation_reason,
    )


async def cancel_job_by_owner(
    db: AsyncSession,
    job_id: uuid.UUID,
    payload: JobCancelRequest,
    user_id: uuid.UUID,
) -> JobCancelResponse:
    """Cancel a job on behalf of the vehicle owner who raised it.

    The counterpart to transition_job_status, and deliberately a separate route
    rather than a role branch inside it. The two share a verb and almost nothing
    else: a partner names one of four target statuses and may only touch a job
    they accepted, whereas an owner has exactly one action and may only touch a
    job they own. Folding them together would mean a single handler holding two
    authorisation models and two bodies, with the role deciding which half of
    each applies — the shape that produces "the customer path skipped the
    ownership check" bugs. See ADR-013.

    Three rules, in this order, and the order is load-bearing:

      1. **404** the job does not exist.
      2. **403** the job is not this caller's. Before the state check on
         purpose, for the reason ADR-012 gives for the partner endpoint: a
         stranger sweeping job ids must not be able to read a job's current
         state off which error comes back. Here that matters more, not less —
         cancellation takes no body worth guessing, so the error code would be
         the entire oracle.
      3. **409 JOB_ALREADY_TERMINAL** the job is already 'completed' or
         'cancelled'. Cancelling is for live bookings; a finished job whose
         price and completion time can be overwritten by a cancellation is a
         finished job with no audit trail worth the name.

    Everything else is cancellable, *including* 'requested' and 'matching',
    where no partner has been assigned. That is the substantive difference from
    the partner endpoint, which cannot be reached at all before a job is
    assigned — and it is the case the product actually needs, because the
    likeliest moment for a driver to change their mind is while they are still
    watching a spinner. 'no_match_found' is cancellable too; see
    TERMINAL_JOB_STATUSES for why it is not treated as terminal here even
    though ALLOWED_TRANSITIONS gives it nowhere to go.

    Any still-open assignment is closed as **'cancelled'**, never 'rejected'.
    'rejected' is a partner's answer to an offer and feeds acceptance rate, so
    recording a customer's decision there would quietly charge the mechanic for
    something they did not do, in a metric that may later drive ranking or pay.
    ADR-012 made that call for the partner path; the reasoning is stronger here,
    where the partner is unambiguously not the one who ended the job.

    Both 'offered' and 'accepted' rows are closed, not just accepted ones. An
    offer outstanding when the owner cancels is a notification sitting on a
    mechanic's phone for a job that no longer exists.

    The job columns, every assignment update and the job_status_history row
    commit together. A job marked cancelled whose assignment still reads
    'accepted' is a partner carrying phantom load against their concurrent-job
    limit, and a status change with no history row is a timeline that lies.

    Releasing the partner is a consequence here, not the mechanism: a partner
    stops counting as busy because the *job* left an active status — the
    eligibility query ANDs assignment status with job status — and the
    assignment update keeps the two sides from disagreeing. Recorded because
    the opposite is the intuitive reading and it is wrong.

    Closed as of 2026-09-23, and it was open until then: an owner cancelling at
    the same instant as the partner completing was a lost update, because
    neither path locked the job row. Both now read the job through
    get_job_by_id_for_update() as the first statement of the transaction that
    writes it, so the terminal-state check above and the write below sit inside
    one row lock. The second request to arrive re-reads the committed status
    when the lock is released and answers 409 — JOB_ALREADY_TERMINAL here,
    INVALID_STATUS_TRANSITION on the partner side — rather than overwriting a
    finished job. The polling GET deliberately kept its own non-locking read.
    See ADR-013.

    Raises:
        NotFoundError (404): no job with this id.
        ForbiddenError (403): the job belongs to a different account.
        ConflictError (409): the job is already completed or cancelled.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    job = await job_repository.get_job_by_id_for_update(db, job_id)
    if job is None:
        raise NotFoundError(ErrorCode.JOB_NOT_FOUND, "Job not found")

    if job.user_id != user_id:
        log_event(
            "job_cancelled_by_owner",
            level=logging.WARNING,
            job_id=str(job.id),
            user_id=str(user_id),
            actor_role="owner",
            outcome="rejected_not_job_owner",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        # No mention of whose job it is, and no echo of its status. The caller
        # has established only that the id exists.
        raise ForbiddenError(
            ErrorCode.FORBIDDEN, "This job belongs to a different account"
        )

    if job.status in TERMINAL_JOB_STATUSES:
        log_event(
            "job_cancelled_by_owner",
            level=logging.WARNING,
            job_id=str(job.id),
            user_id=str(user_id),
            from_status=job.status,
            actor_role="owner",
            outcome="rejected_already_terminal",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise ConflictError(
            ErrorCode.JOB_ALREADY_TERMINAL,
            f"This job is already {job.status} and cannot be cancelled",
        )

    # Empty for a job nobody has been offered yet — a cancel from 'requested'
    # is the normal case, not an error, so this must not become a lookup that
    # raises on a missing row.
    open_assignments = await job_repository.get_open_assignments(db, job.id)

    try:
        # func.now() so cancelled_at and the history row's changed_at come off
        # the database clock: "how long did this job sit before being called
        # off" must not depend on which API process answered the request.
        await job_repository.update_job_fields(
            db,
            job,
            status="cancelled",
            cancelled_at=func.now(),
            cancellation_reason=payload.cancellation_reason,
        )
        for assignment in open_assignments:
            await job_repository.set_assignment_status(
                db, assignment, TERMINAL_ASSIGNMENT_STATUS["cancelled"]
            )
        await job_repository.create_status_history_row(
            db,
            job_id=job.id,
            status="cancelled",
            note=_cancellation_note("owner", payload.cancellation_reason),
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "job_cancelled_by_owner",
            level=logging.ERROR,
            job_id=str(job.id),
            user_id=str(user_id),
            actor_role="owner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not cancel the job") from exc

    # cancelled_at was written as func.now(), so the in-memory object holds a
    # SQL expression until it is re-read.
    await db.refresh(job)

    # None rather than 'cancelled' when nothing was open: the field means "a
    # partner was released", and claiming one was when the job had never been
    # offered would have an owner's app render a mechanic who never existed.
    released_assignment_status = (
        TERMINAL_ASSIGNMENT_STATUS["cancelled"] if open_assignments else None
    )

    log_event(
        "job_cancelled_by_owner",
        job_id=str(job.id),
        user_id=str(user_id),
        assignments_released=len(open_assignments),
        actor_role="owner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )

    return JobCancelResponse(
        id=job.id,
        status=job.status,
        assignment_status=released_assignment_status,
        cancelled_at=job.cancelled_at,
        cancellation_reason=job.cancellation_reason,
    )
