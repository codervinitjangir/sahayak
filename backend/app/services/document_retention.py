"""Hourly partner-document retention sweep (ADR-038).

Runs beside the dispatch worker in every API process. Safe to overlap: the
deletes are by id and idempotent, and marking a document expired is a plain
UPDATE with a predicate.
"""
import asyncio
import logging

from app.config.database import AsyncSessionLocal
from app.services import partner_document_service
from app.utils.logging import log_event


async def run_forever(interval_s: float, session_factory=AsyncSessionLocal) -> None:
    try:
        while True:
            try:
                async with session_factory() as db:
                    await partner_document_service.sweep_retention(db)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                log_event("document_retention_sweep", level=logging.ERROR,
                          error_type=type(exc).__name__, outcome="failure")
            await asyncio.sleep(interval_s)
    except asyncio.CancelledError:
        raise
