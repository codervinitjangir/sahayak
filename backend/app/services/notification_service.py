"""
The in-app notification feed: one writer and four readers.

This module does two jobs that look unrelated and are not. The **writer** is
called from inside other services' transactions, at the same seams that write
`job_status_history`, and turns a status change into rows addressed to the
people who did not cause it. The **readers** back the four feed endpoints. They
share a file because they share the one thing that is easy to get wrong — the
vocabulary of events and who is entitled to see them — and splitting them would
put the definition of an event in one file and its only consumer in another.

Three decisions shape everything below; all three are ADR-019.

**A notification is a side record of a status change, not delivery work.** It is
written in the same transaction as the change it describes, with no savepoint
around it, exactly as `job_status_history` is and for the same reason
(principle 4: no silent transitions). A savepoint would buy isolation from a
failure that cannot happen independently — the row's three constraints are all
satisfied by construction here — and would cost two extra transaction-control
round trips on the dispatch path, in a system the load-test report measures as
round-trip bound. If the insert can only fail when the whole transaction is
already failing, protecting the transaction from it protects nothing.

**The recipient rule is one line: notify the party that is not the actor.** Not
a per-status table of who hears what. A table would need a row for `cancelled`
saying "the partner, unless the partner did it, in which case the owner", which
is the rule restated badly. Written as a rule it also answers statuses nobody
has thought about yet, including the one with no actor at all
(`no_match_found`, where the system gives up and the owner is the only party
there is). See `recipients_for`.

**Message text contains no names, phone numbers or coordinates.** A stored
string cannot be re-gated. The contact-release rules in ADR-017 and
HANDOFF-frontend-contract §2.5b decide at read time who may see a mechanic's
name and number; a notification that baked "Ramesh is on the way" into a TEXT
column at write time would sit outside that gate forever, and would still be
sitting there if the rules tightened. It would also cost a partner lookup on
every status change. The client already has `GET /jobs/{id}`, where the gate
lives, and that is where names come from.
"""
import logging
import uuid
from typing import Iterable, Literal, Optional, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.repositories import notification_repository
from app.schemas.notification import (
    MarkReadResponse,
    NotificationItem,
    NotificationListResponse,
    UnreadCountResponse,
)
from app.services.auth_service import Identity
from app.utils.errors import ErrorCode, NotFoundError
from app.utils.logging import log_event

RecipientRole = Literal["user", "partner"]

# The channel every row this codebase writes carries. 'push' and 'sms' exist in
# the constraint for a delivery worker that does not exist yet; writing either
# of them now would assert a delivery that never happens, which is the defect
# ADR-018's rating trigger is the cautionary tale for.
CHANNEL_IN_APP = "in_app"


# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------
#
# `event` is the contract half of a notification and `message` is the human
# half, the same split the error envelope makes between `code` and `message`.
# Clients branch on the key; the text beside it can be reworded, translated or
# shortened without breaking anything.
#
# This table is the only writer of the `event` column — deliberately, because
# migration 005 declined to put a CHECK constraint on it and this is what stands
# in for one. `test_notification_vocabulary` asserts the two halves of it agree.
NOTIFICATION_EVENTS: dict[str, str] = {
    # To the partner who was just offered the job. Says nothing about where or
    # for whom: the offer's own endpoint (GET /partners/me/offers) carries the
    # distance and service, already filtered to what a partner may see before
    # accepting (ADR-017).
    "job_offered": "You have a new job offer.",
    # To the owner, when a partner accepts. Not "Ramesh accepted" — see the
    # module docstring on why no name goes in here.
    "job_accepted": "A partner has accepted your request.",
    "job_partner_en_route": "Your partner is on the way to you.",
    "job_in_progress": "Work has started on your request.",
    "job_completed": "Your request has been completed.",
    # Two events rather than one 'job_cancelled', because the recipient differs,
    # the wording differs, and — the deciding reason — a client needs to render
    # them differently: one is news about somebody else's decision, the other is
    # the consequence of the reader's own. Collapsing them would force every
    # client to re-derive which happened from its own role.
    "job_cancelled_by_owner": "A job you accepted was cancelled by the owner.",
    "job_cancelled_by_partner": "Your partner cancelled this job. We are finding you another.",
    "job_no_match_found": "We could not find an available partner for your request.",
}

