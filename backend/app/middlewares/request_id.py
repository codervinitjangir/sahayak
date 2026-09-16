"""
Correlation-id middleware.

Binds one id to every request, returns it on the response, and makes it
available to the service and repository layers through a ContextVar so log
lines from all three layers join up.

An inbound X-Request-ID is honoured — that is how a mobile client's or a
proxy's trace stitches to ours — but only after validation. The value ends up
in log lines, so accepting arbitrary caller text would let anyone forge log
entries by embedding newlines and JSON in a header.
"""
import re
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp

from app.utils.logging import log_event
from app.utils.request_context import (
    REQUEST_ID_HEADER,
    new_request_id,
    set_request_id,
)

# Conservative: printable, no whitespace, bounded length. Covers UUIDs and the
# hex/dash trace ids proxies generate, and rejects anything log-injectable.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign, propagate and log the correlation id for each request."""

    def __init__(self, app: ASGIApp, log_requests: bool = True) -> None:
        super().__init__(app)
        self.log_requests = log_requests

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _SAFE_REQUEST_ID.match(incoming) else new_request_id()

        set_request_id(request_id)
        request.state.request_id = request_id

        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 2)

        response.headers[REQUEST_ID_HEADER] = request_id

        if self.log_requests:
            # The route template rather than request.url.path, so log volume
            # groups by endpoint instead of exploding one series per job id.
            route = request.scope.get("route")
            log_event(
                "http_request",
                method=request.method,
                path=getattr(route, "path", request.url.path),
                status_code=response.status_code,
                duration_ms=duration_ms,
                outcome="success" if response.status_code < 400 else "failure",
            )

        return response
