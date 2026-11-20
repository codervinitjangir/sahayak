"""Critical admin alerts pushed to a staff channel (ADR-047).

`GET /admin/alerts` only helps a person who has the board open. This sends the
critical ones (stuck jobs, nobody on duty, partners cancelling after the start
code, off-app payment reports) to one webhook: a Slack or Google Chat incoming
webhook, a Discord webhook, or anything that accepts a JSON POST.

* **Off unless configured.** STAFF_ALERT_WEBHOOK_URL blank means nothing is sent.
* **Once per incident, then a reminder.** An alert is sent when it appears and
  again every STAFF_ALERT_REPEAT_MIN while it stays; "cleared" is sent when it
  goes away. The bookkeeping is in Redis with SET NX, so several API processes
  running the same worker send one message, not one each.
* **No personal data.** Counts and the alert's own wording only: no names,
  phones, addresses or ids. The console is where staff see who.
* **Never breaks the worker.** A failed POST is logged, and the reminder key is
  released so the next tick tries again.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config.database import AsyncSessionLocal
from app.config.redis_client import get_redis
from app.config.settings import get_settings
from app.services import admin_ops_service
from app.utils.logging import log_event

SENT_KEY = "staff_alert:sent:{code}"      # exists while a reminder is not yet due
ACTIVE_KEY = "staff_alert:active"         # set of codes we last reported as active
CHECK_EVERY_S = 60
_last_check: Optional[datetime] = None


def _text(alert) -> str:
    return f"Sahayak alert [{alert.code}]: {alert.message} Open the admin console to act."


def _cleared_text(code: str) -> str:
    return f"Sahayak alert cleared [{code}]."


async def _post(url: str, text: str) -> bool:
    # "text" for Slack and Google Chat, "content" for Discord; each ignores the other.
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(url, json={"text": text, "content": text})
    except httpx.HTTPError as exc:
        log_event("staff_alert_send_failed", level=logging.WARNING, error_type=type(exc).__name__, outcome="failure")
        return False
    if r.status_code >= 300:
        log_event("staff_alert_send_failed", level=logging.WARNING, status_code=r.status_code, outcome="failure")
        return False
    return True


async def notify_once(alerts, url: str, repeat_s: int) -> dict:
    """Send what is due for this set of alerts. Pure apart from Redis and the POST."""
    redis = get_redis()
    critical = {a.code: a for a in alerts if a.severity == "critical"}
    sent, cleared = [], []
    for code, alert in critical.items():
        key = SENT_KEY.format(code=code)
        if not await redis.set(key, "1", nx=True, ex=repeat_s):
            continue  # already told staff; reminder not due yet
        if await _post(url, _text(alert)):
            await redis.sadd(ACTIVE_KEY, code)
            sent.append(code)
        else:
            await redis.delete(key)  # try again next tick
    for code in await redis.smembers(ACTIVE_KEY):
        code = code.decode() if isinstance(code, bytes) else code
        if code in critical:
            continue
        # SREM first: only the process that removes it sends "cleared".
        if await redis.srem(ACTIVE_KEY, code):
            await redis.delete(SENT_KEY.format(code=code))
            await _post(url, _cleared_text(code))
            cleared.append(code)
    if sent or cleared:
        log_event("staff_alerts_sent", sent=sent, cleared=cleared, outcome="success")
    return {"sent": sent, "cleared": cleared}


async def check(session_factory=AsyncSessionLocal, now: Optional[datetime] = None) -> Optional[dict]:
    """Called from the dispatch worker every tick; does the work once a minute."""
    global _last_check
    settings = get_settings()
    url = settings.STAFF_ALERT_WEBHOOK_URL.strip()
    if not url:
        return None
    now = now or datetime.now(timezone.utc)
    if _last_check is not None and (now - _last_check).total_seconds() < CHECK_EVERY_S:
        return None
    _last_check = now
    async with session_factory() as db:
        response = await admin_ops_service.get_alerts(db)
    return await notify_once(response.alerts, url, max(60, settings.STAFF_ALERT_REPEAT_MIN * 60))
