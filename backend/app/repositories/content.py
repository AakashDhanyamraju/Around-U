"""Creators and posts.

The nested `creator` object the frontend expects is built with a LEFT JOIN here,
replacing the old two-query + in-Python id-map approach.
"""

import uuid
from typing import Any, Optional

from app import db

CREATOR_COLUMNS = """
  creator_id, handle, name, bio, avatar, cover, city, categories, followers,
  region_id
"""

_POST_COLUMNS = """
  p.post_id, p.creator_id, p.image, p.caption, p.category, p.neighborhood,
  p.location_name, p.lat, p.lng, p.likes, p.media_type, p.video_url,
  p.hashtags, p.source, p.original_url, p.is_sponsored, p.region_id, p.created_at
"""

# Every row predates regions, so writes that omit one land in the seed region
# rather than NULL. Multi-city callers always pass region_id explicitly.
DEFAULT_REGION_ID = "reg_houston"

_POST_WITH_CREATOR = f"""
  {_POST_COLUMNS},
  c.creator_id AS c_creator_id, c.handle AS c_handle, c.name AS c_name,
  c.bio AS c_bio, c.avatar AS c_avatar, c.cover AS c_cover, c.city AS c_city,
  c.categories AS c_categories, c.followers AS c_followers
"""

# Columns an admin PATCH is allowed to touch, guarding the dynamic UPDATE below.
_POST_UPDATABLE = {
    "creator_id", "image", "caption", "category", "neighborhood", "location_name",
    "lat", "lng", "media_type", "video_url", "hashtags", "source", "original_url",
    "is_sponsored",
}
_CREATOR_UPDATABLE = {
    "handle", "name", "bio", "avatar", "cover", "city", "categories", "region_id",
}


def new_creator_id() -> str:
    return f"cr_{uuid.uuid4().hex[:8]}"


def new_post_id() -> str:
    return f"po_{uuid.uuid4().hex[:8]}"


def _split_creator(row: dict) -> dict:
    """Lifts the c_* columns of a joined row into a nested `creator` object."""
    post = {k: v for k, v in row.items() if not k.startswith("c_")}
    if row.get("c_creator_id"):
        post["creator"] = {
            "creator_id": row["c_creator_id"],
            "handle": row["c_handle"],
            "name": row["c_name"],
            "bio": row["c_bio"],
            "avatar": row["c_avatar"],
            "cover": row["c_cover"],
            "city": row["c_city"],
            "categories": list(row["c_categories"] or []),
            "followers": row["c_followers"],
        }
    else:
        post["creator"] = None
    post["hashtags"] = list(post.get("hashtags") or [])
    return post


def _normalise_creator(row: Optional[dict]) -> Optional[dict]:
    if row is None:
        return None
    row["categories"] = list(row.get("categories") or [])
    return row


# ---------- creators ----------
async def list_creators(limit: int = 200) -> list[dict]:
    rows = await db.fetch(
        f"SELECT {CREATOR_COLUMNS} FROM creators "
        "WHERE deleted_at IS NULL ORDER BY followers DESC LIMIT $1",
        limit,
    )
    return [_normalise_creator(dict(r)) for r in rows]


async def creator_by_id(creator_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {CREATOR_COLUMNS} FROM creators "
        "WHERE creator_id = $1 AND deleted_at IS NULL",
        creator_id,
    )
    return _normalise_creator(db.as_dict(row))


async def creators_by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    rows = await db.fetch(
        f"SELECT {CREATOR_COLUMNS} FROM creators "
        "WHERE creator_id = ANY($1::text[]) AND deleted_at IS NULL",
        ids,
    )
    return [_normalise_creator(dict(r)) for r in rows]


