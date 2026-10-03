"""
Data-access layer for the in-app notification feed.

Same contract as every other repository here: SQL only, returns ORM objects,
rows or counts, raises no HTTP errors, never commits. Whether a missing
notification is a 404 and who is allowed to read one belongs to
app/services/notification_service.py.

Two things about this module are unusual enough to state up front, both of them
consequences of where its writes happen (ADR-019).

**The writer does not flush.** Every other create_* function in this package
flushes, because its caller needs the generated id or needs a unique constraint
to fire before more work is done. Neither applies here: a notification's id is
never returned to anyone, and the row has no unique constraint to violate. What
does apply is that `create_notification_row` is called on the dispatch path,
inside the same transaction as the status change it describes, in a system the
load-test report (§3, §8.1) shows is round-trip bound rather than CPU bound. So
the INSERT is left pending and goes to the database in the same flush as the
status change, the history row and the assignment update. It costs nothing.

**Every read is scoped by the recipient pair, and there is no read that isn't.**
There is deliberately no `get_by_id(notification_id)`. A notification is the one
object in this schema whose entire content is "something happened to you", so a
lookup that can return another account's row is a lookup with no legitimate
caller — and principle 6 wants a foreign id to 404 rather than 403 anyway, which
is exactly what a recipient-scoped query returning None produces for free. The
scoping is in the WHERE clause rather than in a check the service performs after
fetching, so there is no version of this code where someone forgets the check.
"""
import uuid
from typing import List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


def _recipient_filter(recipient_type: str, recipient_id: uuid.UUID):
    """The pair every query in this module filters on.

    Factored out so the four read paths cannot drift apart — the unread badge
    and the list must agree about whose mail they are counting, or the badge
    shows a number the list can never account for.
    """
    return (
        Notification.recipient_type == recipient_type,
        Notification.recipient_id == recipient_id,
    )


async def create_notification_row(
    db: AsyncSession,
    *,
    recipient_type: str,
    recipient_id: uuid.UUID,
    event: str,
    message: str,
    job_id: Optional[uuid.UUID],
    channel: str = "in_app",
) -> Notification:
    """Stage one notification. Not flushed — see the module docstring.

    Returned so a caller that does want the object can flush and use it; nothing
    in the service does today.

    `is_read` is written explicitly rather than left to the column default. The
    default exists and is FALSE, but the column is nullable, and the partial
    index that serves the unread badge is `WHERE is_read IS NOT TRUE` — written
    that way precisely so a NULL from some other writer still counts as unread.
    Writing the boolean here keeps this writer out of that tolerance.

    `sent_at` is left to the column default, so Postgres decides what "now"
    means for the same reason it does in every other table here.
    """
    row = Notification(
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        event=event,
        channel=channel,
        message=message,
        job_id=job_id,
        is_read=False,
    )
    db.add(row)
    return row


async def list_for_recipient(
    db: AsyncSession,
    *,
    recipient_type: str,
    recipient_id: uuid.UUID,
    limit: int,
    offset: int,
    unread_only: bool = False,
) -> List[Notification]:
    """One page of an account's feed, newest first.

    Ordered by `sent_at DESC, id DESC`. The id is not decoration: `sent_at`
    comes from `now()`, which in Postgres is transaction start time, so every
    notification written by a single status change carries the *identical*
    timestamp. Ordering on `sent_at` alone leaves those rows in whatever order
    the executor produces, which can differ between two calls — and under
    offset pagination an unstable sort does not just reorder a page, it can show
    the same row twice and skip another entirely. The id tie-break makes the
    order total.

    The column order matches idx_notifications_recipient_sent, so this is an
    index scan with no sort step (migration 005 §3).
    """
    query = select(Notification).where(*_recipient_filter(recipient_type, recipient_id))
    if unread_only:
        query = query.where(Notification.is_read.isnot(True))
    query = query.order_by(Notification.sent_at.desc(), Notification.id.desc())
    result = await db.execute(query.limit(limit).offset(offset))
    return list(result.scalars().all())


async def count_for_recipient(
    db: AsyncSession,
    *,
    recipient_type: str,
    recipient_id: uuid.UUID,
    unread_only: bool = False,
) -> int:
    """How many notifications an account has, optionally only the unread ones.

    Serves both the `total` in a list response and the unread badge, from one
    function, so the two can never disagree about what counts as a notification.
    With unread_only the predicate matches idx_notifications_recipient_unread
    exactly, which is what makes the badge — the most frequently polled read in
    the feature — an index-only scan over a set that shrinks as mail is read.
    """
    query = select(func.count()).select_from(Notification).where(
        *_recipient_filter(recipient_type, recipient_id)
    )
    if unread_only:
        query = query.where(Notification.is_read.isnot(True))
    result = await db.execute(query)
    return int(result.scalar_one())


async def exists_for_recipient(
    db: AsyncSession,
    *,
    notification_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
) -> bool:
    """Whether this account has a notification with this id.

    Only called when `mark_read` changed nothing, to tell "already read" apart
    from "not yours or not real" — see mark_read. Selects a literal rather than
    the row: nothing needs the columns, and the answer comes out of the primary
    key index.
    """
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.id == notification_id)
        .where(*_recipient_filter(recipient_type, recipient_id))
    )
    return int(result.scalar_one()) > 0


async def mark_read(
    db: AsyncSession,
    *,
    notification_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
) -> int:
    """Mark one notification read. Returns rows changed: 1 or 0.

    A 0 is ambiguous on its own — it means "already read" *or* "no such
    notification for you" — and the service has to tell those apart, because one
    is a success and the other a 404. It resolves the ambiguity with
    `exists_for_recipient`, and only in the 0 case: the common path, marking an
    unread thing read, stays at one round trip and the second query is paid for
    only by callers who changed nothing.

    The alternative — fetch, inspect, then update — costs the extra round trip
    on *every* call, including every one that does real work.

    `is_read IS NOT TRUE` in the predicate rather than `= FALSE`, matching the
    partial index and the nullable column, so a NULL row is repairable by the
    same call that a FALSE one is.

    No row lock. Two clients marking the same notification read is not a race
    worth serialising: the operation is idempotent, both callers want the same
    end state, and the only thing they can disagree about is which of them gets
    the `updated: 1`. Principle 7's locking read is for mutations where the
    outcome depends on the prior value; this one's does not.
    """
    result = await db.execute(
        update(Notification)
        .where(Notification.id == notification_id)
        .where(*_recipient_filter(recipient_type, recipient_id))
        .where(Notification.is_read.isnot(True))
        .values(is_read=True)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


async def mark_all_read(
    db: AsyncSession, *, recipient_type: str, recipient_id: uuid.UUID
) -> int:
    """Mark every unread notification of one account read. Returns rows changed.

    Nothing is ambiguous about a 0 here: an account with no unread mail is not
    an error and needs no follow-up query. The unread count afterwards is
    likewise known without asking — it is zero by construction — which is why
    the service does not re-count after calling this.

    Unbounded by design. The predicate is the partial index, so the work is
    proportional to unread mail rather than to feed size, and an account's
    unread mail is bounded by how many jobs it has run since it last looked.
    """
    result = await db.execute(
        update(Notification)
        .where(*_recipient_filter(recipient_type, recipient_id))
        .where(Notification.is_read.isnot(True))
        .values(is_read=True)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)
