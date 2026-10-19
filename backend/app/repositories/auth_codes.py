"""One-time email login codes.

Two rules shape this module:

  * The code is stored hashed, never in plaintext. This table is the one most
    likely to end up in a backup or a support screenshot, and a plaintext row
    there is a working credential.
  * The guess counter lives on the row, in Postgres. The Redis rate limiter fails
    open when Redis is down, and a 6-digit code with unlimited guesses is only
    ~10^6 attempts.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app import db, security
from app.config import settings

PURPOSE_LOGIN = "login"
PURPOSE_SIGNUP = "signup"

_COLUMNS = """
  code_id, email, code_hash, purpose, attempts, max_attempts,
  name_hint, user_agent, expires_at, consumed_at, created_at
"""


def new_code_id() -> str:
    return f"otp_{uuid.uuid4().hex[:10]}"


def generate_code() -> str:
    """A numeric code of `otp_length` digits, uniformly random.

    Uses randbelow rather than shuffling or modulo so every value is equally
    likely, and keeps leading zeros — '004521' is a valid code.
    """
    upper = 10**settings.otp_length
    return str(secrets.randbelow(upper)).zfill(settings.otp_length)


async def recent_request_count(email: str) -> int:
    """How many codes this address has asked for inside the throttle window."""
    since = datetime.now(timezone.utc) - timedelta(
        minutes=settings.otp_request_window_minutes
    )
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM auth_codes "
            "WHERE LOWER(email) = LOWER($1) AND created_at >= $2",
            email,
            since,
        )
        or 0
    )


async def issue(
    email: str,
    *,
    purpose: str = PURPOSE_LOGIN,
    name_hint: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[str, dict]:
    """Creates a code and returns (plaintext_code, row).

    The plaintext is returned once, for the email, and is never persisted or
    recoverable afterwards.

    Any earlier unconsumed code for the address is burned first, so requesting a
    new code reliably invalidates the old one — otherwise several live codes
    would multiply the attacker's chances.
    """
    code = generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_ttl_minutes)

    async with db.transaction() as conn:
        await conn.execute(
            "UPDATE auth_codes SET consumed_at = NOW() "
            "WHERE LOWER(email) = LOWER($1) AND consumed_at IS NULL",
            email,
        )
        row = await conn.fetchrow(
            f"""
            INSERT INTO auth_codes
              (code_id, email, code_hash, purpose, max_attempts, name_hint,
               user_agent, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING {_COLUMNS}
            """,
            new_code_id(),
            email.strip().lower(),
            security.hash_password(code),
            purpose,
            settings.otp_max_attempts,
            name_hint,
            (user_agent or "")[:400] or None,
            expires_at,
        )
    return code, dict(row)


async def live_code_for(email: str) -> Optional[dict]:
    """The newest unconsumed, unexpired code for an address."""
    row = await db.fetchrow(
        f"SELECT {_COLUMNS} FROM auth_codes "
        "WHERE LOWER(email) = LOWER($1) AND consumed_at IS NULL AND expires_at > NOW() "
        "ORDER BY created_at DESC LIMIT 1",
        email,
    )
    return db.as_dict(row)


class VerifyResult:
    """Outcome of a verification attempt.

    Deliberately distinguishes *why* it failed internally while the router
    collapses everything into one message — the caller should not learn whether
    an address has a live code.
    """

    def __init__(self, ok: bool, *, reason: str = "", row: Optional[dict] = None):
        self.ok = ok
        self.reason = reason
        self.row = row


async def verify(email: str, code: str) -> VerifyResult:
    """Checks a submitted code and consumes it on success.

    A wrong guess increments `attempts`; hitting `max_attempts` burns the code so
    the window cannot be reopened by continuing to guess.
    """
    row = await live_code_for(email)
    if row is None:
        return VerifyResult(False, reason="no_live_code")

    if row["attempts"] >= row["max_attempts"]:
        await db.execute(
            "UPDATE auth_codes SET consumed_at = NOW() WHERE code_id = $1",
            row["code_id"],
        )
        return VerifyResult(False, reason="too_many_attempts")

    if not security.verify_password(code, row["code_hash"]):
        updated = await db.fetchrow(
            "UPDATE auth_codes SET attempts = attempts + 1 "
            "WHERE code_id = $1 RETURNING attempts, max_attempts",
            row["code_id"],
        )
        # Burn it the moment the budget is spent, rather than waiting for the
        # next request to notice.
        if updated and updated["attempts"] >= updated["max_attempts"]:
            await db.execute(
                "UPDATE auth_codes SET consumed_at = NOW() WHERE code_id = $1",
                row["code_id"],
            )
        return VerifyResult(False, reason="wrong_code")

    # Single-statement consume: the WHERE clause is what makes a concurrent
    # double-submit resolve to exactly one winner.
    consumed = await db.fetchrow(
        f"UPDATE auth_codes SET consumed_at = NOW() "
        f"WHERE code_id = $1 AND consumed_at IS NULL RETURNING {_COLUMNS}",
        row["code_id"],
    )
    if consumed is None:
        return VerifyResult(False, reason="already_used")

    return VerifyResult(True, row=dict(consumed))


async def burn_all_for(email: str) -> int:
    """Invalidates every live code for an address — used after a successful
    sign-in through another route."""
    status = await db.execute(
        "UPDATE auth_codes SET consumed_at = NOW() "
        "WHERE LOWER(email) = LOWER($1) AND consumed_at IS NULL",
        email,
    )
    return db.rows_affected(status)
