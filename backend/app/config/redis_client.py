"""
Redis connection for live partner positions.

One lazily-created async client for the whole process, mirroring how
app/config/database.py owns the one SQLAlchemy engine. redis-py's async client
is a connection *pool* and is safe to share across concurrent requests, so
creating one per request would only churn TCP connections.

What lives in Redis, and what does not:

  * ``sahayak:partner_locations`` — a GEO set of every partner who has reported
    a position. Written by the location endpoint, read by dispatch's radius
    search.
  * ``partner:{id}:location_updated_at`` — when that position last moved, so a
    stale coordinate can be recognised as stale rather than trusted.

Nothing durable. A partner's identity, verification status and availability all
live in Postgres; Redis only answers "where are they *right now*", a question
whose answer is wrong within minutes anyway. Flushing this database loses
nothing that cannot be rebuilt by partners reporting in again.

Keys are namespaced because this may not stay a dedicated instance forever.
"""
import logging
from typing import Optional

import redis.asyncio as redis

from app.config.settings import get_settings
from app.utils.errors import InternalError
from app.utils.logging import log_event

# The GEO set every partner position is written into and searched from.
PARTNER_LOCATIONS_KEY = "sahayak:partner_locations"


def location_updated_at_key(partner_id) -> str:
    """Key holding the epoch seconds at which a partner last reported a position.

    Kept beside the GEO set rather than inside it because a GEO set stores
    coordinates and nothing else — there is no per-member timestamp to hang this
    on. Dispatch needs it to tell a partner who is genuinely 400 m away from one
    whose phone died 400 m away two hours ago.
    """
    return f"partner:{partner_id}:location_updated_at"


_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    """Return the process-wide async Redis client, creating it on first use.

    Lazy rather than created at import time so that importing this module — as
    every test collection does — cannot fail on a machine with no Redis, and so
    the connection is opened in the running event loop rather than whichever one
    happened to be current at import.

    decode_responses=True because everything stored here is text: member ids and
    a timestamp. Callers should not have to .decode() a partner id.
    """
    global _client
    if _client is None:
        url = get_settings().REDIS_URL
        if not url:
            log_event(
                "redis_misconfigured",
                level=logging.ERROR,
                reason="REDIS_URL is not set",
                outcome="failure",
            )
            raise InternalError("Location services are not configured on this server.")
        _client = redis.from_url(url, decode_responses=True)
    return _client


def set_redis_client(client) -> None:
    """Replace the process-wide client. Tests only.

    This exists so the dispatch harness can run against an in-process fake
    without a Redis server, and without any production code path knowing which
    it got. It is an override rather than a settings switch on purpose: a
    "use the fake" flag readable from the environment is a flag that can be set
    in production.
    """
    global _client
    _client = client


async def close_redis() -> None:
    """Close the client and forget it. Called from the app's lifespan shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
