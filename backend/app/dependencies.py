"""Shared FastAPI dependencies: bearer session auth and the admin shared secret."""

from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import settings
from app.repositories import sessions
from app.security import constant_time_equals


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await sessions.user_for_token(token)
    if not user:
        # Expired and forged tokens are intentionally indistinguishable.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """For endpoints that work for guests but personalise for signed-in users."""
    token = _extract_bearer(authorization)
    if not token:
        return None
    return await sessions.user_for_token(token)


async def require_admin(x_admin_secret: Optional[str] = Header(None)) -> bool:
    if not settings.admin_api_key:
        # Fail closed: an unset key must never mean "open to everyone".
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin API not configured",
        )
    if not x_admin_secret or not constant_time_equals(
        x_admin_secret, settings.admin_api_key
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin credentials",
        )
    return True
