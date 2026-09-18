"""
Business logic for partner identity, availability and service coverage.

Mirrors app/services/job_service.py: the route handlers in app/api/partners.py
stay thin, every database call goes through app/repositories/partner_repository,
and this module owns the rules, the transaction boundary and the error mapping.

Authorization model, since it differs per endpoint:

  * register_partner is deliberately open. It is how a mechanic who has no
    account yet comes into existence, so requiring a token would be circular.
    What it creates is inert — unverified, off-shift, linked to no Supabase
    account — so the worst a spammer achieves is junk rows, not access.
  * set_availability and link_partner_services require a partner token *and*
    that the token's partner is the one named in the path. Role alone is not
    enough: every mechanic on the platform holds a partner token, so without
    the ownership check any of them could take a competitor off shift.

The ownership comparison lives here rather than in the route handler because it
is a rule about who may change a partner's state, and rules belong in the
service — a second caller (an admin tool, a background job) must not be able to
reach these functions and bypass it by not being an HTTP request.
"""
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import List, Sequence

from redis.exceptions import RedisError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_client import (
    PARTNER_LOCATIONS_KEY,
    get_redis,
    location_updated_at_key,
)
from app.models.partner import Partner
from app.repositories import partner_repository
from app.schemas.partner import (
    PartnerCreateRequest,
    PartnerServiceItem,
    PartnerServicesResponse,
)
from app.services.auth_service import Identity
from app.utils.errors import (
    BadRequestError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
)
from app.utils.logging import log_event


async def _load_partner_or_404(db: AsyncSession, partner_id: uuid.UUID) -> Partner:
    """Load a partner or raise 404.

    Shared by both post-registration endpoints so "unknown partner" reads
    identically whichever one was called.
    """
    partner = await partner_repository.get_partner_by_id(db, partner_id)
    if partner is None:
        raise NotFoundError(ErrorCode.PARTNER_NOT_FOUND, "Partner not found")
    return partner


def _require_own_profile(identity: Identity, partner_id: uuid.UUID) -> None:
    """Refuse a partner acting on a profile that is not theirs.

    Depends(require_partner) has already established that the caller is *a*
    partner. This establishes that they are *this* partner — the check that
    actually protects a mechanic from a competitor flipping their availability.

    403 rather than 404: hiding the profile's existence would be pointless here,
    because the caller supplied the id and partner ids are already visible to
    the owner of any job a partner is assigned to.
    """
    if identity.local_id != partner_id:
        log_event(
            "partner_access_denied",
            level=logging.WARNING,
            partner_id=str(partner_id),
            actor_partner_id=str(identity.local_id),
            actor_role=identity.role,
            outcome="failure",
        )
        raise ForbiddenError(
            code=ErrorCode.FORBIDDEN,
            message="You can only modify your own partner profile.",
        )


