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

    # Jobs
    VEHICLE_NOT_FOUND = "VEHICLE_NOT_FOUND"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"

    # Partners
    PARTNER_ALREADY_EXISTS = "PARTNER_ALREADY_EXISTS"
    PARTNER_NOT_FOUND = "PARTNER_NOT_FOUND"
    INVALID_CATEGORY_CODE = "INVALID_CATEGORY_CODE"


# Codes for HTTPExceptions raised by FastAPI itself (unknown route, unsupported
# method) or by third-party dependencies, which never went through AppError.
_DEFAULT_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
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
    ) -> None:
        super().__init__(status_code=status_code, detail=message)
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


class InternalError(AppError):
    """Something on our side failed; the client can safely retry."""

    def __init__(
        self, message: str = "An unexpected error occurred.", code: str = "INTERNAL_ERROR"
    ) -> None:
        super().__init__(status_code=500, code=code, message=message)
