"""Communities and membership.

Counter discipline: `member_count` and `post_count` are denormalised, so every
write that changes them happens inside the same transaction as the row it
counts. `creators.followers` drifted precisely because that pairing was left to
chance, and this module exists partly so the same bug is not repeated.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app import db

_FIELDS = (
    "community_id", "region_id", "slug", "name", "description", "avatar", "cover",
    "category", "visibility", "join_policy", "member_count", "post_count",
    "last_activity_at", "archived_at", "created_by", "created_at",
)

COMMUNITY_COLUMNS = ", ".join(_FIELDS)
# Same list qualified for queries that join community_members as `m`.
COMMUNITY_COLUMNS_C = ", ".join(f"c.{f}" for f in _FIELDS)

MEMBER_COLUMNS = """
  m.community_id, m.user_id, m.role, m.status, m.muted_until,
  m.joined_at, m.created_at
"""

_COMMUNITY_UPDATABLE = {
    "name", "description", "avatar", "cover", "category", "visibility", "join_policy",
}

# One person can only run so many communities well. The cap keeps a region from
# filling with empty rooms.
MAX_ACTIVE_COMMUNITIES_PER_USER = 2


def new_community_id() -> str:
    return f"com_{uuid.uuid4().hex[:8]}"


# ---------- reads ----------
async def list_communities(
    *,
    region_id: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    viewer_id: Optional[str] = None,
    include_private: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Discovery listing.

    Private communities are excluded unless the viewer is a member of them —
    they must never surface to someone with no standing.
    """
    where = ["c.deleted_at IS NULL", "c.archived_at IS NULL"]
    args: list[Any] = []

    if not include_private:
        if viewer_id:
            args.append(viewer_id)
            where.append(
                f"(c.visibility = 'public' OR EXISTS ("
                f"  SELECT 1 FROM community_members vm "
                f"   WHERE vm.community_id = c.community_id "
                f"     AND vm.user_id = ${len(args)} AND vm.status = 'active'))"
            )
        else:
            where.append("c.visibility = 'public'")

    if region_id:
        args.append(region_id)
        where.append(f"c.region_id = ${len(args)}")
    if category and category != "All":
        args.append(category)
        where.append(f"c.category = ${len(args)}")
    if search:
        args.append(f"%{search.strip()}%")
        where.append(f"(c.name ILIKE ${len(args)} OR c.description ILIKE ${len(args)})")

    args.extend([limit, offset])
    rows = await db.fetch(
        f"""
        SELECT {COMMUNITY_COLUMNS_C}
          FROM communities c
         WHERE {' AND '.join(where)}
         ORDER BY c.member_count DESC, c.last_activity_at DESC
         LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return db.as_dicts(rows)


async def by_id(community_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {COMMUNITY_COLUMNS} FROM communities "
        "WHERE community_id = $1 AND deleted_at IS NULL",
        community_id,
    )
    return db.as_dict(row)


async def by_slug(region_id: str, slug: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {COMMUNITY_COLUMNS} FROM communities "
        "WHERE region_id = $1 AND LOWER(slug) = LOWER($2) AND deleted_at IS NULL",
        region_id,
        slug,
    )
    return db.as_dict(row)


async def communities_for_user(user_id: str, limit: int = 100) -> list[dict]:
    """The caller's own memberships — powers the communities tab."""
    rows = await db.fetch(
        f"""
        SELECT {COMMUNITY_COLUMNS_C},
               m.role AS viewer_role, m.status AS viewer_status
          FROM community_members m
          JOIN communities c ON c.community_id = m.community_id
         WHERE m.user_id = $1
           AND m.status = 'active'
           AND c.deleted_at IS NULL
         ORDER BY c.last_activity_at DESC
         LIMIT $2
        """,
        user_id,
        limit,
    )
    return db.as_dicts(rows)


async def active_count_for_creator(user_id: str) -> int:
    """Backs the per-user creation cap."""
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM communities "
            "WHERE created_by = $1 AND deleted_at IS NULL AND archived_at IS NULL",
            user_id,
        )
        or 0
    )


