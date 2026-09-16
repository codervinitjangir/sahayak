"""
Exception handlers that render every failure in the standard error envelope.

Without these, three different shapes would leak out of the API: FastAPI's
`{"detail": "..."}` for HTTPException, its nested list for validation errors,
and a bare 500 page for anything unhandled. Clients would have to parse all
three. Registering handlers centrally means the contract is guaranteed by the
application, not by each route remembering to comply.

Unexpected exceptions are logged with a traceback and answered with a generic
message: the stack trace belongs in our logs, not in a response body, where it
would advertise file paths and library versions.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import ErrorDetail, ErrorResponse
from app.utils.errors import AppError, default_code_for_status
from app.utils.logging import log_event
from app.utils.request_context import get_request_id


def _error_response(
    status_code: int,
    code: str,
    message: str,
    details: list[str] | None = None,
    headers: dict | None = None,
) -> JSONResponse:
    """Build a JSONResponse carrying the error envelope and the request id."""
    body = ErrorResponse(
        error=ErrorDetail(code=code, message=message, details=details),
        request_id=get_request_id(),
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(exclude_none=True),
        headers=headers,
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Render HTTPException — ours and FastAPI's own — as an error envelope.

    AppError supplies its own code; anything else (an unknown route, a 405)
    gets one derived from the status so no response is ever missing a code.
    """
    if isinstance(exc, AppError):
        code, message, details = exc.code, exc.message, exc.details
    else:
        code = default_code_for_status(exc.status_code)
        message = str(exc.detail)
        details = None

    return _error_response(
        status_code=exc.status_code,
        code=code,
        message=message,
        details=details,
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Flatten Pydantic's validation report into `details` as "field: problem".

    Pydantic's raw error list is precise but awkward to display, and its `loc`
    tuples expose internals like "body". Clients get one stable code plus a
    readable line per bad field.
    """
    details = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"] if part != "body")
        details.append(f"{location}: {error['msg']}" if location else error["msg"])

    return _error_response(
        status_code=422,
        code="VALIDATION_ERROR",
        message="Request body or parameters failed validation.",
        details=details or None,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last resort: log the real cause, return a generic 500."""
    log_event(
        "unhandled_exception",
        level=logging.ERROR,
        path=request.url.path,
        method=request.method,
        error_type=type(exc).__name__,
        outcome="failure",
    )
    logging.getLogger("sahayak").exception("Unhandled exception", exc_info=exc)

    return _error_response(
        status_code=500,
        code="INTERNAL_ERROR",
        message="An unexpected error occurred.",
    )


def register_error_handlers(app: FastAPI) -> None:
    """Attach all envelope-producing handlers to the application."""
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
