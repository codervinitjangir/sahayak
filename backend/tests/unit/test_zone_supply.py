"""Zone supply gaps (ADR-048): requests in an area with no on-duty partner in reach."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest

from app.config.redis_client import PARTNER_LOCATIONS_KEY
from app.services import admin_ops_service as svc

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)
# Two Bengaluru areas about 15 km apart: Koramangala and Yelahanka.
KORA = (12.935, 77.624)
YELA = (13.100, 77.596)


def test_requests_are_grouped_by_area_and_no_match_counted():
    groups = svc.group_demand([
        ("no_match_found", *KORA), ("completed", KORA[0] + 0.001, KORA[1]), ("matching", *YELA),
    ])
    assert sorted(groups.values()) == [(1, 0), (2, 1)]


def test_only_areas_with_nobody_in_reach_are_reported_busiest_first():
    demand = svc.group_demand([("no_match_found", *KORA), ("no_match_found", *KORA), ("matching", *YELA)])
    kora, yela = svc._cell(*KORA), svc._cell(*YELA)
    alert = svc.zone_gap_alert(demand, {kora: 0, yela: 2})
    assert alert.code == "ZONE_SUPPLY_GAP" and alert.count == 1
    assert alert.severity == "critical"                      # two misses in one area
    zone = alert.zones[0]
    assert zone.requests == 2 and zone.no_match == 2
    # The centre of the cell, not the pickup point.
    assert abs(zone.latitude - KORA[0]) < svc.ZONE_DEG and (zone.latitude, zone.longitude) != KORA


def test_a_single_miss_is_a_warning_and_covered_areas_are_quiet():
    demand = svc.group_demand([("matching", *KORA)])
    assert svc.zone_gap_alert(demand, {svc._cell(*KORA): 0}).severity == "warning"
    assert svc.zone_gap_alert(demand, {svc._cell(*KORA): 1}) is None
    assert svc.zone_gap_alert(demand, {}) is None            # not looked up = not judged


@pytest.fixture
def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("app.services.admin_ops_service.get_redis", return_value=r):
        yield r


@pytest.mark.asyncio
async def test_coverage_counts_only_on_duty_partners_from_redis(redis):
    on, off = uuid.uuid4(), uuid.uuid4()
    await redis.geoadd(PARTNER_LOCATIONS_KEY, (KORA[1] + 0.01, KORA[0], str(on)))
    await redis.geoadd(PARTNER_LOCATIONS_KEY, (KORA[1], KORA[0] + 0.01, str(off)))
    cells = [svc._cell(*KORA), svc._cell(*YELA)]
    cov = await svc._zone_coverage(cells, {on})
    assert cov == {cells[0]: 1, cells[1]: 0}


@pytest.mark.asyncio
async def test_zone_alert_end_to_end_and_silent_when_nobody_is_on_duty(redis):
    with patch.object(svc.admin_ops_repository, "demand_points_since",
                      AsyncMock(return_value=[("no_match_found", *YELA)])), \
         patch.object(svc.admin_ops_repository, "on_duty_partner_ids", AsyncMock(return_value={uuid.uuid4()})):
        alert = await svc.zone_alert(AsyncMock(), NOW, partners_on_duty=1)
        assert alert is not None and alert.zones[0].no_match == 1
        assert await svc.zone_alert(AsyncMock(), NOW, partners_on_duty=0) is None


@pytest.mark.asyncio
async def test_redis_down_means_no_zone_alert_not_a_false_one():
    import redis.exceptions as rexc
    broken = AsyncMock()
    broken.geosearch.side_effect = rexc.ConnectionError("down")
    with patch("app.services.admin_ops_service.get_redis", return_value=broken):
        assert await svc._zone_coverage([svc._cell(*KORA)], set()) is None
