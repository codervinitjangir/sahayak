import uuid
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict


class AdminBase(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[Literal["ops", "super_admin"]] = "ops"


class AdminCreate(AdminBase):
    pass


class AdminResponse(AdminBase):
    id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
