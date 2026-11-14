"""CORS origins are configuration, not a hard-coded wildcard (production readiness)."""
from app.config.settings import Settings


def test_default_is_wildcard_for_local_development():
    assert Settings(CORS_ALLOWED_ORIGINS="*").cors_origins == ["*"]


def test_a_list_is_split_trimmed_and_normalised():
    s = Settings(CORS_ALLOWED_ORIGINS=" https://sahayak.app/ , https://www.sahayak.app ,")
    assert s.cors_origins == ["https://sahayak.app", "https://www.sahayak.app"]


def test_blank_falls_back_to_wildcard_rather_than_blocking_everything():
    assert Settings(CORS_ALLOWED_ORIGINS="").cors_origins == ["*"]
