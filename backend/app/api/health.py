"""
Liveness endpoint.

Left unversioned at /health on purpose: container health checks and deploy
smoke tests point at this path, so it must not move when the API version does.
"""
import psycopg2
from fastapi import APIRouter

from app.config.settings import get_settings
from app.schemas.common import ApiResponse, HealthResponse, envelope

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=ApiResponse[HealthResponse],
    summary="Process liveness and database reachability",
)
def health_check() -> ApiResponse[HealthResponse]:
    """
    Lightweight health check verifying API liveness and Supabase PostgreSQL connectivity.
    """
    settings = get_settings()
    db_status = "unreachable"

    if settings.DATABASE_URL:
        try:
            # Handle both postgresql:// and postgresql+asyncpg:// URL formats
            db_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
            conn = psycopg2.connect(db_url, connect_timeout=5)
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                cur.fetchone()
            conn.close()
            db_status = "connected"
        except Exception:
            db_status = "unreachable"

    return envelope({"status": "ok", "database": db_status})
