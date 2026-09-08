"""
Application settings — loaded from environment variables.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Application
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: str = "http://localhost:5173"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://sahayak:changeme@localhost:5432/sahayak_db"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 60

    # Dispatch configuration
    R_SEARCH_M: float = 7000.0
    MAX_CONCURRENT_JOBS: int = 2
    MAX_LOCATION_AGE_S: int = 120
    EXPERIENCE_TARGET: int = 10
    OFFER_TIMEOUT_S: int = 45
    MAX_OFFER_ATTEMPTS: int = 5

    WEIGHT_DISTANCE: float = 0.45
    WEIGHT_LOAD: float = 0.20
    WEIGHT_SKILL: float = 0.20
    WEIGHT_RATING: float = 0.15

    # Notifications
    NOTIFICATION_MODE: str = "stub"


@lru_cache
def get_settings() -> Settings:
    return Settings()
