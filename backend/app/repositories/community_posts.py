"""Community posts, comments and reactions.

Kept out of `content.py` on purpose: `posts` is the public regional feed, this is
member-authored content that may live inside a private community. Two tables
means a missed filter cannot leak one into the other.

Comments and reactions are polymorphic on (target_type, target_id) so the same
tables serve community posts today and regional posts and events later.
"""

import uuid
from typing import Any, Optional

from app import db
from app.repositories import communities

POST_COLUMNS = """
  cp.community_post_id, cp.community_id, cp.author_user_id, cp.body, cp.media,
  cp.media_type, cp.is_pinned, cp.comment_count, cp.reaction_count, cp.created_at
"""

COMMENT_COLUMNS = """
  cm.comment_id, cm.target_type, cm.target_id, cm.parent_comment_id,
  cm.author_user_id, cm.body, cm.created_at
"""

_POST_UPDATABLE = {"body", "media", "media_type"}

TARGET_COMMUNITY_POST = "community_post"


def new_community_post_id() -> str:
    return f"cp_{uuid.uuid4().hex[:8]}"


def new_comment_id() -> str:
    return f"cm_{uuid.uuid4().hex[:8]}"


def _normalise(row: Optional[dict]) -> Optional[dict]:
    if row is None:
        return None
    row["media"] = list(row.get("media") or [])
    return row


# ---------- posts ----------
async def list_posts(
    community_id: str, *, viewer_id: Optional[str] = None, limit: int = 50, offset: int = 0
) -> list[dict]:
    """Pinned first, then newest — matching idx_community_posts_feed.

    `viewer_reactions` comes back in the same query so the client can render
    toggle state without a second round trip per post.
    """
    rows = await db.fetch(
        f"""
        SELECT {POST_COLUMNS}, u.name AS author_name, u.picture AS author_picture,
               COALESCE(vr.emojis, '{{}}') AS viewer_reactions
          FROM community_posts cp
          JOIN users u ON u.user_id = cp.author_user_id
          LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(r.emoji) AS emojis
              FROM reactions r
             WHERE r.target_type = '{TARGET_COMMUNITY_POST}'
               AND r.target_id = cp.community_post_id
               AND r.user_id = $2
          ) vr ON TRUE
         WHERE cp.community_id = $1
           AND cp.deleted_at IS NULL
         ORDER BY cp.is_pinned DESC, cp.created_at DESC
         LIMIT $3 OFFSET $4
        """,
        community_id,
        viewer_id or "",
        limit,
        offset,
    )
    out = []
    for r in rows:
        row = _normalise(dict(r))
        row["viewer_reactions"] = list(row.get("viewer_reactions") or [])
        out.append(row)
    return out


async def by_id(community_post_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"""
        SELECT {POST_COLUMNS}, u.name AS author_name, u.picture AS author_picture
          FROM community_posts cp
          JOIN users u ON u.user_id = cp.author_user_id
         WHERE cp.community_post_id = $1 AND cp.deleted_at IS NULL
        """,
        community_post_id,
    )
    return _normalise(db.as_dict(row))


