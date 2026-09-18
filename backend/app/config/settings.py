from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Supabase Configuration
    SUPABASE_URL: str = ""

    # Supabase's current API key format. The publishable key replaces the old
    # anon key and is safe in a browser; the secret key replaces service_role
    # and must never leave the server. Both are opaque strings (sb_publishable_…
    # / sb_secret_…), not JWTs, so neither one has anything to do with token
    # verification below.
    SUPABASE_PUBLISHABLE_KEY: str = ""
    SUPABASE_SECRET_KEY: str = ""

    # Legacy equivalents, kept so existing code and older environments keep
    # working. Prefer the two above for anything new.
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # Supabase Auth — JWT verification
    #
    # Supabase now signs access tokens with an ASYMMETRIC key (ES256, P-256) and
    # publishes the public half at the project's JWKS endpoint. Verification
    # therefore needs no secret at all: the server fetches a public key and
    # checks a signature it could not itself produce. That is strictly better
    # than the old shared secret, where the same value that verified a token
    # could also forge one.
    #
    # Nothing needs to be configured for this — the JWKS URL is derived from
    # SUPABASE_URL below.

    # Legacy HS256 shared secret: Project Settings → JWT Keys → Legacy JWT
    # Secret. Only needed while tokens signed by a *previous* key are still in
    # flight — Supabase keeps rotated-out keys valid until their tokens expire.
    # Leave blank on a project that has finished migrating to asymmetric keys;
    # blank simply means "reject HS256 tokens", which is the correct end state.
    #
    # It is NOT the publishable key and NOT the secret key.
    SUPABASE_JWT_SECRET: str = ""

    # Override the JWKS endpoint. Only for tests, which point this at a local
    # key set so they can mint tokens the verifier will accept. In production
    # leave it blank and let it derive from SUPABASE_URL.
    SUPABASE_JWT_JWKS_URL_OVERRIDE: str = ""

    # Supabase stamps every access token with aud="authenticated". PyJWT raises
    # InvalidAudienceError when a token carries `aud` and the caller does not
    # say what it expects, so this is required rather than optional hardening.
    # Set to "" to skip audience verification (only useful for a non-Supabase
    # issuer whose tokens have no `aud` claim).
    SUPABASE_JWT_AUDIENCE: str = "authenticated"


    # Database Configuration (Supabase PostgreSQL)
    DATABASE_URL: str = ""

    @property
    def SUPABASE_JWT_ISSUER(self) -> str:
        """Expected `iss` claim, derived from SUPABASE_URL.

        Supabase issues tokens as `https://<project>.supabase.co/auth/v1`.
        Deriving it rather than configuring it separately means one fewer env
        var to get wrong, and returning "" when SUPABASE_URL is unset lets the
        verifier skip the check instead of rejecting everything.
        """
        if not self.SUPABASE_URL:
            return ""
        return f"{self.SUPABASE_URL.rstrip('/')}/auth/v1"

    @property
    def SUPABASE_JWT_JWKS_URL(self) -> str:
        """Where the project publishes the public half of its signing keys.

        Derived from SUPABASE_URL for the same reason as the issuer. Returns ""
        when unset, which the verifier treats as "asymmetric verification is not
        configured" and fails closed on rather than skipping.
        """
        if self.SUPABASE_JWT_JWKS_URL_OVERRIDE:
            return self.SUPABASE_JWT_JWKS_URL_OVERRIDE
        if not self.SUPABASE_URL:
            return ""
        return f"{self.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        """Return DATABASE_URL formatted for SQLAlchemy async engine (asyncpg)."""
        if not self.DATABASE_URL:
            return ""
        if self.DATABASE_URL.startswith("postgresql://"):
            return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
        return self.DATABASE_URL


@lru_cache
def get_settings() -> Settings:
    return Settings()
