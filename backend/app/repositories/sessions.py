"""Bearer session tokens and single-use email tokens.

Replaces the Mongo TTL index: expiry is enforced in the query itself, and
db.cleanup_expired_auth_rows() sweeps dead rows on startup.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from app import db
from app.config import settings

PURPOSE_VERIFY_EMAIL = "verify_email"
PURPOSE_RESET_PASSWORD = "reset_password"


# ---------- sessions ----------
async def create_session(
    user_id: str, token: str, *, user_agent: Optional[str] = None
) -> datetime:
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days)
    await db.execute(
        """
        INSERT INTO user_sessions (session_token, user_id, user_agent, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (session_token) DO UPDATE
          SET expires_at = EXCLUDED.expires_at,
              user_agent = EXCLUDED.user_agent
        """,
        token,
        user_id,
        (user_agent or "")[:400] or None,
        expires_at,
    )
    return expires_at


async def user_for_token(token: str) -> Optional[dict]:
    """Single round trip: resolves an unexpired session to its live user."""
    row = await db.fetchrow(
        """
        SELECT u.user_id, u.email, u.name, u.picture, u.email_verified,
               u.is_admin, u.platform_role, u.creator_id, u.home_region_id,
               u.created_at, u.updated_at
          FROM user_sessions s
          JOIN users u ON u.user_id = s.user_id
         WHERE s.session_token = $1
           AND s.expires_at > NOW()
           AND u.deleted_at IS NULL
        """,
        token,
    )
    return db.as_dict(row)


async def delete_session(token: str) -> bool:
    status = await db.execute(
        "DELETE FROM user_sessions WHERE session_token = $1", token
    )
    return db.rows_affected(status) > 0


async def delete_all_for_user(user_id: str) -> int:
    """Used after a password change/reset so stolen sessions die with the password."""
    status = await db.execute("DELETE FROM user_sessions WHERE user_id = $1", user_id)
    return db.rows_affected(status)


# ---------- email tokens ----------
async def create_email_token(
    user_id: str, token: str, purpose: str, ttl_hours: int
) -> datetime:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    # Older unused tokens for the same purpose are invalidated so only the most
    # recent link in the user's inbox works.
    await db.execute(
        "UPDATE email_tokens SET used_at = NOW() "
        "WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL",
        user_id,
        purpose,
    )
    await db.execute(
        "INSERT INTO email_tokens (token, user_id, purpose, expires_at) "
        "VALUES ($1, $2, $3, $4)",
        token,
        user_id,
        purpose,
        expires_at,
    )
    return expires_at


async def consume_email_token(token: str, purpose: str) -> Optional[str]:
    """Atomically marks the token used and returns its user_id.

    The `used_at IS NULL` guard inside the UPDATE makes double-submission safe
    without a transaction: only the first caller gets a row back.
    """
    return await db.fetchval(
        """
        UPDATE email_tokens
           SET used_at = NOW()
         WHERE token = $1
           AND purpose = $2
           AND used_at IS NULL
           AND expires_at > NOW()
        RETURNING user_id
        """,
        token,
        purpose,
    )