# Which event a status change produces. `cancelled` is absent on purpose: it is
# the one status whose event depends on who caused it, and it is resolved in
# `event_for`.
EVENT_FOR_STATUS: dict[str, str] = {
    "assigned": "job_accepted",
    "partner_en_route": "job_partner_en_route",
    "in_progress": "job_in_progress",
    "completed": "job_completed",
    "no_match_found": "job_no_match_found",
}

# Statuses that notify nobody.
#
# 'requested' is the owner's own button press — telling someone what they just
# did is noise, and it is the only notification that would arrive before the
# client had finished rendering the response that caused it.
#
# 'matching' lands sub-second after 'requested' on the same request (see
# dispatch_service.dispatch_job, which transitions and offers in one call) and
# says nothing the owner can act on. It is the internal state of a search, not
# an event. Suppressing it also keeps the feed's length proportional to things
# that happened rather than to states passed through.
SILENT_STATUSES: frozenset[str] = frozenset({"requested", "matching"})


def event_for(status: str, *, actor_role: Optional[RecipientRole]) -> Optional[str]:
    """The event name for a status change, or None if the change is silent.

    Separate from `recipients_for` because the two answer different questions
    and one can be interesting while the other is empty — a status can be
    silent, or loud with nobody to tell (an owner cancelling a job no partner
    ever held). Keeping them apart is what lets the writer log the difference.
    """
    if status in SILENT_STATUSES:
        return None
    if status == "cancelled":
        return (
            "job_cancelled_by_owner"
            if actor_role == "user"
            else "job_cancelled_by_partner"
        )
    return EVENT_FOR_STATUS.get(status)


def recipients_for(
    status: str, *, actor_role: Optional[RecipientRole]
) -> tuple[RecipientRole, ...]:
    """Who hears about this change: everyone party to the job except whoever did it.

    `actor_role` is None when nothing did it — the dispatcher exhausting its
    candidate pool, or the location store being unreachable. Those still need an
    audience, and with the actor absent the rule resolves to the owner, which is
    the right answer for both.

    Pure, and takes no database and no job, so the rule can be tested as a
    truth table rather than through a fixture. That matters more than it looks:
    this function is the only place the system decides that a partner does not
    get told about their own cancellation, and a rule that can only be exercised
    by running a dispatch is a rule nobody re-checks.
    """
    if status in SILENT_STATUSES:
        return ()
    if actor_role == "user":
        return ("partner",)
    # Covers both actor_role == "partner" and actor_role is None. A partner
    # acted, or nobody did; either way the owner is who is left.
    return ("user",)


# ---------------------------------------------------------------------------
# The writer
# ---------------------------------------------------------------------------


