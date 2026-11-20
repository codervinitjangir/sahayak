"""
The dispatch worker: the part of dispatch that runs on a clock (ADR-032).

Two jobs, both of which used to depend on somebody's app being open:

  * **Offer timeout.** An offer nobody answers within OFFER_TTL_S is marked
    'timed_out' and the job goes to the next-best partner. Before this, an
    unanswered offer sat forever and the owner waited until they gave up.
  * **Search escalation.** A 'no_match_found' job inside its ten-minute window
    is searched for again, wider (ADR-023). Before this, only the owner's
    searching screen drove that, so closing or backgrounding the app (a phone
    call, a dead battery) stopped the search.

**Where it runs.** An asyncio task started in the FastAPI lifespan of every API
process, not a separate service. One deployable unit is the stance of ADR-006,
and the work is small: two indexed reads per tick, plus one short transaction
per item found.

**Why several processes running it at once is safe.** There is no leader
election. Every item is re-checked under the job's row lock before anything is
written (dispatch_service.expire_offer, _widen_search), the same rule every
other dispatch mutation follows (ADR-015). Two sweeps that pick the same item
queue on the lock, and the second sees the first one's committed result and
does nothing. The cost of overlap is a repeated read and a repeated candidate
search, which is fine for the 1–3 processes this system runs. If that number
grows, a Postgres advisory lock around sweep_once is the upgrade, and it changes
nothing about correctness.

**One session per item.** A failure on one job (Redis down, a constraint
error) is logged and the sweep moves on; it cannot leave a half-done
transaction that poisons the next item, and it never kills the loop.
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from app.config.database import AsyncSessionLocal
from app.repositories import dispatch_repository
from app.services import dispatch_service
from app.utils.logging import log_event
from app.utils.scoring import OFFER_TTL_S, ORPHAN_REQUESTED_S, SEARCH_WINDOW_S


@dataclass
class SweepResult:
    """What one sweep did, for logs and tests."""

    offers_checked: int = 0
    reoffered: int = 0
    jobs_searched: int = 0
    jobs_rescued: int = 0
    requests_expired: int = 0
    errors: list[str] = field(default_factory=list)


async def _each(session_factory, ids: list[uuid.UUID], action: Callable[..., Awaitable], kind: str, result: SweepResult):
    """Run `action(db, id)` for every id, each in its own session."""
    outcomes = []
    for item_id in ids:
        try:
            async with session_factory() as db:
                outcomes.append(await action(db, item_id))
        except Exception as exc:  # noqa: BLE001 - the sweep must survive any one item
            result.errors.append(f"{kind}:{item_id}:{type(exc).__name__}")
            log_event(
                "dispatch_worker_item_failed",
                level=logging.ERROR,
                kind=kind,
                item_id=str(item_id),
                error_type=type(exc).__name__,
                outcome="failure",
            )
            outcomes.append(None)
    return outcomes


async def sweep_once(session_factory=AsyncSessionLocal, now: Optional[datetime] = None) -> SweepResult:
    """One pass: time out stale offers, then widen searches that found nobody.

    Offers first, on purpose: a timeout whose next search finds nobody moves
    its job to 'no_match_found', and the second half of the same sweep can then
    widen that search straight away instead of waiting a tick.
    """
    now = now or datetime.now(timezone.utc)
    result = SweepResult()

    async with session_factory() as db:
        offer_ids = await dispatch_repository.get_expired_offer_ids(
            db, offered_before=now - timedelta(seconds=OFFER_TTL_S)
        )
    result.offers_checked = len(offer_ids)

    async def expire(db, assignment_id):
        return await dispatch_service.expire_offer(db, assignment_id, now=now)

    # Counts only offers passed on. A timeout with nobody left to ask, and an
    # item skipped under the lock, both return None; expire_offer's own log
    # line (offer_timed_out / offer_timeout_skipped) says which it was.
    for nxt in await _each(session_factory, offer_ids, expire, "offer", result):
        if nxt is not None:
            result.reoffered += 1

    async with session_factory() as db:
        job_ids = await dispatch_repository.get_searchable_job_ids(
            db, requested_after=now - timedelta(seconds=SEARCH_WINDOW_S)
        )
    result.jobs_searched = len(job_ids)

    for status in await _each(session_factory, job_ids, dispatch_service.widen_search_for_job, "search", result):
        if status is not None and status.assignment is not None:
            result.jobs_rescued += 1

    # Third (ADR-036): a job still 'requested' long after it was raised was
    # never dispatched; nothing else will move it, so it is cancelled.
    async with session_factory() as db:
        orphan_ids = await dispatch_repository.get_orphaned_requested_job_ids(
            db, requested_before=now - timedelta(seconds=ORPHAN_REQUESTED_S)
        )

    async def expire_request(db, job_id):
        return await dispatch_service.expire_orphaned_request(db, job_id, now=now)

    for done in await _each(session_factory, orphan_ids, expire_request, "request", result):
        if done:
            result.requests_expired += 1

    if offer_ids or job_ids or orphan_ids or result.errors:
        log_event(
            "dispatch_worker_sweep",
            offers_checked=result.offers_checked,
            reoffered=result.reoffered,
            jobs_searched=result.jobs_searched,
            jobs_rescued=result.jobs_rescued,
            requests_expired=result.requests_expired,
            error_count=len(result.errors),
            outcome="success" if not result.errors else "partial",
        )
    return result


async def run_forever(interval_s: float, session_factory=AsyncSessionLocal) -> None:
    """Sweep every `interval_s` seconds until cancelled.

    A sweep that raises (the database unreachable for the work-list read) is
    logged and retried next tick; only cancellation ends the loop.
    """
    log_event("dispatch_worker_started", interval_s=interval_s, offer_ttl_s=OFFER_TTL_S, outcome="success")
    try:
        while True:
            try:
                await sweep_once(session_factory)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                log_event(
                    "dispatch_worker_sweep",
                    level=logging.ERROR,
                    error_type=type(exc).__name__,
                    outcome="failure",
                )
            await asyncio.sleep(interval_s)
    except asyncio.CancelledError:
        log_event("dispatch_worker_stopped", outcome="success")
        raise
