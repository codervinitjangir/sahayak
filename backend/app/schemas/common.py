"""
Envelope schemas shared by every endpoint.

Successful responses are `{"data": ..., "meta": {"request_id": ...}}` and
failures are `{"error": {"code": ..., "message": ...}, "request_id": ...}`.
Wrapping costs one level of nesting and buys two things: a correlation id on
every response (so a user can quote one in a support request), and room to add
pagination or deprecation notices to `meta` later without breaking clients that
already read `data`.
"""
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, Field

from app.utils.request_context import get_request_id

DataT = TypeVar("DataT")


class Meta(BaseModel):
    """Response metadata that is not part of the resource itself."""

    request_id: str = Field(
        ..., description="Correlation id, also returned as the X-Request-ID header."
    )


class ApiResponse(BaseModel, Generic[DataT]):
    """Standard success envelope. `data` holds the endpoint's own payload."""

    data: DataT
    meta: Meta


class ErrorDetail(BaseModel):
    """The machine-readable part of a failure.

    `code` is the contract — clients branch on it and it only changes with an
    API version. `message` is for humans and may be reworded at any time.
    """

    code: str = Field(..., examples=["INVALID_SERVICE_CODE"])
    message: str
    details: Optional[list[str]] = Field(
        default=None,
        description="Per-field problems, populated for validation failures.",
    )


class ErrorResponse(BaseModel):
    """Standard failure envelope."""

    error: ErrorDetail
    request_id: str


class HealthResponse(BaseModel):
    """Liveness payload: the process answered, and whether its database did."""

    status: str
    database: str


def envelope(data: object) -> dict:
    """Wrap a payload in the success envelope, stamping the current request id.

    Returns a plain dict on purpose: the route declares
    `response_model=ApiResponse[Something]`, so FastAPI validates and serialises
    `data` against the real schema and the OpenAPI document stays accurate.
    """
    return {"data": data, "meta": {"request_id": get_request_id()}}
