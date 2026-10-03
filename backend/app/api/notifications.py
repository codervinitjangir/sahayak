"""
The in-app notification feed.

  GET  /api/v1/notifications
  GET  /api/v1/notifications/unread-count
  POST /api/v1/notifications/{notification_id}/read
  POST /api/v1/notifications/read-all

A flat resource rather than something nested under a job, unlike ratings. A
rating has no identity apart from the job it is about; a notification does — the
feed is a list a client renders whole, ordered across every job the caller has
ever had, and half its future contents will not be about a job at all (the
`job_id` column is nullable for exactly that reason). Nesting it would mean a
client had to know which jobs to ask about before it could show an inbox.

All four routes depend on `get_current_identity` rather than `require_user` or
`require_partner`. Both sides have a feed, both read it identically, and the
role decides *whose* rows come back rather than whether the call is allowed —
the same argument that put ratings on the shared dependency. There is no path
parameter or query parameter anywhere below that names a recipient, so there is
no request a client can construct that asks for someone else's mail. That is
principle 5 enforced structurally rather than by a check that could be omitted.

Nothing here creates a notification. Clients do not get to assert that something
happened; the writer lives in app/services/notification_service.py and is called
from inside the transactions that change a job's status. See ADR-019.
"""
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.notification import (
    MarkReadResponse,
    NotificationListResponse,
    UnreadCountResponse,
)
from app.services import notification_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

# The page size cap. A feed grows with every status change of every job an
# account has ever had, so an uncapped limit is a request that gets slower for
# the caller's whole history — and the client that would ask for it is the one
# whose user has been here longest.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 20

_ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    404: {"model": ErrorResponse, "description": "No such notification for this caller"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/notifications",
    tags=["notifications"],
    responses=_ERROR_RESPONSES,
)


@router.get(
    "",
    response_model=ApiResponse[NotificationListResponse],
    status_code=status.HTTP_200_OK,
    summary="Read the caller's notification feed",
)
async def list_notifications(
    limit: int = Query(
        DEFAULT_PAGE_SIZE,
        ge=1,
        le=MAX_PAGE_SIZE,
        description=f"Rows per page, 1–{MAX_PAGE_SIZE}.",
    ),
    offset: int = Query(0, ge=0, description="Rows to skip, for the next page."),
    unread_only: bool = Query(
        False, description="Restrict to unread. Affects `total`, never `unread_count`."
    ),
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[NotificationListResponse]:
    """The caller's notifications, newest first.

    Whose feed comes back is decided by the token, not by any parameter — an
    owner sees what happened to their requests, a partner sees their offers and
    the jobs they were released from.

    An account with nothing yet gets `items: []` and a 200, not a 404. That is
    the ordinary state of a new account, and of any account that has read
    nothing into existence yet.

    Paginated by `limit`/`offset` rather than by cursor. The feed is bounded by
    how many jobs an account has run, it is read newest-first from the first
    page in practice, and the drift offset pagination suffers under concurrent
    inserts needs a high-churn feed and deep paging together to be visible. See
    ADR-019 for the full argument, including why the ordering is
    `sent_at DESC, id DESC` and not `sent_at` alone.

    `unread_count` is over the whole feed even when `unread_only` is set, so the
    badge does not change as the user pages.
    """
    result = await notification_service.list_notifications(
        db, identity, limit=limit, offset=offset, unread_only=unread_only
    )
    return envelope(result)


@router.get(
    "/unread-count",
    response_model=ApiResponse[UnreadCountResponse],
    status_code=status.HTTP_200_OK,
    summary="How many unread notifications the caller has",
)
async def get_unread_count(
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[UnreadCountResponse]:
    """Just the badge number.

    Separate from the list because it is what a client polls on a timer whether
    or not the feed is on screen, and it is served entirely from a partial index
    over unread rows — so its cost tracks unread mail rather than feed size.

    Declared before `/{notification_id}/read` in this module only as a matter of
    reading order; the paths cannot collide, since this one is a GET on a fixed
    segment and that one is a POST on a UUID.
    """
    result = await notification_service.unread_count(db, identity)
    return envelope(result)


@router.post(
    "/{notification_id}/read",
    response_model=ApiResponse[MarkReadResponse],
    status_code=status.HTTP_200_OK,
    summary="Mark one notification read",
)
async def mark_read(
    notification_id: uuid.UUID,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[MarkReadResponse]:
    """Mark a single notification read and return the caller's new badge count.

    Idempotent, and says so in the body rather than in the status code:
    `updated` is 1 the first time and 0 on every repeat, both with a 200. A 409
    on the repeat would report a failure to the one caller who cannot tell —
    the client retrying after a dropped response — while the server's state is
    exactly what that client asked for.

    404 NOTIFICATION_NOT_FOUND when the id is not this caller's, whether it
    belongs to someone else or to nobody. Same response either way, because a
    notification's existence is the fact it carries (principle 6).

    POST rather than PATCH: the request has no body, there is nothing to
    describe as a partial update of the resource, and `read` is the verb.
    """
    result = await notification_service.mark_notification_read(
        db, identity, notification_id
    )
    return envelope(result)


@router.post(
    "/read-all",
    response_model=ApiResponse[MarkReadResponse],
    status_code=status.HTTP_200_OK,
    summary="Mark every notification read",
)
async def mark_all_read(
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[MarkReadResponse]:
    """Clear the caller's badge in one call.

    Returns how many rows it changed, which is 0 for an account with nothing
    unread — a success, for the same reason a repeated single mark-read is one.
    `unread_count` in the response is always 0: that is what the call
    guarantees, so it is returned rather than re-queried.

    Not scoped to a page or a filter. "Mark all read" that only marked the
    visible page read would leave a badge the user has no way to clear, which is
    the behaviour the button exists to avoid.
    """
    result = await notification_service.mark_all_notifications_read(db, identity)
    return envelope(result)
