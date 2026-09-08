"""
Sahayak FastAPI Application Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import get_settings

settings = get_settings()

app = FastAPI(
    title="Sahayak API",
    description="Real-Time Emergency Vehicle Assistance & Service Dispatch Platform",
    version="0.1.0",
    docs_url="/docs" if settings.APP_ENV != "production" else None,
    redoc_url="/redoc" if settings.APP_ENV != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def health():
    """Process liveness check."""
    return {"status": "ok"}


@app.get("/ready", tags=["health"])
async def ready():
    """Dependency readiness check — expand as services are wired."""
    return {"status": "ok", "message": "scaffold — add DB/Redis checks here"}
