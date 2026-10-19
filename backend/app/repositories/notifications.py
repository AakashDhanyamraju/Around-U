"""In-app notification inbox.

No email, no push. Three events matter: someone appreciated a spot you found,
someone went to it, and you reached a new tier.

Two shapes here are deliberate.

`push()` takes a connection rather than using the module-level `db` helpers, so
it joins the caller's transaction. Appreciating a spot and telling the finder
about it must either both happen or neither — a notification for an appreciation
that got rolled back is a lie.

Nothing stores rendered text. The sentence is built by the client from `type`
and `data`, so rewording "went to your spot" applies retroactively to messages
already sitting in someone's inbox instead of needing a backfill.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from app import db

NOTIFICATION_COLUMNS = """
  notification_id, user_id, type, region_id, actor_user_id,
  target_type, target_id, data, read_at, created_at
"""


def new_notification_id() -> str:
    return f"ntf_{uuid.uuid4().hex[:10]}"


def _normalise(row: dict) -> dict:
    """asyncpg hands JSONB back as a string unless a codec is registered."""
    data = row.get("data")
    if isinstance(data, str):
        try:
            row["data"] = json.loads(data)
        except json.JSONDecodeError:
            row["data"] = {}
    elif data is None:
        row["data"] = {}
    return row


async def push(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    type: str,
    region_id: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    data: Optional[dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
) -> Optional[dict]:
    """Insert one notification, at most once per `dedupe_key`.

    Runs on the caller's connection so it shares their transaction.

    Nobody is ever notified about their own action — the finder marking their
    own spot visited, or a self-appreciation that got past the router, would
    otherwise produce a notification from you to you.
    """
    if actor_user_id is not None and actor_user_id == user_id:
        return None

    row = await conn.fetchrow(
        f"""
        INSERT INTO notifications
          (notification_id, user_id, type, region_id, actor_user_id,
           target_type, target_id, data, dedupe_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
          DO NOTHING
        RETURNING {NOTIFICATION_COLUMNS}
        """,
        new_notification_id(),
        user_id,
        type,
        region_id,
        actor_user_id,
        target_type,
        target_id,
        json.dumps(data or {}),
        dedupe_key,
    )
    return _normalise(dict(row)) if row is not None else None


async def push_visit(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    actor_user_id: str,
    region_id: str,
    spot_id: str,
    spot_name: str,
    actor_name: str,
) -> Optional[dict]:
    """"Someone went to your spot", collapsed to one live row per spot per day.

    A plain dedupe would freeze the first visitor's name and count forever, so
    the day's row is updated instead: the count climbs, the timestamp moves, and
    `read_at` clears so it resurfaces as unread. What the finder sees is
    "3 people went to Blue Bottle today", not a stale "1 person went".
    """
    # Same guard as `push`. This function inserts directly rather than going
    # through it, so without this the finder gets told about their own visit.
    if actor_user_id == user_id:
        return None

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    row = await conn.fetchrow(
        f"""
        INSERT INTO notifications
          (notification_id, user_id, type, region_id, actor_user_id,
           target_type, target_id, data, dedupe_key)
        VALUES ($1, $2, 'spot_visited', $3, $4, 'spot', $5, $6::jsonb, $7)
        ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
          DO UPDATE SET
            data = jsonb_set(
              notifications.data,
              '{{count}}',
              to_jsonb(COALESCE((notifications.data ->> 'count')::int, 1) + 1)
            ),
            actor_user_id = EXCLUDED.actor_user_id,
            read_at = NULL,
            created_at = NOW()
        RETURNING {NOTIFICATION_COLUMNS}
        """,
        new_notification_id(),
        user_id,
        region_id,
        actor_user_id,
        spot_id,
        json.dumps({"spot_name": spot_name, "actor_name": actor_name, "count": 1}),
        f"visit:{spot_id}:{day}",
    )
    return _normalise(dict(row)) if row is not None else None


async def list_for_user(
    user_id: str, *, unread_only: bool = False, limit: int = 50, offset: int = 0
) -> list[dict]:
    where = ["n.user_id = $1"]
    args: list[Any] = [user_id]
    if unread_only:
        where.append("n.read_at IS NULL")

    args.extend([limit, offset])
    rows = await db.fetch(
        f"""
        SELECT n.notification_id, n.user_id, n.type, n.region_id, n.actor_user_id,
               n.target_type, n.target_id, n.data, n.read_at, n.created_at,
               a.name AS actor_name, a.picture AS actor_picture
          FROM notifications n
          LEFT JOIN users a
            ON a.user_id = n.actor_user_id AND a.deleted_at IS NULL
         WHERE {' AND '.join(where)}
         ORDER BY n.created_at DESC
         LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return [_normalise(dict(r)) for r in rows]


async def unread_count(user_id: str) -> int:
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = $1 AND read_at IS NULL",
            user_id,
        )
        or 0
    )


async def mark_read(notification_id: str, user_id: str) -> bool:
    """Scoped to the owner, so one person cannot dismiss another's inbox."""
    status = await db.execute(
        "UPDATE notifications SET read_at = NOW() "
        "WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL",
        notification_id,
        user_id,
    )
    if db.rows_affected(status) > 0:
        return True
    # Already read is success; a row belonging to someone else is not.
    return bool(
        await db.fetchval(
            "SELECT 1 FROM notifications WHERE notification_id = $1 AND user_id = $2",
            notification_id,
            user_id,
        )
    )


async def mark_all_read(user_id: str) -> int:
    status = await db.execute(
        "UPDATE notifications SET read_at = NOW() "
        "WHERE user_id = $1 AND read_at IS NULL",
        user_id,
    )
    return db.rows_affected(status)
