"""Device push-token registration (ADR-026).

The app registers its Expo push token after sign-in and removes it on sign-out.
Owners and partners only; an admin reads the board rather than getting pushes.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.services import device_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

router = APIRouter(prefix=f"{API_V1_PREFIX}/devices", tags=["devices"])

# ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] (older) or ExpoPushToken[...].
_TOKEN_PATTERN = r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$"


class PushTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(..., pattern=_TOKEN_PATTERN, max_length=250)
    platform: Optional[Literal["ios", "android", "web"]] = None


class PushTokenDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(..., max_length=250)


class PushTokenResponse(BaseModel):
    registered: bool


@router.post("/push-token", response_model=ApiResponse[PushTokenResponse], status_code=status.HTTP_200_OK,
             summary="Register this device's Expo push token")
async def register_push_token(
    payload: PushTokenRequest,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PushTokenResponse]:
    await device_service.register(db, identity, payload.token, payload.platform)
    return envelope(PushTokenResponse(registered=True))


@router.delete("/push-token", response_model=ApiResponse[PushTokenResponse], status_code=status.HTTP_200_OK,
               summary="Unregister this device (call on sign-out)")
async def unregister_push_token(
    payload: PushTokenDeleteRequest,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PushTokenResponse]:
    """No-op 200 when the token is not the caller's."""
    await device_service.unregister(db, identity, payload.token)
    return envelope(PushTokenResponse(registered=False))
