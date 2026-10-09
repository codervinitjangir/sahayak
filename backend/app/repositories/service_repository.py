"""Reads of the service catalogue — reference data, not anyone's data.

SQL only, like every repository here: no HTTP errors, no transaction control.

The catalogue is seeded by db/seed.sql and changed by migration. Nothing in the
API writes it, which is why there is no create/update here — a service code is
part of the contract (`POST /jobs` takes `service_code`, `POST /partners/{id}/
services` takes a list of them), and codes that can be invented at runtime would
make that contract unknowable to a client.
"""
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service import Service, ServiceCategory


async def list_services(db: AsyncSession) -> Sequence[tuple[Service, ServiceCategory | None]]:
    """Every service, with its category, ordered for display.

    An outer join, because `services.category_id` is nullable. A service with no
    category is a seeding mistake rather than a state the product has a meaning
    for — but dropping it from this list would hide it, and a catalogue that
    silently omits a row the dispatch engine will happily accept in `service_code`
    is worse than one that shows a row with no category.

    Ordered by category then name so the client can group without sorting, and so
    two calls return the same order — `id` order would surface seeding sequence,
    which is not a meaningful ranking and would reshuffle if a row were re-seeded.
    """
    result = await db.execute(
        select(Service, ServiceCategory)
        .outerjoin(ServiceCategory, Service.category_id == ServiceCategory.id)
        .order_by(ServiceCategory.name.nulls_last(), Service.name)
    )
    return result.all()
