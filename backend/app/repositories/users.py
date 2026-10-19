"""User + credential persistence. Every read filters deleted_at IS NULL."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from app import db
from app.config import settings

_COLUMNS = """
  user_id, email, name, picture, email_verified, is_admin,
  platform_role, creator_id, home_region_id,
  last_login_at, created_at, updated_at, deleted_at
"""


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


async def by_id(user_id: str) -> Optional[dict]:
    return db.as_dict(
        await db.fetchrow(
            f"SELECT {_COLUMNS} FROM users WHERE user_id = $1 AND deleted_at IS NULL",
            user_id,
        )
    )


async def by_email(email: str) -> Optional[dict]:
    return db.as_dict(
        await db.fetchrow(
            f"SELECT {_COLUMNS} FROM users "
            "WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
            email,
        )
    )


async def credentials_by_email(email: str) -> Optional[dict]:
    """Includes password_hash — only for the login path, never for API responses."""
    return db.as_dict(
        await db.fetchrow(
            "SELECT user_id, email, name, password_hash, email_verified "
            "FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
            email,
        )
    )


async def password_hash_for(user_id: str) -> Optional[str]:
    return await db.fetchval(
        "SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL",
        user_id,
    )


async def insert(
    *,
    email: str,
    name: str,
    password_hash: Optional[str],
    picture: Optional[str] = None,
    email_verified: bool = False,
) -> dict:
    user_id = new_user_id()
    row = await db.fetchrow(
        f"""
        INSERT INTO users (user_id, email, name, picture, password_hash, email_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {_COLUMNS}
        """,
        user_id,
        email.strip().lower(),
        name,
        picture,
        password_hash,
        email_verified,
    )
    return dict(row)


async def set_password_hash(user_id: str, password_hash: str) -> bool:
    status = await db.execute(
        "UPDATE users SET password_hash = $2 WHERE user_id = $1 AND deleted_at IS NULL",
        user_id,
        password_hash,
    )
    return db.rows_affected(status) > 0


async def mark_email_verified(user_id: str) -> bool:
    status = await db.execute(
        "UPDATE users SET email_verified = TRUE "
        "WHERE user_id = $1 AND deleted_at IS NULL",
        user_id,
    )
    return db.rows_affected(status) > 0


async def touch_last_login(user_id: str) -> None:
    await db.execute(
        "UPDATE users SET last_login_at = $2 WHERE user_id = $1",
        user_id,
        datetime.now(timezone.utc),
    )


# ---------- platform administration ----------
async def search(
    *,
    query: Optional[str] = None,
    platform_role: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Paginated user directory for the superadmin portal.

    Returns (rows, total) so the UI can show how many matched rather than only
    how many fit on the page.
    """
    where = ["deleted_at IS NULL"]
    args: list = []

    if query:
        args.append(f"%{query.strip()}%")
        where.append(f"(email ILIKE ${len(args)} OR name ILIKE ${len(args)})")
    if platform_role:
        args.append(platform_role)
        where.append(f"platform_role = ${len(args)}")

    clause = " AND ".join(where)
    total = int(await db.fetchval(f"SELECT COUNT(*) FROM users WHERE {clause}", *args) or 0)

    args.extend([limit, offset])
    rows = await db.fetch(
        f"SELECT {_COLUMNS} FROM users WHERE {clause} "
        f"ORDER BY created_at DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}",
        *args,
    )
    return db.as_dicts(rows), total


async def set_platform_role(user_id: str, role: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"UPDATE users SET platform_role = $2 "
        f"WHERE user_id = $1 AND deleted_at IS NULL RETURNING {_COLUMNS}",
        user_id,
        role,
    )
    return db.as_dict(row)


async def promote_if_configured(user: dict) -> dict:
    """Bootstraps the configured superadmin accounts.

    Only a superadmin can grant that role, so somebody has to be first. Running
    on both register and login means the account does not need to exist when the
    migration runs, and a manual demotion is undone on next sign-in — which is
    the intent: the address in config is the source of truth.
    """
    if not settings.is_super_admin_email(user.get("email")):
        return user
    if user.get("platform_role") == "superadmin":
        return user
    updated = await set_platform_role(user["user_id"], "superadmin")
    return updated or user


async def count_by_platform_role(role: str) -> int:
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM users "
            "WHERE platform_role = $1 AND deleted_at IS NULL",
            role,
        )
        or 0
    )


async def link_creator(user_id: str, creator_id: Optional[str]) -> Optional[dict]:
    """Points an account at a creator profile, or clears the link with None."""
    row = await db.fetchrow(
        f"UPDATE users SET creator_id = $2 "
        f"WHERE user_id = $1 AND deleted_at IS NULL RETURNING {_COLUMNS}",
        user_id,
        creator_id,
    )
    return db.as_dict(row)


async def by_creator_id(creator_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {_COLUMNS} FROM users "
        "WHERE creator_id = $1 AND deleted_at IS NULL",
        creator_id,
    )
    return db.as_dict(row)


async def set_home_region(user_id: str, region_id: Optional[str]) -> Optional[dict]:
    row = await db.fetchrow(
        f"UPDATE users SET home_region_id = $2 "
        f"WHERE user_id = $1 AND deleted_at IS NULL RETURNING {_COLUMNS}",
        user_id,
        region_id,
    )
    return db.as_dict(row)


async def soft_delete(user_id: str) -> bool:
    """Soft-deletes an account and revokes its sessions together.

    Leaving the sessions behind would let a deleted account keep making requests
    until its token expired, which can be up to 30 days.
    """
    async with db.transaction() as conn:
        status = await conn.execute(
            "UPDATE users SET deleted_at = NOW() "
            "WHERE user_id = $1 AND deleted_at IS NULL",
            user_id,
        )
        if db.rows_affected(status) == 0:
            return False
        await conn.execute("DELETE FROM user_sessions WHERE user_id = $1", user_id)
        return True


async def record_role_change(
    *,
    subject_id: str,
    actor_id: str,
    from_role: Optional[str],
    to_role: str,
    target_type: str = "platform",
    target_id: Optional[str] = None,
    note: Optional[str] = None,
) -> None:
    """Privilege changes need to be answerable after the fact."""
    await db.execute(
        """
        INSERT INTO role_audit
          (audit_id, target_type, target_id, subject_id, from_role, to_role,
           actor_id, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        f"aud_{uuid.uuid4().hex[:10]}",
        target_type,
        target_id or subject_id,
        subject_id,
        from_role,
        to_role,
        actor_id,
        note,
    )


async def role_audit(limit: int = 100) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT a.audit_id, a.target_type, a.target_id, a.subject_id, a.from_role,
               a.to_role, a.actor_id, a.note, a.created_at,
               s.name AS subject_name, s.email AS subject_email,
               ac.name AS actor_name
          FROM role_audit a
          LEFT JOIN users s  ON s.user_id  = a.subject_id
          LEFT JOIN users ac ON ac.user_id = a.actor_id
         ORDER BY a.created_at DESC
         LIMIT $1
        """,
        limit,
    )
    return db.as_dicts(rows)


async def update_profile(
    user_id: str, *, name: Optional[str] = None, picture: Optional[str] = None
) -> Optional[dict]:
    row = await db.fetchrow(
        f"""
        UPDATE users
           SET name    = COALESCE($2, name),
               picture = COALESCE($3, picture)
         WHERE user_id = $1 AND deleted_at IS NULL
        RETURNING {_COLUMNS}
        """,
        user_id,
        name,
        picture,
    )
    return db.as_dict(row)
