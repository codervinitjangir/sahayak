"""
Application errors that carry a stable machine-readable code.

The API contract is `{"error": {"code": ..., "message": ...}, "request_id": ...}`,
which means every failure needs a code a client can branch on. Plain
HTTPException only carries a human message, so AppError adds the code while
staying an HTTPException — FastAPI keeps handling it natively, and the service
layer still reads as "raise 404 here".

Messages are written for a human; codes are the part clients are allowed to
depend on, so they change only with an API version.
"""
from typing import Optional

from fastapi import HTTPException


class ErrorCode:
    """The stable, machine-readable half of every error response.

    Collected in one place so a code is defined once and reused across
    features rather than retyped as a literal — INVALID_SERVICE_CODE means the
    same thing whether a job or a partner is being created, and a client that
    branches on it must not have to care which endpoint produced it.

    These are API contract: they change only with an API version.
    """

    # Shared
    INVALID_SERVICE_CODE = "INVALID_SERVICE_CODE"
    INTERNAL_ERROR = "INTERNAL_ERROR"

    # Auth
    #
    # UNAUTHORIZED covers every "we could not establish who you are" case —
    # missing header, wrong scheme, bad signature, expired, no `sub`. They are
    # deliberately one code: telling a caller *which* part of their token failed
    # helps an attacker probing for a valid one far more than it helps a client,
    # and a client's response is identical in all cases (re-authenticate).
    UNAUTHORIZED = "UNAUTHORIZED"
    # FORBIDDEN is the opposite: identity is established, the action is not
    # permitted. A partner touching another partner's profile, or a user calling
    # a partner-only route.
    FORBIDDEN = "FORBIDDEN"
    # Valid Supabase token, but its `sub` matches no row in users or partners.
    # Separate from both of the above because it is the one auth failure with a
    # specific client remedy: call link-auth. 403 rather than 401 — the token is
    # genuine, there is simply no profile behind it yet.
    IDENTITY_NOT_LINKED = "IDENTITY_NOT_LINKED"
    # The target row already points at a different Supabase account. Refusing is
    # what stops a second account from claiming a partner profile that is
    # already in use.
    AUTH_ALREADY_LINKED = "AUTH_ALREADY_LINKED"

    # Jobs
    VEHICLE_NOT_FOUND = "VEHICLE_NOT_FOUND"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"

    # Dispatch
    #
    # The job has already left 'requested', so dispatch has run for it. Its own
    # code rather than a bare 409 because the client's remedy is specific and
    # not a retry: stop asking, read the job and show its current assignment.
    JOB_ALREADY_DISPATCHED = "JOB_ALREADY_DISPATCHED"
    ASSIGNMENT_NOT_FOUND = "ASSIGNMENT_NOT_FOUND"
    # The offer was already accepted, rejected or timed out. Distinct from
    # JOB_ALREADY_DISPATCHED because it is the *partner's* view of a race —
    # typically their own second tap, or an offer that expired under them — and
    # a partner app should refresh its offer list, not the job.
    ASSIGNMENT_ALREADY_ANSWERED = "ASSIGNMENT_ALREADY_ANSWERED"

    # Partners
    PARTNER_ALREADY_EXISTS = "PARTNER_ALREADY_EXISTS"
    PARTNER_NOT_FOUND = "PARTNER_NOT_FOUND"
    INVALID_CATEGORY_CODE = "INVALID_CATEGORY_CODE"

    # Users
    USER_NOT_FOUND = "USER_NOT_FOUND"


# Codes for HTTPExceptions raised by FastAPI itself (unknown route, unsupported
# method) or by third-party dependencies, which never went through AppError.
_DEFAULT_CODES = {
    400: "BAD_REQUEST",
    # Matches ErrorCode.UNAUTHORIZED on purpose: a client branching on the code
    # must not have to handle two spellings of the same condition depending on
    # whether our code or Starlette's produced the 401.
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    503: "SERVICE_UNAVAILABLE",
}


def default_code_for_status(status_code: int) -> str:
    """Best-effort error code for an exception that did not supply one."""
    if status_code in _DEFAULT_CODES:
        return _DEFAULT_CODES[status_code]
    return "SERVER_ERROR" if status_code >= 500 else "REQUEST_ERROR"


class AppError(HTTPException):
    """An HTTPException plus the error code that goes into the response body."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Optional[list[str]] = None,
        headers: Optional[dict] = None,
    ) -> None:
        # headers is forwarded to HTTPException rather than stored separately so
        # that error_handlers.http_exception_handler, which reads exc.headers,
        # picks it up. It exists for WWW-Authenticate on 401s, which RFC 9110
        # requires on that status.
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code
        self.message = message
        self.details = details


class NotFoundError(AppError):
    """Requested row does not exist, or the caller is not allowed to see it."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(status_code=404, code=code, message=message)


class BadRequestError(AppError):
    """Request was well-formed but asks for something invalid."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(status_code=400, code=code, message=message)


class UnauthorizedError(AppError):
    """Caller's identity could not be established — no token, or a bad one.

    Carries `WWW-Authenticate: Bearer` because RFC 9110 requires a 401 to say
    how to authenticate. Without it a strict HTTP client cannot tell a genuine
    auth challenge from a misconfigured endpoint.

    The default message is deliberately vague. Distinguishing "expired" from
    "bad signature" in a response body tells an attacker which of their guesses
    was closer; a legitimate client's next move is the same either way.
    """

    def __init__(
        self,
        message: str = "Authentication required.",
        code: str = ErrorCode.UNAUTHORIZED,
    ) -> None:
        super().__init__(
            status_code=401,
            code=code,
            message=message,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenError(AppError):
    """Identity is known; this action is not permitted for it."""

    def __init__(self, code: str = ErrorCode.FORBIDDEN, message: str = "Not permitted.") -> None:
        super().__init__(status_code=403, code=code, message=message)


class ConflictError(AppError):
    """Request contradicts the current state of the resource."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(status_code=409, code=code, message=message)


class InternalError(AppError):
    """Something on our side failed; the client can safely retry."""

    def __init__(
        self, message: str = "An unexpected error occurred.", code: str = "INTERNAL_ERROR"
    ) -> None:
        super().__init__(status_code=500, code=code, message=message)
