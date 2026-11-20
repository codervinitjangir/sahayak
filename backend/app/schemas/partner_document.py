"""Partner documents (ADR-038)."""
import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DocType = Literal["driving_licence", "photo_id", "tow_vehicle_rc", "tow_equipment_photo"]
ContentType = Literal["image/jpeg", "image/png", "image/webp", "application/pdf"]


class PartnerDocumentItem(BaseModel):
    """One required document as the partner sees it. `status` 'missing' means
    nothing confirmed yet. The file itself is never exposed to the partner."""
    doc_type: DocType
    status: Literal["missing", "pending", "approved", "rejected", "expired"]
    document_id: Optional[uuid.UUID] = None
    rejection_reason: Optional[str] = None
    expiry_date: Optional[date] = None
    uploaded_at: Optional[datetime] = None


class PartnerDocumentsResponse(BaseModel):
    required: list[DocType]
    documents: list[PartnerDocumentItem]
    complete: bool              # every required document approved


class DocumentUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doc_type: DocType
    content_type: ContentType
    # tow_vehicle_rc only: the tow vehicle's registration number.
    reference_number: Optional[str] = Field(None, min_length=4, max_length=30)


class DocumentUploadTicket(BaseModel):
    """PUT the file to `upload_url` with header Content-Type = the declared type,
    then call confirm. Max 5 MB; the bucket refuses anything else."""
    document_id: uuid.UUID
    upload_url: str
    max_bytes: int


class DocumentReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["approved", "rejected"]
    reason: Optional[str] = Field(None, max_length=500)
    expiry_date: Optional[date] = None


class DocumentViewUrl(BaseModel):
    url: str
    expires_in: int