async def register_partner(
    db: AsyncSession, payload: PartnerCreateRequest
) -> Partner:
    """Register a mechanic, unverified and off-shift.

    Intentionally unauthenticated — see the authorization note in the module
    docstring. It creates the profile; POST /partners/{id}/link-auth is what
    later binds it to a Supabase account.

    Steps, in order:
      1. The phone number must not already be registered. phone is unique in the
         schema, so this is checked rather than left to the constraint: a caller
         deserves "this number is already registered" and not a raw database
         error. The IntegrityError branch below is the backstop for two
         registrations racing between this check and the insert.
      2. primary_category_code, when supplied, must resolve to a real category.
         It is optional — a mechanic who has not picked a specialism yet is a
         legitimate state, and primary_category_id simply stays null.
      3. The row is inserted with no status fields set at all, so
         verification_status ('pending'), is_available (false), rating_avg (0.0)
         and rating_count (0) come from the column defaults. A partner is never
         verified or dispatchable at the moment of signing up; that is a decision
         the verification workflow makes later, not something registration can
         grant itself.

    Raises:
        BadRequestError (400): phone already registered, or unknown category.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()

    existing = await partner_repository.get_partner_by_phone(db, payload.phone)
    if existing is not None:
        log_event(
            "partner_registered",
            level=logging.WARNING,
            actor_role="partner",
            outcome="rejected_phone_already_registered",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise BadRequestError(
            ErrorCode.PARTNER_ALREADY_EXISTS,
            "A partner is already registered with this phone number",
        )

    primary_category_id = None
    if payload.primary_category_code is not None:
        category = await partner_repository.get_category_by_code(
            db, payload.primary_category_code
        )
        if category is None:
            log_event(
                "partner_registered",
                level=logging.WARNING,
                actor_role="partner",
                category_code=payload.primary_category_code,
                outcome="rejected_invalid_category_code",
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise BadRequestError(
                ErrorCode.INVALID_CATEGORY_CODE, "Invalid primary_category_code"
            )
        primary_category_id = category.id

    try:
        partner = await partner_repository.create_partner_row(
            db,
            name=payload.name,
            phone=payload.phone,
            primary_category_id=primary_category_id,
        )
        await db.commit()
    except IntegrityError as exc:
        # Two signups for the same number at once: the pre-check above passed
        # for both, the unique index caught the loser. Same answer as step 1 —
        # the caller should never be able to tell the two paths apart.
        await db.rollback()
        log_event(
            "partner_registered",
            level=logging.WARNING,
            actor_role="partner",
            outcome="rejected_phone_already_registered_race",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise BadRequestError(
            ErrorCode.PARTNER_ALREADY_EXISTS,
            "A partner is already registered with this phone number",
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "partner_registered",
            level=logging.ERROR,
            actor_role="partner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not register partner") from exc

    # created_at, verification_status and the rating fields are database
    # defaults, so re-read the row to return what Postgres actually stored.
    await db.refresh(partner)

    # phone is redacted by log_event; it is a personal identifier and does not
    # belong in the log store. See app/utils/logging.py.
    log_event(
        "partner_registered",
        partner_id=partner.id,
        primary_category_id=partner.primary_category_id,
        verification_status=partner.verification_status,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return partner


async def set_availability(
    db: AsyncSession, partner_id: uuid.UUID, is_available: bool, identity: Identity
) -> Partner:
    """Turn a partner's dispatchable flag on or off.

    This is the "go on shift / go off shift" switch: the dispatch engine will
    only consider partners with is_available true. It is called often and from a
    phone with patchy signal, so it is written to be idempotent — setting the
    flag to the value it already holds is a success, not a conflict.

    Only the partner themselves may call this. Taking a rival off shift would be
    a direct attack on their earnings, so ownership is checked before anything
    else happens.

    Deliberately does not touch current_location. Live position is Redis-only
    and moves on a completely different cadence; conflating the two here would
    make a shift toggle depend on the location pipeline being up.

    Raises:
        ForbiddenError (403): the token belongs to a different partner.
        NotFoundError (404): no partner with this id.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()
    # Before the load, not after: checking ownership first means a caller
    # probing ids gets an identical 403 whether or not the id exists, so this
    # endpoint cannot be used to enumerate which partner ids are real.
    _require_own_profile(identity, partner_id)
    partner = await _load_partner_or_404(db, partner_id)

    try:
        await partner_repository.set_partner_availability(db, partner, is_available)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "partner_availability_changed",
            level=logging.ERROR,
            partner_id=partner_id,
            actor_role="partner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not update availability") from exc

    # updated_at is set by the onupdate hook, so re-read it rather than
    # returning the value loaded before the write.
    await db.refresh(partner)

    log_event(
        "partner_availability_changed",
        partner_id=partner.id,
        is_available=partner.is_available,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return partner


async def update_location(
    db: AsyncSession,
    partner_id: uuid.UUID,
    lat: float,
    lng: float,
    identity: Identity,
) -> datetime:
    """Record where a partner is right now. Redis only — nothing hits Postgres.

    This is the highest-frequency write in the whole API: a partner app on shift
    posts a position every few seconds, and every one of those is obsolete within
    a minute. Writing them to Postgres would mean a durable-storage write storm
    in service of data nobody will ever read twice, and it would put the row a
    dispatch decision reads under constant lock contention. partners has no
    current_location column, and that absence is a decision, not an oversight.

    Two keys are written:

      * the GEO set, which dispatch's radius search reads;
      * a timestamp, so a coordinate can be recognised as stale. A GEO set stores
        coordinates and nothing else — there is no per-member "when" to read, so
        without this a phone that died an hour ago looks exactly like a partner
        standing still.

    **Longitude first.** GEOADD takes (longitude, latitude), the same axis order
    as the PostGIS POINT(x y) convention used when a job's pickup point is
    stored. Transposing them does not raise — it silently files the partner
    somewhere else on the planet, and the only symptom is a candidate search that
    quietly returns nobody. The request schema takes lat first because that is
    how humans and GPS APIs quote a coordinate; the flip happens here, once.

    Only the partner themselves may report their position. Someone else moving a
    partner's pin could pull work toward or away from them at will.

    Returns the timestamp recorded, so the response does not have to invent its
    own slightly-different "now".

    Raises:
        ForbiddenError (403): the token belongs to a different partner.
        NotFoundError (404): no partner with this id.
        InternalError (500): the location store is unreachable.
    """
    started = time.perf_counter()
    # Ownership before the load, for the same anti-enumeration reason as
    # set_availability.
    _require_own_profile(identity, partner_id)
    # The partner must still exist and the caller's claim to them is checked
    # against the database, not only against the token: a token outlives the row
    # it names, and writing positions for a deleted partner would leave a ghost
    # in the GEO set that dispatch would happily offer jobs to.
    await _load_partner_or_404(db, partner_id)

    recorded_at = datetime.now(timezone.utc)
    client = get_redis()
    try:
        await client.geoadd(PARTNER_LOCATIONS_KEY, (lng, lat, str(partner_id)))
        await client.set(
            location_updated_at_key(partner_id), str(recorded_at.timestamp())
        )
    except RedisError as exc:
        log_event(
            "partner_location_updated",
            level=logging.ERROR,
            partner_id=partner_id,
            actor_role="partner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not record your location right now") from exc

    # No coordinates in this log line. log_event redacts lat/lng keys anyway, but
    # a partner's live position is a tracking record of a working person, and the
    # place it is least justifiable is a log file nobody set a retention policy
    # on.
    log_event(
        "partner_location_updated",
        partner_id=partner_id,
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return recorded_at


async def link_partner_services(
    db: AsyncSession,
    partner_id: uuid.UUID,
    service_codes: List[str],
    identity: Identity,
) -> PartnerServicesResponse:
    """Declare which services a partner can perform.

    Only the partner themselves may call this: service coverage decides what
    work they are offered, so another partner editing it is both sabotage and a
    way to be sent jobs they are not equipped for.

    Steps, in order:
      1. The caller must own this profile, and the partner must exist.
      2. Every code must resolve. If any one is unknown the whole request is
         rejected and the bad codes are named — linking three of four services
         and silently dropping the fourth would leave the partner believing they
         are covered for work they will never be offered.
      3. The links are inserted with ON CONFLICT DO NOTHING, so a partner app
         re-sending its full list on every sync succeeds unchanged.
      4. The partner's complete current service list is returned, not just what
         this call inserted, so the caller never has to merge a delta.

    Raises:
        ForbiddenError (403): the token belongs to a different partner.
        NotFoundError (404): no partner with this id.
        BadRequestError (400): one or more unknown service codes.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()
    _require_own_profile(identity, partner_id)
    await _load_partner_or_404(db, partner_id)

    # Preserve request order while removing repeats, so the error message below
    # reads back in the order the caller sent them.
    requested_codes = list(dict.fromkeys(service_codes))

    services = await partner_repository.get_services_by_codes(db, requested_codes)
    found_codes = {service.code for service in services}
    unknown_codes = [code for code in requested_codes if code not in found_codes]
    if unknown_codes:
        log_event(
            "partner_services_linked",
            level=logging.WARNING,
            partner_id=partner_id,
            actor_role="partner",
            outcome="rejected_invalid_service_code",
            invalid_codes=unknown_codes,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise BadRequestError(
            ErrorCode.INVALID_SERVICE_CODE,
            f"Unknown service_code(s): {', '.join(unknown_codes)}",
        )

    try:
        await partner_repository.link_services(
            db,
            partner_id=partner_id,
            service_ids=[service.id for service in services],
        )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        log_event(
            "partner_services_linked",
            level=logging.ERROR,
            partner_id=partner_id,
            actor_role="partner",
            outcome="failure",
            error_type=type(exc).__name__,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        raise InternalError("Could not link partner services") from exc

    current = await partner_repository.get_partner_services(db, partner_id)

    log_event(
        "partner_services_linked",
        partner_id=partner_id,
        requested_count=len(requested_codes),
        total_count=len(current),
        actor_role="partner",
        outcome="success",
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return _to_services_response(partner_id, current)


def _to_services_response(
    partner_id: uuid.UUID, services: Sequence
) -> PartnerServicesResponse:
    """Shape service rows into the response model.

    service_id rather than id, because from the client's point of view this list
    describes a partner's coverage, and "id" alone would read as the link's id.
    """
    return PartnerServicesResponse(
        partner_id=partner_id,
        services=[
            PartnerServiceItem(
                service_id=service.id, code=service.code, name=service.name
            )
            for service in services
        ],
    )
