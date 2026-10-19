"""Bookmarks and follows.

Both tables use a composite primary key, so ON CONFLICT DO NOTHING gives the
same idempotent behaviour the old Mongo upserts had.
"""

from app import db


# ---------- bookmarks ----------
async def bookmarked_post_ids(user_id: str, limit: int = 500) -> list[str]:
    rows = await db.fetch(
        "SELECT post_id FROM bookmarks WHERE user_id = $1 "
        "ORDER BY created_at DESC LIMIT $2",
        user_id,
        limit,
    )
    return [r["post_id"] for r in rows]


async def add_bookmark(user_id: str, post_id: str) -> None:
    await db.execute(
        "INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) "
        "ON CONFLICT (user_id, post_id) DO NOTHING",
        user_id,
        post_id,
    )


async def remove_bookmark(user_id: str, post_id: str) -> bool:
    status = await db.execute(
        "DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2", user_id, post_id
    )
    return db.rows_affected(status) > 0


# ---------- follows ----------
async def followed_creator_ids(user_id: str, limit: int = 500) -> list[str]:
    rows = await db.fetch(
        "SELECT creator_id FROM follows WHERE user_id = $1 "
        "ORDER BY created_at DESC LIMIT $2",
        user_id,
        limit,
    )
    return [r["creator_id"] for r in rows]


async def add_follow(user_id: str, creator_id: str) -> None:
    await db.execute(
        "INSERT INTO follows (user_id, creator_id) VALUES ($1, $2) "
        "ON CONFLICT (user_id, creator_id) DO NOTHING",
        user_id,
        creator_id,
    )


async def remove_follow(user_id: str, creator_id: str) -> bool:
    status = await db.execute(
        "DELETE FROM follows WHERE user_id = $1 AND creator_id = $2",
        user_id,
        creator_id,
    )
    return db.rows_affected(status) > 0
