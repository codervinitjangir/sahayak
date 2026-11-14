"""Push notifications through the Expo push service (ADR-026).

The in-app notification row stays the source of truth (ADR-019). A push is a
copy of that row sent to the recipient's devices **after the transaction that
wrote the row commits**:

  * notification_repository.create_notification_row calls `stage()`, which
    parks the push in the session's `info` dict;
  * a SQLAlchemy `after_commit` listener hands everything staged to a
    background task; `after_rollback` drops it.

So a status change that rolls back never pushes, and the network call to Expo
never sits inside a database transaction or holds a row lock. Delivery is
best-effort: failures are logged and the in-app feed still has the row.

Message text is the same generic sentence the feed shows (ADR-019 keeps names
and numbers out of it), so a lock-screen preview leaks nothing ADR-017 withholds.
"""
import asyncio
import logging
import uuid
from typing import Any, Iterable, Optional

from sqlalchemy import delete, event, select, tuple_
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models.device_push_token import DevicePushToken
from app.utils.logging import log_event

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_INFO_KEY = "sahayak_push_outbox"
_CHUNK = 100  # Expo's per-request limit
_tasks: set[asyncio.Task] = set()  # keep references so tasks are not GC'd mid-flight


def stage(db: Any, *, recipient_type: str, recipient_id: uuid.UUID, message: Optional[str],
          event_name: str, job_id: Optional[uuid.UUID]) -> None:
    """Remember a push to send if, and only if, this session's transaction commits."""
    sync = getattr(db, "sync_session", db)
    info = getattr(sync, "info", None)
    if not isinstance(info, dict):  # a test double, not a real session
        return
    info.setdefault(_INFO_KEY, []).append({
        "recipient_type": recipient_type,
        "recipient_id": recipient_id,
        "message": message or "",
        "event": event_name,
        "job_id": str(job_id) if job_id else None,
    })


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    items = session.info.pop(_INFO_KEY, None)
    if not items or not get_settings().PUSH_ENABLED:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # a sync caller (scripts); nothing to schedule on
    task = loop.create_task(deliver(items))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(_INFO_KEY, None)


async def drain(timeout: float = 15.0) -> int:
    """Wait for in-flight deliveries; returns how many were still pending.

    Called on shutdown so a deploy does not drop pushes that were already
    committed to, and by harnesses that measure the connection pool (each
    delivery borrows a pooled connection for its token lookup).
    """
    pending = list(_tasks)
    if pending:
        await asyncio.wait(pending, timeout=timeout)
    return len(pending)


def build_messages(items: Iterable[dict], tokens_by_owner: dict[tuple[str, uuid.UUID], list[str]]) -> list[dict]:
    """One Expo message per (staged push, device). Pure, for testing."""
    out = []
    for item in items:
        for token in tokens_by_owner.get((item["recipient_type"], item["recipient_id"]), []):
            out.append({
                "to": token,
                "title": "Sahayak",
                "body": item["message"],
                "sound": "default",
                "priority": "high",
                "data": {"event": item["event"], "job_id": item["job_id"]},
            })
    return out


async def deliver(items: list[dict]) -> int:
    """Look up devices, send, prune dead tokens. Returns messages sent. Never raises."""
    from app.config.database import AsyncSessionLocal  # late: avoids an import cycle

    try:
        owners = list({(i["recipient_type"], i["recipient_id"]) for i in items})
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(DevicePushToken.owner_type, DevicePushToken.owner_id, DevicePushToken.token)
                .where(tuple_(DevicePushToken.owner_type, DevicePushToken.owner_id).in_(owners))
            )).all()
        by_owner: dict = {}
        for owner_type, owner_id, token in rows:
            by_owner.setdefault((owner_type, owner_id), []).append(token)
        messages = build_messages(items, by_owner)
        if not messages:
            return 0
        dead = await _send(messages)
        if dead:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(DevicePushToken).where(DevicePushToken.token.in_(dead)))
                await db.commit()
        log_event("push_sent", messages=len(messages), pruned=len(dead), outcome="success")
        return len(messages)
    except Exception as exc:  # noqa: BLE001 - a push must never break anything
        log_event("push_failed", level=logging.WARNING, error_type=type(exc).__name__, outcome="failure")
        return 0


async def _send(messages: list[dict]) -> list[str]:
    """POST to Expo in chunks. Returns tokens Expo says are no longer registered."""
    import httpx

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    access_token = get_settings().EXPO_ACCESS_TOKEN
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    dead: list[str] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for start in range(0, len(messages), _CHUNK):
            chunk = messages[start:start + _CHUNK]
            r = await client.post(EXPO_PUSH_URL, json=chunk, headers=headers)
            if r.status_code != 200:
                log_event("push_rejected", level=logging.WARNING, status_code=r.status_code, outcome="failure")
                continue
            for msg, ticket in zip(chunk, r.json().get("data", [])):
                if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.append(msg["to"])
    return dead