# ---------- writes ----------
async def create(payload: dict, *, head_user_id: str) -> dict:
    """Creates a community and seats its head in one transaction.

    A community without a head would be unmoderatable, so the two writes cannot
    be allowed to come apart. member_count starts at 1 for that same reason.
    """
    community_id = payload.get("community_id") or new_community_id()

    async with db.transaction() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO communities
              (community_id, region_id, slug, name, description, avatar, cover,
               category, visibility, join_policy, member_count, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
            RETURNING {COMMUNITY_COLUMNS}
            """,
            community_id,
            payload["region_id"],
            payload["slug"],
            payload["name"],
            payload.get("description", ""),
            payload.get("avatar"),
            payload.get("cover"),
            payload.get("category"),
            payload.get("visibility", "public"),
            payload.get("join_policy", "open"),
            head_user_id,
        )
        await conn.execute(
            """
            INSERT INTO community_members
              (community_id, user_id, role, status, joined_at)
            VALUES ($1, $2, 'head', 'active', NOW())
            """,
            community_id,
            head_user_id,
        )
    return dict(row)


async def update(community_id: str, updates: dict[str, Any]) -> Optional[dict]:
    fields = {k: v for k, v in updates.items() if k in _COMMUNITY_UPDATABLE}
    if not fields:
        return await by_id(community_id)

    assignments, args = [], []
    for i, (column, value) in enumerate(fields.items(), start=2):
        assignments.append(f"{column} = ${i}")
        args.append(value)

    row = await db.fetchrow(
        f"UPDATE communities SET {', '.join(assignments)} "
        f"WHERE community_id = $1 AND deleted_at IS NULL RETURNING {COMMUNITY_COLUMNS}",
        community_id,
        *args,
    )
    return db.as_dict(row)


async def soft_delete(community_id: str) -> bool:
    status = await db.execute(
        "UPDATE communities SET deleted_at = NOW() "
        "WHERE community_id = $1 AND deleted_at IS NULL",
        community_id,
    )
    return db.rows_affected(status) > 0


async def touch_activity(community_id: str, conn=None) -> None:
    """Pushes back the auto-archive clock. Called on every post and event."""
    sql = "UPDATE communities SET last_activity_at = NOW() WHERE community_id = $1"
    if conn is not None:
        await conn.execute(sql, community_id)
    else:
        await db.execute(sql, community_id)


# ---------- membership ----------
async def member(community_id: str, user_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {MEMBER_COLUMNS} FROM community_members m "
        "WHERE m.community_id = $1 AND m.user_id = $2",
        community_id,
        user_id,
    )
    return db.as_dict(row)


async def list_members(
    community_id: str,
    *,
    status: str = "active",
    role: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    where = ["m.community_id = $1", "m.status = $2"]
    args: list[Any] = [community_id, status]
    if role:
        args.append(role)
        where.append(f"m.role = ${len(args)}")

    args.extend([limit, offset])
    rows = await db.fetch(
        f"""
        SELECT {MEMBER_COLUMNS}, u.name, u.picture
          FROM community_members m
          JOIN users u ON u.user_id = m.user_id
         WHERE {' AND '.join(where)}
           AND u.deleted_at IS NULL
         ORDER BY CASE m.role WHEN 'head' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
                  m.joined_at NULLS LAST
         LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return db.as_dicts(rows)


async def join(community_id: str, user_id: str, *, status: str = "active") -> dict:
    """Idempotent join.

    member_count is only bumped when a genuinely new active row appears —
    re-joining, or a pending request, must not inflate it. The RETURNING clause
    reports whether the row was actually inserted so the counter stays exact.
    """
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO community_members
              (community_id, user_id, role, status, joined_at)
            VALUES ($1, $2, 'member', $3, CASE WHEN $3 = 'active' THEN NOW() END)
            ON CONFLICT (community_id, user_id) DO UPDATE
              SET status = CASE
                    WHEN community_members.status = 'banned'
                      THEN community_members.status
                    ELSE EXCLUDED.status
                  END,
                  joined_at = COALESCE(community_members.joined_at, EXCLUDED.joined_at)
            RETURNING role, status, (xmax = 0) AS inserted
            """,
            community_id,
            user_id,
            status,
        )
        if row["inserted"] and row["status"] == "active":
            await conn.execute(
                "UPDATE communities SET member_count = member_count + 1 "
                "WHERE community_id = $1",
                community_id,
            )
        return dict(row)


async def approve(community_id: str, user_id: str, approver_id: str) -> bool:
    """Moves a pending request to active, incrementing the counter with it."""
    async with db.transaction() as conn:
        status = await conn.execute(
            "UPDATE community_members SET status = 'active', joined_at = NOW() "
            "WHERE community_id = $1 AND user_id = $2 AND status = 'pending'",
            community_id,
            user_id,
        )
        if db.rows_affected(status) == 0:
            return False
        await conn.execute(
            "UPDATE communities SET member_count = member_count + 1 "
            "WHERE community_id = $1",
            community_id,
        )
        return True


async def leave(community_id: str, user_id: str) -> bool:
    """Leaving deletes the row; the head cannot leave without transferring first."""
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            "DELETE FROM community_members "
            "WHERE community_id = $1 AND user_id = $2 AND role <> 'head' "
            "RETURNING status",
            community_id,
            user_id,
        )
        if row is None:
            return False
        if row["status"] == "active":
            await conn.execute(
                "UPDATE communities "
                "SET member_count = GREATEST(member_count - 1, 0) "
                "WHERE community_id = $1",
                community_id,
            )
        return True


async def set_role(community_id: str, user_id: str, role: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"UPDATE community_members SET role = $3 "
        "WHERE community_id = $1 AND user_id = $2 AND status = 'active' "
        "  AND role <> 'head' "
        f"RETURNING {MEMBER_COLUMNS.replace('m.', '')}",
        community_id,
        user_id,
        role,
    )
    return db.as_dict(row)


async def transfer_head(community_id: str, from_user_id: str, to_user_id: str) -> bool:
    """Ownership transfer.

    Both writes must land together — a single-head unique index means doing them
    apart would either fail or briefly leave the community headless.
    """
    async with db.transaction() as conn:
        target = await conn.fetchval(
            "SELECT 1 FROM community_members "
            "WHERE community_id = $1 AND user_id = $2 AND status = 'active'",
            community_id,
            to_user_id,
        )
        if not target:
            return False
        # Step down first: the partial unique index allows only one head.
        await conn.execute(
            "UPDATE community_members SET role = 'manager' "
            "WHERE community_id = $1 AND user_id = $2",
            community_id,
            from_user_id,
        )
        await conn.execute(
            "UPDATE community_members SET role = 'head' "
            "WHERE community_id = $1 AND user_id = $2",
            community_id,
            to_user_id,
        )
        return True


async def ban(community_id: str, user_id: str) -> bool:
    """Bans a member. The head cannot be banned.

    Only decrements when the member was actually active, so banning an already
    banned or still-pending user leaves the counter alone.
    """
    async with db.transaction() as conn:
        # Read the prior status under a row lock, then write: expressing this as
        # a subquery inside RETURNING would be ambiguous about whether it sees
        # the old or new row.
        prior = await conn.fetchrow(
            "SELECT role, status FROM community_members "
            "WHERE community_id = $1 AND user_id = $2 FOR UPDATE",
            community_id,
            user_id,
        )
        if prior is None or prior["role"] == "head" or prior["status"] == "banned":
            return False

        await conn.execute(
            "UPDATE community_members SET status = 'banned', role = 'member' "
            "WHERE community_id = $1 AND user_id = $2",
            community_id,
            user_id,
        )
        if prior["status"] == "active":
            await conn.execute(
                "UPDATE communities "
                "SET member_count = GREATEST(member_count - 1, 0) "
                "WHERE community_id = $1",
                community_id,
            )
        return True


async def mute(community_id: str, user_id: str, minutes: int) -> bool:
    until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    status = await db.execute(
        "UPDATE community_members SET muted_until = $3 "
        "WHERE community_id = $1 AND user_id = $2 AND role <> 'head'",
        community_id,
        user_id,
        until,
    )
    return db.rows_affected(status) > 0


async def recount_members(community_id: str) -> int:
    """Repairs a drifted counter. Also the assertion the tests lean on."""
    return int(
        await db.fetchval(
            "UPDATE communities SET member_count = ("
            "  SELECT COUNT(*) FROM community_members "
            "   WHERE community_id = $1 AND status = 'active') "
            "WHERE community_id = $1 RETURNING member_count",
            community_id,
        )
        or 0
    )
