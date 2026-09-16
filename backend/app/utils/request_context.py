"""
Per-request correlation id.

Every response envelope and every structured log line has to carry the same
request_id, so "why did this job take ninety seconds?" becomes a log query
instead of guesswork. The id is held in a ContextVar rather than threaded
through every function signature, because the service and repository layers
also run from the dispatch worker, where there is no Request object to pass
down.
"""
import uuid
from contextvars import ContextVar

# Empty default means "nobody has started a request yet" — get_request_id()
# mints one on demand so a background task still produces correlated logs.
_request_id: ContextVar[str] = ContextVar("request_id", default="")

#: Inbound/outbound header used to join our logs to a caller's or a proxy's.
REQUEST_ID_HEADER = "X-Request-ID"


def new_request_id() -> str:
    """Mint a fresh correlation id."""
    return str(uuid.uuid4())


def set_request_id(value: str) -> None:
    """Bind a correlation id to the current task/request."""
    _request_id.set(value)


def get_request_id() -> str:
    """Return the current correlation id, creating one if none is bound.

    Falling back to a generated id (instead of returning an empty string) keeps
    the response envelope and the log schema honest: a caller always gets an id
    it can quote back to us in a support request.
    """
    current = _request_id.get()
    if not current:
        current = new_request_id()
        _request_id.set(current)
    return current