async def notify_job_status_change(
    db: AsyncSession,
    *,
    job: Job,
    status: str,
    actor_role: Optional[RecipientRole],
    partner_ids: Sequence[uuid.UUID] = (),
) -> int:
    """Write the notifications one status change calls for. Returns rows staged.

    **Call this inside the caller's transaction, before its commit.** It stages
    rows and does not flush, so the inserts ride along with the status change
    and the history row in one round trip. A caller that commits before calling
    this has split the pair and has reintroduced exactly the failure mode
    principle 4 exists to prevent, one table over.

    `partner_ids` is only read when the recipient is a partner, which today is
    only an owner's cancellation. It is a sequence rather than a single id
    because a job can carry more than one open assignment in principle, and
    `cancel_job_by_owner` already has the list in hand.

    Raises nothing it can avoid. A status with no event, or an event with no
    reachable recipient, writes nothing and logs why — it must not be an error,
    because "the owner cancelled a job nobody had been offered yet" is the
    ordinary case, not a fault. The one thing that would be a fault, a job with
    no owner, is logged at WARNING and skipped rather than allowed to fail the
    status change it accompanies: a notification is a side record, and losing
    one must never be the reason a job fails to cancel.
    """
    event = event_for(status, actor_role=actor_role)
    if event is None:
        return 0

    message = NOTIFICATION_EVENTS[event]
    written = 0

    for role in recipients_for(status, actor_role=actor_role):
        if role == "user":
            # Nullable in the schema; a job row without an owner should not
            # exist, but the column permits it and recipient_id does not.
            if job.user_id is None:
                log_event(
                    "notification_skipped",
                    level=logging.WARNING,
                    job_id=str(job.id),
                    # Not `event=`: log_event's own first parameter is named
                    # `event`, so that kwarg collides with the event name.
                    notification_event=event,
                    reason="job_has_no_owner",
                    outcome="skipped",
                )
                continue
            await notification_repository.create_notification_row(
                db,
                recipient_type="user",
                recipient_id=job.user_id,
                event=event,
                message=message,
                job_id=job.id,
                channel=CHANNEL_IN_APP,
            )
            written += 1
        else:
            for partner_id in partner_ids:
                await notification_repository.create_notification_row(
                    db,
                    recipient_type="partner",
                    recipient_id=partner_id,
                    event=event,
                    message=message,
                    job_id=job.id,
                    channel=CHANNEL_IN_APP,
                )
                written += 1

    if written == 0:
        log_event(
            "notification_skipped",
            job_id=str(job.id),
            notification_event=event,
            reason="no_reachable_recipient",
            outcome="skipped",
        )
    return written


async def notify_offer(
    db: AsyncSession, *, job_id: uuid.UUID, partner_id: uuid.UUID
) -> None:
    """Tell one partner they have been offered a job.

    Not routed through `notify_job_status_change`, because an offer is not a
    status change: the job is in 'matching' throughout, and 'matching' is
    silent. Dispatch offers one candidate at a time and re-offers only on a
    rejection, so this stays one row per actual offer rather than one per
    candidate considered.

    Takes ids rather than the Job, because its caller (`_create_offer`) has the
    job in a transaction that is about to commit and there is nothing here that
    needs any other column.
    """
    await notification_repository.create_notification_row(
        db,
        recipient_type="partner",
        recipient_id=partner_id,
        event="job_offered",
        message=NOTIFICATION_EVENTS["job_offered"],
        job_id=job_id,
        channel=CHANNEL_IN_APP,
    )


# ---------------------------------------------------------------------------
# The readers
# ---------------------------------------------------------------------------
#
# All four resolve the recipient pair from the verified token and never from
# anything the client sent (principle 5). There is no endpoint parameter that
# names a recipient, so there is no request that can ask for someone else's
# feed — the authorization is structural rather than checked.


def _recipient_of(identity: Identity) -> tuple[RecipientRole, uuid.UUID]:
    """The (recipient_type, recipient_id) pair for the caller.

    `identity.role` and `notifications.recipient_type` are the same vocabulary
    — 'user' or 'partner' — which is not a coincidence: the column was chosen to
    match the token's role rather than introducing a second spelling that would
    need a mapping table and a way to get it wrong.
    """
    return identity.role, identity.local_id


def _items(rows: Iterable) -> list[NotificationItem]:
    return [NotificationItem.model_validate(row) for row in rows]


