"""Client crash reports (ADR-037).

Web's error boundary and the mobile app post here when they crash. Each report
becomes one structured `client_error` log line, so it reaches wherever the
server's logs go (Render today). Nothing is stored and no third-party account
is needed. Swapping in Sentry later is a client change only.

Unauthenticated on purpose: a crash can happen before sign-in or because the
session broke. That makes it a public write, so it is rate-limited per address,
every field has a length cap, unknown fields are refused, and nothing that
identifies a person is accepted or logged.
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.api import API_V1_PREFIX
from app.schemas.common import ApiResponse, envelope
from app.utils import rate_limit
from app.utils.logging import log_event

router = APIRouter(prefix=f"{API_V1_PREFIX}/client-errors", tags=["client-errors"])

# A crash loop on one phone sends a report per render; ten a minute is enough to
# see it happening and too few to fill the log.
REPORTS_PER_MINUTE = 10


class ClientErrorReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: Literal["web", "android", "ios"]
    message: str = Field(min_length=1, max_length=2000)
    stack: Optional[str] = Field(None, max_length=4000)
    component_stack: Optional[str] = Field(None, max_length=2000)
    path: Optional[str] = Field(None, max_length=300)
    app_version: Optional[str] = Field(None, max_length=40)
    user_agent: Optional[str] = Field(None, max_length=300)


class ClientErrorAccepted(BaseModel):
    accepted: bool


async def _limit(request: Request) -> None:
    await rate_limit.check("client-errors", rate_limit.caller_of(request), REPORTS_PER_MINUTE)


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[ClientErrorAccepted],
    summary="Report a client crash (unauthenticated, rate-limited, logged only)",
    dependencies=[Depends(_limit)],
)
async def report_client_error(payload: ClientErrorReport) -> ApiResponse[ClientErrorAccepted]:
    # Path only: a query string can carry a share token (/track?t=...).
    path = payload.path.split("?", 1)[0].split("#", 1)[0] if payload.path else None
    log_event(
        "client_error",
        level=logging.ERROR,
        platform=payload.platform,
        error_message=payload.message,
        stack=payload.stack,
        component_stack=payload.component_stack,
        path=path,
        app_version=payload.app_version,
        user_agent=payload.user_agent,
        outcome="failure",
    )
    return envelope(ClientErrorAccepted(accepted=True))
