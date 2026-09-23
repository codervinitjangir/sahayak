import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


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


class UserRegisterRequest(BaseModel):
    """Inbound payload for POST /users — what a vehicle owner signs up with.

    Deliberately narrower than UserCreate above, which carries phone_verified
    and would let a registrant assert their own number as verified. That flag is
    server-owned: it records what the caller's token proves, not what the caller
    says. See register_user in app/services/user_service.py.

    Field limits mirror the column widths so an over-long name is a 422 naming
    the field rather than a database error on the way in.
    """
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=1, max_length=15)
    email: Optional[str] = Field(default=None, max_length=150)


class UserRegistrationResponse(BaseModel):
    """The profile POST /users just created.

    Narrow on purpose, like PartnerAuthLinkResponse. auth_user_id is omitted
    because the caller is the account — echoing their own Supabase id back tells
    them nothing they did not send, and email is omitted because the client
    supplied it in the same request. What the client genuinely does not know
    until now is the local id, which is the foreign key every later call
    (vehicles, jobs) hangs off.

    phone_verified is included because it is not necessarily what was asked for:
    it is true only when the token proved the number.
    """
    id: uuid.UUID
    name: str
    phone: str
    phone_verified: Optional[bool] = False
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
