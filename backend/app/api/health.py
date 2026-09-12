import psycopg2
from fastapi import APIRouter
from app.config.settings import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
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

    return {
        "status": "ok",
        "database": db_status
    }
