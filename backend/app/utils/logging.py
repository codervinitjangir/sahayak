"""
Structured JSON logging.

One JSON object per line with a fixed field set (timestamp, level, event,
request_id, ..., outcome) so logs are queryable rather than greppable. Named
events — job_created, matching_started, offer_accepted, no_match — are what
dashboards and "why was this job slow" investigations are built on, so the
event name is a required argument rather than an afterthought buried in a
message string.

Anything that can identify or locate a person is refused here rather than
trusted to callers: phone numbers, tokens, OTPs and exact coordinates must not
reach the log store, so keys carrying them are replaced with "[redacted]".
"""
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from app.utils.request_context import get_request_id

LOGGER_NAME = "sahayak"

# Field names that must never be logged in the clear. Redacting on the way out
# is a backstop, not the rule itself: the point is that adding a log line
# cannot quietly create a privacy incident even if its author forgot the rule.
_REDACTED_KEYS = frozenset(
    {
        "phone",
        "partner_phone",
        "user_phone",
        "otp",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "password",
        "pickup_lat",
        "pickup_lng",
        "latitude",
        "longitude",
        "lat",
        "lng",
        # A registration number identifies one specific car, and joined to the
        # owner row two columns away, one specific person. It is never passed to
        # log_event by our own code; this entry is the backstop for the line
        # somebody adds in a hurry while debugging a dispatch problem.
        "vehicle_number",
    }
)

_logger = logging.getLogger(LOGGER_NAME)


def configure_logging(level: int = logging.INFO) -> None:
    """Send this logger's records to stdout as bare JSON lines.

    propagate is switched off and the formatter is just the message, because
    uvicorn's root handler would otherwise wrap each line in its own
    human-readable prefix and the result would no longer parse as JSON.
    """
    _logger.setLevel(level)
    _logger.propagate = False
    if not _logger.handlers:
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        _logger.addHandler(handler)


def log_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    """Emit one structured log line for a named domain event.

    request_id is attached automatically so callers never have to remember it,
    and None-valued fields are dropped so a line stays readable when an
    optional id (assignment_id, duration_ms) does not apply yet.

    Args:
        event: stable event name, e.g. "job_created".
        level: standard logging level for the line.
        **fields: extra context — job_id, outcome, duration_ms, actor_role.
    """
    payload: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": logging.getLevelName(level),
        "event": event,
        "request_id": get_request_id(),
    }

    for key, value in fields.items():
        if value is None:
            continue
        payload[key] = "[redacted]" if key.lower() in _REDACTED_KEYS else value

    # default=str so UUIDs, Decimals and datetimes serialise instead of raising
    # inside the logging call — a broken log line must never break a request.
    _logger.log(level, json.dumps(payload, default=str))
