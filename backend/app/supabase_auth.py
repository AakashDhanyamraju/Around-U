"""Verification of Supabase Auth access tokens.

Only the OAuth handshake runs through Supabase. The app completes the Google
consent flow, gets a Supabase access token, and hands it here; we confirm it with
Supabase, map the identity to a local `users` row, and issue one of our own
session tokens. Everything downstream keeps the existing auth model.

Verification calls Supabase's `/auth/v1/user` rather than checking the JWT
signature locally. That means one HTTPS round trip per sign-in, which is a fine
price at login only, and in exchange there is no JWT library, no signing-key
material in our config, and no chance of getting algorithm or key-rotation
handling subtly wrong. Supabase is already a hard dependency — it is the
database.
"""

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Sign-in should fail fast rather than hold a request open.
_TIMEOUT = httpx.Timeout(8.0, connect=4.0)


class SupabaseAuthError(Exception):
    """Raised when a token cannot be turned into a trustworthy identity."""

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.message = message
        # Distinguishes "your token is bad" (401) from "we couldn't reach
        # Supabase" (503), because the correct client behaviour differs.
        self.retryable = retryable


class ExternalIdentity:
    def __init__(
        self,
        *,
        provider: str,
        provider_uid: str,
        email: str,
        email_verified: bool,
        name: Optional[str],
        picture: Optional[str],
    ):
        self.provider = provider
        self.provider_uid = provider_uid
        self.email = email
        self.email_verified = email_verified
        self.name = name
        self.picture = picture


def is_configured() -> bool:
    return settings.supabase_auth_configured


def _extract(payload: dict) -> ExternalIdentity:
    """Pulls a usable identity out of Supabase's user object.

    Supabase nests the provider's own claims under `user_metadata`, and which
    keys are present varies by provider, so each field has a fallback chain
    rather than a single expected key.
    """
    provider_uid = payload.get("id")
    if not provider_uid:
        raise SupabaseAuthError("Supabase returned a user with no id")

    email = (payload.get("email") or "").strip().lower()
    if not email:
        # Every path in this app keys the account on email; an identity without
        # one cannot be mapped to a local row.
        raise SupabaseAuthError(
            "That account has no email address, so it cannot be used to sign in."
        )

    metadata = payload.get("user_metadata") or {}
    app_metadata = payload.get("app_metadata") or {}

    provider = (
        app_metadata.get("provider")
        or (app_metadata.get("providers") or [None])[0]
        or "google"
    )

    # Supabase surfaces provider verification in more than one place depending on
    # version; treat a confirmed timestamp as authoritative too.
    email_verified = bool(
        metadata.get("email_verified")
        or metadata.get("verified_email")
        or payload.get("email_confirmed_at")
        or payload.get("confirmed_at")
    )

    name = (
        metadata.get("full_name")
        or metadata.get("name")
        or metadata.get("preferred_username")
        or email.split("@")[0]
    )
    picture = metadata.get("avatar_url") or metadata.get("picture")

    return ExternalIdentity(
        provider=provider,
        provider_uid=str(provider_uid),
        email=email,
        email_verified=email_verified,
        name=name,
        picture=picture,
    )


async def identity_from_access_token(access_token: str) -> ExternalIdentity:
    """Exchanges a Supabase access token for a verified external identity."""
    if not is_configured():
        raise SupabaseAuthError(
            "Google sign-in is not configured on this server.", retryable=False
        )
    if not access_token or not access_token.strip():
        raise SupabaseAuthError("Missing access token.")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(
                settings.supabase_user_endpoint,
                headers={
                    "Authorization": f"Bearer {access_token.strip()}",
                    "apikey": settings.supabase_anon_key,
                },
            )
    except httpx.HTTPError as e:
        logger.error("Supabase auth lookup failed: %s", e)
        raise SupabaseAuthError(
            "Could not reach the sign-in provider. Please try again.",
            retryable=True,
        )

    if res.status_code in (400, 401, 403):
        # Expired or forged — deliberately indistinguishable to the caller.
        raise SupabaseAuthError("That sign-in has expired. Please try again.")
    if res.status_code >= 500:
        logger.error("Supabase auth returned %s", res.status_code)
        raise SupabaseAuthError(
            "The sign-in provider is unavailable. Please try again.", retryable=True
        )
    if res.status_code != 200:
        logger.error("Unexpected Supabase auth status %s: %s", res.status_code, res.text[:300])
        raise SupabaseAuthError("Could not complete sign-in.")

    try:
        payload = res.json()
    except ValueError:
        raise SupabaseAuthError("Could not complete sign-in.")

    return _extract(payload)
