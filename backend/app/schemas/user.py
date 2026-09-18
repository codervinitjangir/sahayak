import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    phone_verified: Optional[bool] = False


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    phone_verified: Optional[bool] = None


class UserResponse(UserBase):
    id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserAuthLinkResponse(BaseModel):
    """Confirmation that a Supabase account now owns this user profile.

    Mirrors PartnerAuthLinkResponse and omits phone for the same reason: the
    caller already proved they hold the account, so returning the number only
    creates another place it can leak from.
    """
    id: uuid.UUID
    auth_user_id: uuid.UUID
    phone_verified: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)