async def create(community_id: str, author_user_id: str, payload: dict) -> dict:
    """Insert, bump the community's post_count, and push back its idle clock —
    all in one transaction so the counter cannot drift."""
    post_id = new_community_post_id()
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO community_posts
              (community_post_id, community_id, author_user_id, body, media, media_type)
            VALUES ($1, $2, $3, $4, $5::text[], $6)
            RETURNING {POST_COLUMNS.replace('cp.', '')}
            """,
            post_id,
            community_id,
            author_user_id,
            payload.get("body", ""),
            list(payload.get("media") or []),
            payload.get("media_type", "none"),
        )
        await conn.execute(
            "UPDATE communities SET post_count = post_count + 1, "
            "                       last_activity_at = NOW() "
            "WHERE community_id = $1",
            community_id,
        )
    return _normalise(dict(row))


async def update(community_post_id: str, updates: dict[str, Any]) -> Optional[dict]:
    fields = {k: v for k, v in updates.items() if k in _POST_UPDATABLE}
    if not fields:
        return await by_id(community_post_id)

    assignments, args = [], []
    for i, (column, value) in enumerate(fields.items(), start=2):
        cast = "::text[]" if column == "media" else ""
        assignments.append(f"{column} = ${i}{cast}")
        args.append(list(value) if column == "media" else value)

    row = await db.fetchrow(
        f"UPDATE community_posts SET {', '.join(assignments)} "
        "WHERE community_post_id = $1 AND deleted_at IS NULL "
        f"RETURNING {POST_COLUMNS.replace('cp.', '')}",
        community_post_id,
        *args,
    )
    return _normalise(db.as_dict(row))


async def set_pinned(community_post_id: str, pinned: bool) -> Optional[dict]:
    row = await db.fetchrow(
        f"UPDATE community_posts SET is_pinned = $2 "
        "WHERE community_post_id = $1 AND deleted_at IS NULL "
        f"RETURNING {POST_COLUMNS.replace('cp.', '')}",
        community_post_id,
        pinned,
    )
    return _normalise(db.as_dict(row))


async def soft_delete(community_post_id: str) -> bool:
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            "UPDATE community_posts SET deleted_at = NOW() "
            "WHERE community_post_id = $1 AND deleted_at IS NULL "
            "RETURNING community_id",
            community_post_id,
        )
        if row is None:
            return False
        await conn.execute(
            "UPDATE communities SET post_count = GREATEST(post_count - 1, 0) "
            "WHERE community_id = $1",
            row["community_id"],
        )
        return True


async def recount_posts(community_id: str) -> int:
    return int(
        await db.fetchval(
            "UPDATE communities SET post_count = ("
            "  SELECT COUNT(*) FROM community_posts "
            "   WHERE community_id = $1 AND deleted_at IS NULL) "
            "WHERE community_id = $1 RETURNING post_count",
            community_id,
        )
        or 0
    )


# ---------- comments ----------
async def list_comments(
    target_type: str, target_id: str, *, limit: int = 200, offset: int = 0
) -> list[dict]:
    rows = await db.fetch(
        f"""
        SELECT {COMMENT_COLUMNS}, u.name AS author_name, u.picture AS author_picture
          FROM comments cm
          JOIN users u ON u.user_id = cm.author_user_id
         WHERE cm.target_type = $1 AND cm.target_id = $2 AND cm.deleted_at IS NULL
         ORDER BY cm.created_at
         LIMIT $3 OFFSET $4
        """,
        target_type,
        target_id,
        limit,
        offset,
    )
    return db.as_dicts(rows)


async def comment_by_id(comment_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {COMMENT_COLUMNS} FROM comments cm "
        "WHERE cm.comment_id = $1 AND cm.deleted_at IS NULL",
        comment_id,
    )
    return db.as_dict(row)


async def add_comment(
    target_type: str, target_id: str, author_user_id: str, payload: dict
) -> dict:
    comment_id = new_comment_id()
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO comments
              (comment_id, target_type, target_id, parent_comment_id,
               author_user_id, body)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING {COMMENT_COLUMNS.replace('cm.', '')}
            """,
            comment_id,
            target_type,
            target_id,
            payload.get("parent_comment_id"),
            author_user_id,
            payload["body"],
        )
        if target_type == TARGET_COMMUNITY_POST:
            await conn.execute(
                "UPDATE community_posts SET comment_count = comment_count + 1 "
                "WHERE community_post_id = $1",
                target_id,
            )
    return dict(row)


async def soft_delete_comment(comment_id: str) -> bool:
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            "UPDATE comments SET deleted_at = NOW() "
            "WHERE comment_id = $1 AND deleted_at IS NULL "
            "RETURNING target_type, target_id",
            comment_id,
        )
        if row is None:
            return False
        if row["target_type"] == TARGET_COMMUNITY_POST:
            await conn.execute(
                "UPDATE community_posts "
                "SET comment_count = GREATEST(comment_count - 1, 0) "
                "WHERE community_post_id = $1",
                row["target_id"],
            )
        return True


# ---------- reactions ----------
async def add_reaction(
    target_type: str, target_id: str, user_id: str, emoji: str
) -> bool:
    """Idempotent. Returns True only when a new reaction was actually stored, so
    the denormalised counter is incremented exactly once."""
    async with db.transaction() as conn:
        status = await conn.execute(
            "INSERT INTO reactions (target_type, target_id, user_id, emoji) "
            "VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            target_type,
            target_id,
            user_id,
            emoji,
        )
        if db.rows_affected(status) == 0:
            return False
        if target_type == TARGET_COMMUNITY_POST:
            await conn.execute(
                "UPDATE community_posts SET reaction_count = reaction_count + 1 "
                "WHERE community_post_id = $1",
                target_id,
            )
        return True


async def remove_reaction(
    target_type: str, target_id: str, user_id: str, emoji: str
) -> bool:
    async with db.transaction() as conn:
        status = await conn.execute(
            "DELETE FROM reactions WHERE target_type = $1 AND target_id = $2 "
            "  AND user_id = $3 AND emoji = $4",
            target_type,
            target_id,
            user_id,
            emoji,
        )
        if db.rows_affected(status) == 0:
            return False
        if target_type == TARGET_COMMUNITY_POST:
            await conn.execute(
                "UPDATE community_posts "
                "SET reaction_count = GREATEST(reaction_count - 1, 0) "
                "WHERE community_post_id = $1",
                target_id,
            )
        return True


async def reaction_summary(
    target_type: str, target_id: str, viewer_id: Optional[str] = None
) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT emoji,
               COUNT(*)::int AS count,
               BOOL_OR(user_id = $3) AS reacted
          FROM reactions
         WHERE target_type = $1 AND target_id = $2
         GROUP BY emoji
         ORDER BY count DESC, emoji
        """,
        target_type,
        target_id,
        viewer_id or "",
    )
    return [
        {"emoji": r["emoji"], "count": r["count"], "reacted": bool(r["reacted"])}
        for r in rows
    ]


async def community_id_for_post(community_post_id: str) -> Optional[str]:
    """Resolves a post to its community so permission checks can run against it."""
    return await db.fetchval(
        "SELECT community_id FROM community_posts "
        "WHERE community_post_id = $1 AND deleted_at IS NULL",
        community_post_id,
    )


async def touch_community(community_id: str) -> None:
    await communities.touch_activity(community_id)
