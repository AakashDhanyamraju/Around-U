"""Central configuration. Every external integration is declared here so there is
exactly one place to look when a credential changes."""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to backend/ rather than left relative. A bare ".env" resolves against
# the *working directory*, so starting the server from the repo root silently
# loaded no credentials at all — every integration reported itself unconfigured
# with nothing in the logs to say why.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---------- App ----------
    app_name: str = "Around You API"
    environment: str = "development"
    # Absolute base URL of the API itself, used to build links inside emails.
    public_api_url: str = "http://localhost:8000"
    # Where email links bounce the user back to (Expo web / deployed frontend).
    public_app_url: str = "http://localhost:8081"
    # Deep link scheme for the mobile app, used by password-reset links.
    app_scheme: str = "around-you"

    # Comma-separated. Kept as a plain string because pydantic-settings tries to
    # JSON-decode list-typed fields straight out of the environment.
    cors_origins: str = "http://localhost:8081"

    # ---------- Postgres (Supabase) ----------
    # Supabase pooler DSN. Port 6543 is the transaction-mode pooler, which is why
    # asyncpg runs with statement caching disabled (see db.py).
    database_url: str
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    db_command_timeout: float = 30.0
    # Supabase terminates TLS at the pooler; asyncpg needs ssl enabled but the
    # pooler presents a cert for a shared host, so verification is relaxed.
    db_ssl: str = "require"

    # ---------- Auth ----------
    # Shared secret guarding /api/admin/* writes.
    admin_api_key: str = ""
    # Accounts promoted to `superadmin` automatically, comma-separated. This is
    # the bootstrap: without it there would be no way to appoint the first admin,
    # since only a superadmin can grant that role. Matching happens on register
    # and on every login, so the account does not need to exist yet.
    super_admin_emails: str = "aakashdhanyamraju425@gmail.com"
    session_ttl_days: int = 30
    password_min_length: int = 8
    email_token_ttl_hours: int = 24
    reset_token_ttl_hours: int = 2
    # Failed logins allowed per email+IP inside the window before a 429.
    login_max_attempts: int = 8
    login_attempt_window_seconds: int = 900

    # ---------- Email OTP ----------
    otp_length: int = 6
    otp_ttl_minutes: int = 10
    # Wrong guesses allowed per code before it is burned. Counted in Postgres, not
    # Redis: the Redis limiter fails open, and an unlimited-guess 6-digit code is
    # only ~10^6 attempts.
    otp_max_attempts: int = 5
    # Codes a single address may request inside the window, to stop the endpoint
    # being used as a free mail cannon.
    otp_max_requests_per_window: int = 5
    otp_request_window_minutes: int = 15
    # Per-network ceiling, deliberately well above the per-address one: a
    # household or office behind a single NAT address shares this counter. A
    # completed sign-in clears it.
    otp_max_requests_per_ip: int = 40

    # ---------- Supabase Auth (Google OAuth) ----------
    # Only the OAuth handshake runs through Supabase. The access token it returns
    # is verified server-side against /auth/v1/user, then mapped to a local users
    # row and exchanged for one of our own session tokens — so the rest of the API
    # keeps its existing auth model.
    supabase_url: str = ""
    # The anon key is public by design (it ships in the app bundle) and is only
    # the `apikey` header Supabase requires; it grants nothing on its own.
    supabase_anon_key: str = ""

    # ---------- AWS SES ----------
    aws_ses_region: str = "ap-southeast-2"
    aws_ses_access_key_id: str = ""
    aws_ses_secret_access_key: str = ""
    # Must be a verified SES identity, otherwise sends are rejected.
    ses_from_email: str = ""
    ses_from_name: str = "Around You"
    # When SES is unconfigured, email bodies are logged instead of sent so local
    # signup still works end to end.
    email_dev_mode_log_links: bool = True

    # ---------- Redis (cache + rate limiting) ----------
    redis_url: str = ""
    cache_ttl_seconds: int = 120
    cache_enabled: bool = True

    # ---------- Cloudinary ----------
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_upload_folder: str = "around-you"

    # ---------- Seed ----------
    # Off by default: seeding deletes and rewrites all creators/posts.
    seed_on_startup: bool = False

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")

    @property
    def super_admin_email_list(self) -> List[str]:
        """Lower-cased for comparison — `users.email` is stored lower-cased too."""
        return [
            e.strip().lower() for e in self.super_admin_emails.split(",") if e.strip()
        ]

    def is_super_admin_email(self, email: Optional[str]) -> bool:
        if not email:
            return False
        return email.strip().lower() in self.super_admin_email_list

    @property
    def ses_configured(self) -> bool:
        return bool(
            self.aws_ses_access_key_id
            and self.aws_ses_secret_access_key
            and self.ses_from_email
        )

    @property
    def cloudinary_configured(self) -> bool:
        return bool(
            self.cloudinary_cloud_name
            and self.cloudinary_api_key
            and self.cloudinary_api_secret
        )

    @property
    def redis_configured(self) -> bool:
        return bool(self.redis_url) and self.cache_enabled

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def supabase_user_endpoint(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/user"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings: Settings = get_settings()


def masked(value: Optional[str], keep: int = 4) -> str:
    """For startup logs — proves a credential is loaded without printing it."""
    if not value:
        return "<unset>"
    if len(value) <= keep:
        return "*" * len(value)
    return f"{'*' * (len(value) - keep)}{value[-keep:]}"
