"""SQL for partner documents (ADR-038). Flushes only; the service commits.

ORM statements with typed binds throughout, so asyncpg never PREPAREs an
untyped parameter.
"""
import uuid
from datetime import date, datetime
from typing import Optional, Sequence

from sqlalchemy import and_, delete, exists, select, update

from app.models.partner import PartnerDocument, PartnerEquipment, PartnerService
from app.models.service import Service


async def partner_does_towing(db, partner_id: uuid.UUID) -> bool:
    """Whether the partner offers any service that needs verified equipment."""
    stmt = select(
        exists().where(
            PartnerService.partner_id == partner_id,
            PartnerService.service_id == Service.id,
            Service.requires_vehicle_equipment.is_(True),
        )
    )
    return bool((await db.execute(stmt)).scalar())


async def confirmed_documents(db, partner_id: uuid.UUID) -> Sequence[PartnerDocument]:
    result = await db.execute(
        select(PartnerDocument)
        .where(PartnerDocument.partner_id == partner_id, PartnerDocument.file_url.is_not(None))
        .order_by(PartnerDocument.uploaded_at)
    )
    return result.scalars().all()


async def get_document(db, partner_id: uuid.UUID, document_id: uuid.UUID, *, for_update: bool = False
                       ) -> Optional[PartnerDocument]:
    """A document only if it belongs to this partner (principle 6: one 404 for both)."""
    stmt = select(PartnerDocument).where(
        PartnerDocument.id == document_id, PartnerDocument.partner_id == partner_id
    )
    if for_update:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def add_document(db, **fields) -> PartnerDocument:
    row = PartnerDocument(**fields)
    db.add(row)
    await db.flush()
    return row


async def confirmed_of_type(db, partner_id: uuid.UUID, doc_type: str, *, exclude: uuid.UUID
                            ) -> Sequence[PartnerDocument]:
    result = await db.execute(
        select(PartnerDocument).where(
            PartnerDocument.partner_id == partner_id,
            PartnerDocument.doc_type == doc_type,
            PartnerDocument.file_url.is_not(None),
            PartnerDocument.id != exclude,
        )
    )
    return result.scalars().all()


async def delete_rows(db, ids: Sequence[uuid.UUID]) -> None:
    if ids:
        await db.execute(delete(PartnerDocument).where(PartnerDocument.id.in_(list(ids))))
        await db.flush()


async def set_retention(db, partner_id: uuid.UUID, retain_until: Optional[datetime]) -> None:
    await db.execute(
        update(PartnerDocument)
        .where(PartnerDocument.partner_id == partner_id)
        .values(retain_until=retain_until)
    )
    await db.flush()


async def upsert_tow_equipment(db, partner_id: uuid.UUID, registration_number: Optional[str],
                               status: str, now: datetime) -> None:
    """The one equipment row a towing partner's documents stand for."""
    row = (await db.execute(
        select(PartnerEquipment).where(
            PartnerEquipment.partner_id == partner_id,
            PartnerEquipment.equipment_type == "tow_vehicle",
        ).with_for_update()
    )).scalar_one_or_none()
    if row is None:
        row = PartnerEquipment(partner_id=partner_id, equipment_type="tow_vehicle")
        db.add(row)
    row.registration_number = registration_number
    row.verification_status = status
    row.verified_at = now if status == "verified" else None
    await db.flush()


async def due_for_deletion(db, now: datetime, abandoned_before: datetime, limit: int = 100
                           ) -> Sequence[PartnerDocument]:
    """Past their retention date, or uploads started and never confirmed."""
    result = await db.execute(
        select(PartnerDocument)
        .where(
            (PartnerDocument.retain_until < now)
            | and_(PartnerDocument.file_url.is_(None), PartnerDocument.uploaded_at < abandoned_before)
        )
        .limit(limit)
    )
    return result.scalars().all()


async def mark_expired(db, today: date) -> list:
    """Mark lapsed approved documents expired; returns the partner ids affected."""
    result = await db.execute(
        update(PartnerDocument)
        .where(PartnerDocument.status == "approved", PartnerDocument.expiry_date < today)
        .values(status="expired")
        .returning(PartnerDocument.partner_id)
    )
    await db.flush()
    return list(result.scalars().all())


async def partners_to_remind(db, today: date, until: date, not_since) -> list:
    """Partners with an approved document expiring in [today, until] who have
    not been sent a document_expiring notification since `not_since`."""
    from app.models.notification import Notification
    reminded = (
        select(Notification.id).where(
            Notification.recipient_type == "partner",
            Notification.recipient_id == PartnerDocument.partner_id,
            Notification.event == "document_expiring",
            Notification.sent_at >= not_since,
        ).exists()
    )
    result = await db.execute(
        select(PartnerDocument.partner_id).where(
            PartnerDocument.status == "approved",
            PartnerDocument.expiry_date >= today,
            PartnerDocument.expiry_date <= until,
            ~reminded,
        ).distinct()
    )
    return list(result.scalars().all())
