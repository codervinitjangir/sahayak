"""
Rating endpoints for a finished job.

  POST /api/v1/jobs/{job_id}/ratings
  GET  /api/v1/jobs/{job_id}/ratings

Nested under the job rather than sitting at /ratings, because a rating has no
identity apart from the job it is about: there is no useful "list all ratings"
and no reason for a client to hold a rating id. The job id in the path is also
what makes the body free of identifiers entirely, which is the property that
stops a caller naming a job they are not party to.

Its own module rather than two more handlers in app/api/jobs.py, which is
already the longest router here. The prefix is shared; nothing else is.

Both routes depend on `get_current_identity` rather than `require_user` or
`require_partner`, and this is the first pair in the codebase that legitimately
does. Every other job route belongs to one side — an owner cancels, a partner
transitions — but rating is the one exchange both parties drive, from the same
job, through the same endpoint. Which side is calling decides what gets written
(`rated_by`) instead of whether the call is allowed, so the role check is a
branch in the service, next to the ownership check it is paired with, rather
than a dependency that would have to be one or the other.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.rating import JobRatingsResponse, RatingCreateRequest, RatingItem
from app.services import rating_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

_ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Token valid, action not permitted"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    409: {"model": ErrorResponse, "description": "Job not rateable, or already rated"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/jobs",
    tags=["ratings"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "/{job_id}/ratings",
    response_model=ApiResponse[RatingItem],
    status_code=status.HTTP_201_CREATED,
    summary="Rate a completed job",
)
async def submit_rating(
    job_id: uuid.UUID,
    payload: RatingCreateRequest,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RatingItem]:
    """Record the caller's rating of a job they were party to.

    Which direction the rating runs is derived from the token: an owner's
    rating is stored as `rated_by: "user"` and is what moves the mechanic's
    `rating_avg`; a partner's is stored as `rated_by: "partner"`. The body
    carries the score and an optional comment and nothing else — sending
    `rated_by` or `job_id` is a 422, not a silently ignored field.

    One rating per side per job. A second attempt from the same side is 409
    RATING_ALREADY_SUBMITTED rather than an overwrite: a rating is a judgement
    and there is no version of "converge on the latest one" that does not
    quietly discard something somebody wrote.

    Returns 409 JOB_NOT_RATEABLE while the job is anything other than
    'completed', 403 when the caller is neither the owner nor the responsible
    partner, and 404 when the job does not exist — in that order, so a caller
    who is not party to the job learns nothing about its state.
    """
    rating = await rating_service.submit_rating(db, job_id, payload, identity)
    return envelope(rating)


@router.get(
    "/{job_id}/ratings",
    response_model=ApiResponse[JobRatingsResponse],
    status_code=status.HTTP_200_OK,
    summary="Read a job's ratings",
)
async def get_job_ratings(
    job_id: uuid.UUID,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JobRatingsResponse]:
    """Both sides' ratings for one job, plus whether the caller may still add theirs.

    A job with no ratings yet returns an empty list and a 200, which is the
    normal state of every job the moment it completes.

    `can_rate` is the field a client should branch on to decide whether to show
    the rating form. It is false while the job is not completed and false once
    this caller has rated it, so a client never has to re-derive the server's
    rules and then disagree with them.

    Neither party's name or id appears in a rating. `rated_by` says which side
    wrote it, which with exactly two participants is all the attribution there
    is to give — and it means this response can be rendered without a second
    lookup and without leaking anything the caller did not already know.
    """
    job_status, ratings, can_rate = await rating_service.get_job_ratings(
        db, job_id, identity
    )
    return envelope(
        JobRatingsResponse(
            job_id=job_id,
            job_status=job_status,
            ratings=[RatingItem.model_validate(row) for row in ratings],
            can_rate=can_rate,
        )
    )
