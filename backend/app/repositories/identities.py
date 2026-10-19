"""External provider identities (currently Google, via Supabase).

Resolution is by the provider's immutable subject id, not by email. Email is
mutable and, for a provider that does not assert `email_verified`, forgeable —
either would be enough to attach to someone else's account.
"""

from typing import Optional

from app import db

PROVIDER_GOOGLE = "google"

_COLUMNS = "provider, provider_uid, user_id, email, created_at, last_seen_at"


async def by_provider_uid(provider: str, provider_uid: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {_COLUMNS} FROM auth_identities "
        "WHERE provider = $1 AND provider_uid = $2",
        provider,
        provider_uid,
    )
    return db.as_dict(row)


async def for_user(user_id: str) -> list[dict]:
    rows = await db.fetch(
        f"SELECT {_COLUMNS} FROM auth_identities WHERE user_id = $1 ORDER BY provider",
        user_id,
    )
    return db.as_dicts(rows)


async def link(
    provider: str, provider_uid: str, user_id: str, email: Optional[str] = None
) -> dict:
    """Idempotent link. Re-signing in refreshes the email and last_seen_at but
    never re-points an existing identity at a different account — that would be
    an account takeover primitive."""
    row = await db.fetchrow(
        f"""
        INSERT INTO auth_identities (provider, provider_uid, user_id, email, last_seen_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (provider, provider_uid) DO UPDATE
          SET email        = EXCLUDED.email,
              last_seen_at = NOW()
        RETURNING {_COLUMNS}
        """,
        provider,
        provider_uid,
        user_id,
        (email or "").strip().lower() or None,
    )
    return dict(row)


async def unlink(provider: str, user_id: str) -> bool:
    status = await db.execute(
        "DELETE FROM auth_identities WHERE provider = $1 AND user_id = $2",
        provider,
        user_id,
    )
    return db.rows_affected(status) > 0
