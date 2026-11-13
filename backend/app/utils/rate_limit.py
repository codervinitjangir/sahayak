"""Fixed-window rate limiting on Redis, for the unauthenticated endpoints.

One INCR per request on ``ratelimit:{bucket}:{caller}:{minute}``, with the key
expiring after the window. Fixed-window rather than sliding because the goal is
only to stop scraping and brute force, not to shape traffic, and fixed-window
is one round trip.

Fails open: if Redis is unreachable the request is allowed and the failure is
logged. The endpoints this guards are read-only, so being briefly unlimited
during a Redis outage costs less than refusing a family member watching a
rescue.
"""
import logging
import time

from fastapi import Request

from app.config.redis_client import get_redis
from app.utils.errors import AppError
from app.utils.logging import log_event

# The tracking page polls every 5 s (12/min); 60 leaves room for several tabs
# and reloads behind one NAT while making a token brute force pointless.
PUBLIC_TRACKING_PER_MINUTE = 60
WINDOW_SECONDS = 60


async def check(bucket: str, caller: str, limit: int) -> None:
    """Count one request for `caller` in `bucket`; raise 429 past `limit`."""
    window = int(time.time()) // WINDOW_SECONDS
    key = f"ratelimit:{bucket}:{caller}:{window}"
    try:
        client = get_redis()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, WINDOW_SECONDS + 5)
    except Exception as exc:  # noqa: BLE001 - fail open, see module docstring
        log_event(
            "rate_limit_unavailable",
            level=logging.WARNING,
            bucket=bucket,
            error_type=type(exc).__name__,
            outcome="failure",
        )
        return

    if count > limit:
        raise AppError(
            status_code=429,
            code="RATE_LIMITED",
            message="Too many requests. Please wait a minute and try again.",
            headers={"Retry-After": str(WINDOW_SECONDS)},
        )


def caller_of(request: Request) -> str:
    """The caller's address as uvicorn resolved it.

    Behind Render's proxy this is the real client only when uvicorn runs with
    --proxy-headers (it does on Render). X-Forwarded-For is never read here
    directly: a client can write anything into it, which would let them pick a
    fresh budget per request.
    """
    return request.client.host if request.client else "unknown"


async def limit_public_tracking(request: Request) -> None:
    """Dependency for GET /jobs/{id}/public-tracking."""
    await check("public-tracking", caller_of(request), PUBLIC_TRACKING_PER_MINUTE)