async def insert_creator(payload: dict) -> dict:
    """Creates a creator and grants them publishing rights in their own region.

    The grant is not optional bookkeeping: `creator_regions` is what
    require_region_grant() checks, so a creator created without one could not
    publish anywhere. Both writes share a transaction to keep that true.
    """
    creator_id = payload.get("creator_id") or new_creator_id()
    region_id = payload.get("region_id") or DEFAULT_REGION_ID

    async with db.transaction() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO creators
              (creator_id, handle, name, bio, avatar, cover, city, categories,
               followers, region_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10)
            RETURNING {CREATOR_COLUMNS}
            """,
            creator_id,
            payload["handle"],
            payload["name"],
            payload.get("bio", ""),
            payload.get("avatar", ""),
            payload.get("cover"),
            payload.get("city", "Houston"),
            list(payload.get("categories") or []),
            int(payload.get("followers") or 0),
            region_id,
        )
        await conn.execute(
            "INSERT INTO creator_regions (creator_id, region_id) VALUES ($1, $2) "
            "ON CONFLICT (creator_id, region_id) DO NOTHING",
            creator_id,
            region_id,
        )
    return _normalise_creator(dict(row))


async def update_creator(creator_id: str, updates: dict[str, Any]) -> Optional[dict]:
    fields = {k: v for k, v in updates.items() if k in _CREATOR_UPDATABLE}
    if not fields:
        return await creator_by_id(creator_id)

    assignments, args = [], []
    for i, (column, value) in enumerate(fields.items(), start=2):
        cast = "::text[]" if column == "categories" else ""
        assignments.append(f"{column} = ${i}{cast}")
        args.append(list(value) if column == "categories" else value)

    row = await db.fetchrow(
        f"UPDATE creators SET {', '.join(assignments)} "
        f"WHERE creator_id = $1 AND deleted_at IS NULL RETURNING {CREATOR_COLUMNS}",
        creator_id,
        *args,
    )
    return _normalise_creator(db.as_dict(row))


async def soft_delete_creator(creator_id: str) -> tuple[int, int]:
    """Soft-deletes a creator and their posts. Returns (creators, posts) affected."""
    creators = db.rows_affected(
        await db.execute(
            "UPDATE creators SET deleted_at = NOW() "
            "WHERE creator_id = $1 AND deleted_at IS NULL",
            creator_id,
        )
    )
    posts = db.rows_affected(
        await db.execute(
            "UPDATE posts SET deleted_at = NOW() "
            "WHERE creator_id = $1 AND deleted_at IS NULL",
            creator_id,
        )
    )
    return creators, posts


# ---------- posts ----------
async def list_posts(category: Optional[str] = None, limit: int = 100) -> list[dict]:
    if category and category.lower() != "all":
        rows = await db.fetch(
            f"""
            SELECT {_POST_WITH_CREATOR}
              FROM posts p
              LEFT JOIN creators c
                ON c.creator_id = p.creator_id AND c.deleted_at IS NULL
             WHERE p.deleted_at IS NULL AND p.category = $1
             ORDER BY p.created_at DESC
             LIMIT $2
            """,
            category,
            limit,
        )
    else:
        rows = await db.fetch(
            f"""
            SELECT {_POST_WITH_CREATOR}
              FROM posts p
              LEFT JOIN creators c
                ON c.creator_id = p.creator_id AND c.deleted_at IS NULL
             WHERE p.deleted_at IS NULL
             ORDER BY p.created_at DESC
             LIMIT $1
            """,
            limit,
        )
    return [_split_creator(dict(r)) for r in rows]


async def posts_from_followed(
    user_id: str, category: Optional[str] = None, limit: int = 100
) -> list[dict]:
    """The Feed tab: posts by creators this person follows, newest first.

    Doing this as a join rather than filtering /posts client-side matters as soon
    as there is real data — the client would otherwise pull every post in the
    region to show the handful from twelve people.
    """
    filters = ["p.deleted_at IS NULL"]
    args: list[Any] = [user_id]
    if category and category.lower() != "all":
        args.append(category)
        filters.append(f"p.category = ${len(args)}")

    args.append(limit)
    rows = await db.fetch(
        f"""
        SELECT {_POST_WITH_CREATOR}
          FROM posts p
          JOIN follows f
            ON f.creator_id = p.creator_id AND f.user_id = $1
          LEFT JOIN creators c
            ON c.creator_id = p.creator_id AND c.deleted_at IS NULL
         WHERE {' AND '.join(filters)}
         ORDER BY p.created_at DESC
         LIMIT ${len(args)}
        """,
        *args,
    )
    return [_split_creator(dict(r)) for r in rows]


async def post_by_id(post_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"""
        SELECT {_POST_WITH_CREATOR}
          FROM posts p
          LEFT JOIN creators c
            ON c.creator_id = p.creator_id AND c.deleted_at IS NULL
         WHERE p.post_id = $1 AND p.deleted_at IS NULL
        """,
        post_id,
    )
    return _split_creator(dict(row)) if row else None


async def posts_by_creator(creator_id: str, limit: int = 200) -> list[dict]:
    rows = await db.fetch(
        f"""
        SELECT {_POST_COLUMNS}
          FROM posts p
         WHERE p.creator_id = $1 AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT $2
        """,
        creator_id,
        limit,
    )
    return [_split_creator(dict(r)) for r in rows]


async def related_posts(post_id: str, category: str, limit: int = 6) -> list[dict]:
    rows = await db.fetch(
        f"""
        SELECT {_POST_COLUMNS}
          FROM posts p
         WHERE p.post_id <> $1 AND p.category = $2 AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT $3
        """,
        post_id,
        category,
        limit,
    )
    return [_split_creator(dict(r)) for r in rows]


async def posts_by_ids(post_ids: list[str]) -> list[dict]:
    if not post_ids:
        return []
    rows = await db.fetch(
        f"""
        SELECT {_POST_WITH_CREATOR}
          FROM posts p
          LEFT JOIN creators c
            ON c.creator_id = p.creator_id AND c.deleted_at IS NULL
         WHERE p.post_id = ANY($1::text[]) AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC
        """,
        post_ids,
    )
    return [_split_creator(dict(r)) for r in rows]


async def insert_post(payload: dict) -> dict:
    post_id = payload.get("post_id") or new_post_id()
    row = await db.fetchrow(
        """
        INSERT INTO posts
          (post_id, creator_id, image, caption, category, neighborhood,
           location_name, lat, lng, likes, media_type, video_url, hashtags,
           source, original_url, is_sponsored, region_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[],
                $14, $15, $16, $17, COALESCE($18, NOW()))
        RETURNING post_id
        """,
        post_id,
        payload["creator_id"],
        payload["image"],
        payload.get("caption", ""),
        payload["category"],
        payload["neighborhood"],
        payload.get("location_name"),
        payload.get("lat"),
        payload.get("lng"),
        int(payload.get("likes") or 0),
        payload.get("media_type") or "image",
        payload.get("video_url"),
        list(payload.get("hashtags") or []),
        payload.get("source"),
        payload.get("original_url"),
        bool(payload.get("is_sponsored")),
        payload.get("region_id") or DEFAULT_REGION_ID,
        payload.get("created_at"),
    )
    return await post_by_id(row["post_id"])


async def update_post(post_id: str, updates: dict[str, Any]) -> Optional[dict]:
    fields = {k: v for k, v in updates.items() if k in _POST_UPDATABLE}
    if not fields:
        return await post_by_id(post_id)

    assignments, args = [], []
    for i, (column, value) in enumerate(fields.items(), start=2):
        cast = "::text[]" if column == "hashtags" else ""
        assignments.append(f"{column} = ${i}{cast}")
        args.append(list(value) if column == "hashtags" else value)

    status = await db.execute(
        f"UPDATE posts SET {', '.join(assignments)} "
        "WHERE post_id = $1 AND deleted_at IS NULL",
        post_id,
        *args,
    )
    if db.rows_affected(status) == 0:
        return None
    return await post_by_id(post_id)


# ---------- creator region grants ----------
async def regions_for_creator(creator_id: str) -> list[dict]:
    """Which regions this creator may publish into."""
    rows = await db.fetch(
        """
        SELECT r.region_id, r.slug, r.name, r.state, r.country, r.timezone,
               r.center_lat, r.center_lng, r.is_active
          FROM creator_regions cr
          JOIN regions r ON r.region_id = cr.region_id
         WHERE cr.creator_id = $1 AND r.deleted_at IS NULL
         ORDER BY r.name
        """,
        creator_id,
    )
    return db.as_dicts(rows)


async def grant_region(creator_id: str, region_id: str, granted_by: str) -> None:
    await db.execute(
        "INSERT INTO creator_regions (creator_id, region_id, granted_by) "
        "VALUES ($1, $2, $3) ON CONFLICT (creator_id, region_id) DO NOTHING",
        creator_id,
        region_id,
        granted_by,
    )


async def revoke_region(creator_id: str, region_id: str) -> bool:
    status = await db.execute(
        "DELETE FROM creator_regions WHERE creator_id = $1 AND region_id = $2",
        creator_id,
        region_id,
    )
    return db.rows_affected(status) > 0


async def soft_delete_post(post_id: str) -> int:
    return db.rows_affected(
        await db.execute(
            "UPDATE posts SET deleted_at = NOW() "
            "WHERE post_id = $1 AND deleted_at IS NULL",
            post_id,
        )
    )


# ---------- stats / maintenance ----------
async def stats() -> dict:
    totals = await db.fetchrow(
        """
        SELECT
          (SELECT count(*) FROM posts WHERE deleted_at IS NULL)                       AS total_posts,
          (SELECT count(*) FROM creators WHERE deleted_at IS NULL)                    AS total_creators,
          (SELECT count(*) FROM posts WHERE deleted_at IS NULL
             AND media_type = 'video')                                                AS video_count,
          (SELECT count(*) FROM posts WHERE deleted_at IS NULL
             AND is_sponsored)                                                        AS sponsored_count
        """
    )
    by_category = await db.fetch(
        "SELECT category, count(*) AS count FROM posts WHERE deleted_at IS NULL "
        "GROUP BY category ORDER BY count DESC"
    )
    by_creator = await db.fetch(
        """
        SELECT p.creator_id,
               COALESCE(c.name, p.creator_id) AS name,
               count(*) AS count
          FROM posts p
          LEFT JOIN creators c ON c.creator_id = p.creator_id
         WHERE p.deleted_at IS NULL
         GROUP BY p.creator_id, c.name
         ORDER BY count DESC
        """
    )
    return {
        "total_posts": totals["total_posts"],
        "total_creators": totals["total_creators"],
        "video_count": totals["video_count"],
        "sponsored_count": totals["sponsored_count"],
        "by_category": [
            {"category": r["category"], "count": r["count"]} for r in by_category
        ],
        "by_creator": [
            {"creator_id": r["creator_id"], "name": r["name"], "count": r["count"]}
            for r in by_creator
        ],
    }


async def purge_non_seed() -> tuple[int, int]:
    """Hard-deletes everything the seed did not create, restoring the demo baseline.

    Hard delete (not soft) is deliberate: this is a test/bootstrap reset, and
    leaving tombstones behind would make row counts drift over time.
    """
    posts = db.rows_affected(
        await db.execute("DELETE FROM posts WHERE post_id NOT LIKE 'po_seed_%'")
    )
    creators = db.rows_affected(
        await db.execute(
            """
            DELETE FROM creators
             WHERE creator_id NOT IN (
               SELECT DISTINCT creator_id FROM posts WHERE post_id LIKE 'po_seed_%'
             )
            """
        )
    )
    return posts, creators
