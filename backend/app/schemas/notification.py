import uuid
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict


class NotificationBase(BaseModel):
    recipient_type: Literal["user", "partner"]
    recipient_id: Optional[uuid.UUID] = None
    channel: Literal["push", "sms"]
    message: Optional[str] = None
    is_read: Optional[bool] = False
    job_id: Optional[uuid.UUID] = None


class NotificationCreate(NotificationBase):
    pass


class NotificationResponse(NotificationBase):
    id: uuid.UUID
    sent_at: datetime

    model_config = ConfigDict(from_attributes=True)
