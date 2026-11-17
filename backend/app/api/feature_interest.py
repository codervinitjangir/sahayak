""""Notify me" on features that are announced but not built (ADR-035).

Owners and partners, each with their own list: owners see services they could
book later, partners see programmes they could join. Which list applies comes
from the verified identity, not from the request. Nothing here sends a
notification yet; it records demand so the team knows what to build first.
"""
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, envelope
from app.services import feature_interest_service
from app.services.auth_service import Identity
from app.utils.auth import get_current_identity

router = APIRouter(prefix=f"{API_V1_PREFIX}/feature-interest", tags=["feature-interest"])

# Union of both sides. The service rejects a feature from the other side's list.
Feature = Literal["scheduled", "doorstep", "pickup-drop", "financing", "certification", "custody-tier"]


class FeatureInterestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feature: Feature


class FeatureInterestResponse(BaseModel):
    features: list[str]


@router.get("/me", response_model=ApiResponse[FeatureInterestResponse], summary="Features I asked to be told about")
async def my_feature_interest(
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[FeatureInterestResponse]:
    return envelope(FeatureInterestResponse(features=await feature_interest_service.list_mine(db, identity)))


@router.post("", response_model=ApiResponse[FeatureInterestResponse], status_code=status.HTTP_200_OK,
             summary="Notify me when this feature launches (idempotent)")
async def register_feature_interest(
    payload: FeatureInterestRequest,
    identity: Identity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[FeatureInterestResponse]:
    features = await feature_interest_service.register(db, identity, payload.feature)
    return envelope(FeatureInterestResponse(features=features))
