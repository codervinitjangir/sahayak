"""
Notification payloads.

The feed is read-only to clients apart from marking things read: nothing accepts
a notification in a request body, because nothing outside the server is allowed
to decide that an event happened. `NotificationCreate` is kept for internal use
by the service and is deliberately not any endpoint's request model.
"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class NotificationBase(BaseModel):
    recipient_type: Literal["user", "partner"]
    recipient_id: Optional[uuid.UUID] = None
    channel: Literal["in_app", "push", "sms"]
    # Not a Literal, even though the service writes from a closed vocabulary. The
    # set grows with every feature that notifies, and pinning it here would mean
    # a schema change is required before the service can emit a new kind — the
    # same friction migration 005 declined to put in the database. The service's
    # NOTIFICATION_EVENTS table is the vocabulary, and its unit test is the guard.
    event: str
    message: Optional[str] = None
    is_read: Optional[bool] = False
    job_id: Optional[uuid.UUID] = None


class NotificationCreate(NotificationBase):
    pass


class NotificationResponse(NotificationBase):
    id: uuid.UUID
    sent_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationItem(BaseModel):
    """One row of the caller's feed.

    `recipient_type` and `recipient_id` are absent on purpose. Every row in the
    response is addressed to the caller — that is the only way it could be in the
    response — so echoing the address back adds a field a client must ignore and
    invites the mistake of filtering on it. `event` is what a client should
    branch on to pick an icon; `message` is prose and may be reworded at any
    time, like every other `message` in this API.
    """

    id: uuid.UUID
    event: str = Field(
        ...,
        description="Stable machine-readable kind, e.g. 'job_completed'. Branch on this.",
        examples=["job_completed"],
    )
    message: Optional[str] = Field(
        None, description="Human-readable text. Contains no names, phones or coordinates."
    )
    job_id: Optional[uuid.UUID] = Field(
        None, description="The job this is about; null for notifications that are not."
    )
    is_read: bool
    sent_at: datetime = Field(..., description="When the notification was created.")

    model_config = ConfigDict(from_attributes=True)


class NotificationListResponse(BaseModel):
    """A page of the caller's feed, plus the badge count for the whole feed.

    `unread_count` is over *all* the caller's notifications, not over this page —
    a badge that only counted the current page would drop as the user scrolled.
    It is returned here as well as on its own endpoint so that the common case,
    opening the list, is one request rather than two.
    """

    items: list[NotificationItem]
    unread_count: int = Field(
        ..., description="Unread notifications across the whole feed, not just this page."
    )
    total: int = Field(..., description="Notifications in the whole feed, after filtering.")
    limit: int
    offset: int
    has_more: bool = Field(
        ..., description="True when offset + len(items) < total. Cheaper than comparing."
    )


class UnreadCountResponse(BaseModel):
    """Just the badge."""

    unread_count: int


class MarkReadResponse(BaseModel):
    """What a mark-read call changed.

    `updated` is 0 when the notification was already read. That is a success, not
    a conflict: the client's intent — "this should be read" — holds either way,
    and a 409 would make an idempotent retry look like a failure.
    """

    updated: int = Field(..., description="Rows this call changed. 0 if already read.")
    unread_count: int = Field(..., description="The caller's badge count afterwards.")