async def list_notifications(
    db: AsyncSession,
    identity: Identity,
    *,
    limit: int,
    offset: int,
    unread_only: bool = False,
) -> NotificationListResponse:
    """One page of the caller's feed, with the counts a client needs to render it.

    Three queries: the page, the filtered total, and the unread count. The
    unread count is over the whole feed rather than the page, so it is not the
    same number as `total` even when `unread_only` is set and the feed fits in
    one page — `total` answers "how many rows match this filter" and drives
    pagination, `unread_count` answers "what number goes on the badge".

    Returns an empty list and a 200 for an account that has never been notified
    of anything, which is every account's first day. Not a 404: the feed is a
    property of the caller and always exists.
    """
    recipient_type, recipient_id = _recipient_of(identity)

    rows = await notification_repository.list_for_recipient(
        db,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        limit=limit,
        offset=offset,
        unread_only=unread_only,
    )
    total = await notification_repository.count_for_recipient(
        db,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        unread_only=unread_only,
    )
    unread = await notification_repository.count_for_recipient(
        db, recipient_type=recipient_type, recipient_id=recipient_id, unread_only=True
    )

    return NotificationListResponse(
        items=_items(rows),
        unread_count=unread,
        total=total,
        limit=limit,
        offset=offset,
        # Computed from the total rather than from len(rows) == limit, which is
        # wrong on the page that happens to end exactly on the boundary and
        # makes a client fetch one empty page to discover the end.
        has_more=offset + len(rows) < total,
    )


async def unread_count(db: AsyncSession, identity: Identity) -> UnreadCountResponse:
    """The badge, on its own.

    Its own endpoint rather than making clients call the list and read
    `unread_count` off it: this is what a client polls, it is the one read that
    runs whether or not the user has opened the feed, and it is served by the
    partial index alone without touching a row's contents.
    """
    recipient_type, recipient_id = _recipient_of(identity)
    count = await notification_repository.count_for_recipient(
        db, recipient_type=recipient_type, recipient_id=recipient_id, unread_only=True
    )
    return UnreadCountResponse(unread_count=count)


async def mark_notification_read(
    db: AsyncSession, identity: Identity, notification_id: uuid.UUID
) -> MarkReadResponse:
    """Mark one of the caller's notifications read.

    `updated: 0` with a 200 when it was already read. A 409 there would be
    wrong twice over: the client's intent is satisfied either way, and the
    commonest way to reach this state is a retry after a dropped response —
    turning that into an error makes a successful write look like a failure to
    the one caller who cannot tell the difference.

    404 NOTIFICATION_NOT_FOUND for an id that is not the caller's, whether or
    not it exists (principle 6). The existence check only runs when the update
    changed nothing, so the successful path stays at one write; see
    notification_repository.mark_read.
    """
    recipient_type, recipient_id = _recipient_of(identity)

    updated = await notification_repository.mark_read(
        db,
        notification_id=notification_id,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
    )

    if updated == 0:
        exists = await notification_repository.exists_for_recipient(
            db,
            notification_id=notification_id,
            recipient_type=recipient_type,
            recipient_id=recipient_id,
        )
        if not exists:
            # No commit needed — the UPDATE matched nothing, so the transaction
            # has no writes in it to discard.
            log_event(
                "notification_marked_read",
                level=logging.WARNING,
                notification_id=str(notification_id),
                recipient_type=recipient_type,
                outcome="rejected_not_found",
            )
            raise NotFoundError(
                ErrorCode.NOTIFICATION_NOT_FOUND, "Notification not found"
            )

    await db.commit()

    count = await notification_repository.count_for_recipient(
        db, recipient_type=recipient_type, recipient_id=recipient_id, unread_only=True
    )
    log_event(
        "notification_marked_read",
        notification_id=str(notification_id),
        recipient_type=recipient_type,
        updated=updated,
        unread_after=count,
        outcome="success",
    )
    return MarkReadResponse(updated=updated, unread_count=count)


async def mark_all_notifications_read(
    db: AsyncSession, identity: Identity
) -> MarkReadResponse:
    """Mark everything in the caller's feed read.

    The count afterwards is zero by construction, so it is returned rather than
    re-queried — asking the database to confirm what the statement just
    guaranteed is a round trip that can only ever answer 0.
    """
    recipient_type, recipient_id = _recipient_of(identity)

    updated = await notification_repository.mark_all_read(
        db, recipient_type=recipient_type, recipient_id=recipient_id
    )
    await db.commit()

    log_event(
        "notifications_marked_all_read",
        recipient_type=recipient_type,
        updated=updated,
        outcome="success",
    )
    return MarkReadResponse(updated=updated, unread_count=0)
