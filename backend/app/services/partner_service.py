"""
Business logic for partner identity, availability and service coverage.

Mirrors app/services/job_service.py: the route handlers in app/api/partners.py
stay thin, every database call goes through app/repositories/partner_repository,
and this module owns the rules, the transaction boundary and the error mapping.

SECURITY TODO (auth task): every function here takes the partner's identity from
the caller — a phone number in the request body on registration, a partner_id in
the URL path afterwards. Nothing verifies that the caller *is* that partner. As
it stands, anyone who learns a partner_id can flip that mechanic's availability
or change which services they are offered, and anyone can register a partner
under someone else's phone number. The consequences are worse here than on the
jobs endpoints, because these rows are a real person's identity and their
livelihood: availability decides whether they get dispatched work at all.

Once the Auth module lands, partner_id must come from the verified token, not
the path, and the availability and services endpoints must reject a token whose
subject is a different partner (admins excepted). Registration must be gated by
phone OTP verification so a number can only be claimed by whoever holds it.
Until then, do not point this at production data: real mechanics' phone numbers
must not sit behind endpoints that trust the caller's word about who they are.
"""
import logging
import time
import uuid
from typing import List, Sequence

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner
from app.repositories import partner_repository
from app.schemas.partner import (
    PartnerCreateRequest,
    PartnerServiceItem,
    PartnerServicesResponse,
)
from app.utils.errors import BadRequestError, ErrorCode, InternalError, NotFoundError
from app.utils.logging import log_event


async def _require_partner(db: AsyncSession, partner_id: uuid.UUID) -> Partner:
    """Load a partner or raise 404.

    Shared by both post-registration endpoints so "unknown partner" reads
    identically whichever one was called.
    """
    partner = await partner_repository.get_partner_by_id(db, partner_id)
    if partner is None:
        raise NotFoundError(ErrorCode.PARTNER_NOT_FOUND, "Partner not found")
    return partner


async def register_partner(
    db: AsyncSession, payload: PartnerCreateRequest
) -> Partner:
    """Register a mechanic, unverified and off-shift.

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
    db: AsyncSession, partner_id: uuid.UUID, is_available: bool
) -> Partner:
    """Turn a partner's dispatchable flag on or off.

    This is the "go on shift / go off shift" switch: the dispatch engine will
    only consider partners with is_available true. It is called often and from a
    phone with patchy signal, so it is written to be idempotent — setting the
    flag to the value it already holds is a success, not a conflict.

    Deliberately does not touch current_location. Live position is Redis-only
    and moves on a completely different cadence; conflating the two here would
    make a shift toggle depend on the location pipeline being up.

    Raises:
        NotFoundError (404): no partner with this id.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()
    partner = await _require_partner(db, partner_id)

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


async def link_partner_services(
    db: AsyncSession, partner_id: uuid.UUID, service_codes: List[str]
) -> PartnerServicesResponse:
    """Declare which services a partner can perform.

    Steps, in order:
      1. The partner must exist.
      2. Every code must resolve. If any one is unknown the whole request is
         rejected and the bad codes are named — linking three of four services
         and silently dropping the fourth would leave the partner believing they
         are covered for work they will never be offered.
      3. The links are inserted with ON CONFLICT DO NOTHING, so a partner app
         re-sending its full list on every sync succeeds unchanged.
      4. The partner's complete current service list is returned, not just what
         this call inserted, so the caller never has to merge a delta.

    Raises:
        NotFoundError (404): no partner with this id.
        BadRequestError (400): one or more unknown service codes.
        InternalError (500): the write failed; the transaction is rolled back.
    """
    started = time.perf_counter()
    await _require_partner(db, partner_id)

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
