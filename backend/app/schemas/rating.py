import uuid
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


class RatingBase(BaseModel):
    rated_by: Literal["user", "partner"]
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None


class RatingCreate(RatingBase):
    job_id: uuid.UUID


class RatingResponse(RatingBase):
    id: uuid.UUID
    job_id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
