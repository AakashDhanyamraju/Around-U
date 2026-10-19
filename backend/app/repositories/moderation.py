"""Reports and blocks.

These are the escape hatches. Every user-facing surface — community posts,
comments, events, profiles — needs both, and they need to work before strangers
are invited to meet each other in a park.
"""

import uuid
from typing import Any, Optional

from app import db

REPORT_COLUMNS = """
  report_id, target_type, target_id, community_id, reporter_user_id,
  reason, note, status, handled_by, handled_at, created_at,
  resolution, resolution_note
"""

# Welfare first, then oldest-unhandled-first within each tier. A report that
# someone may be at risk is not allowed to sit behind a week of spam.
_QUEUE_ORDER = "(reason = 'self_harm') DESC, created_at DESC"


def new_report_id() -> str:
    return f"rep_{uuid.uuid4().hex[:8]}"


# ---------- reports ----------
async def create_report(
    reporter_user_id: str,
    payload: dict,
    *,
    community_id: Optional[str] = None,
) -> Optional[dict]:
    """Files a report.

    A partial unique index allows one *open* report per person per target, so
    re-reporting the same thing is a silent no-op rather than a way to flood the
    moderation queue. Returns None in that case.
    """
    row = await db.fetchrow(
        f"""
        INSERT INTO reports
          (report_id, target_type, target_id, community_id, reporter_user_id,
           reason, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
        RETURNING {REPORT_COLUMNS}
        """,
        new_report_id(),
        payload["target_type"],
        payload["target_id"],
        community_id,
        reporter_user_id,
        payload["reason"],
        payload.get("note"),
    )
    return db.as_dict(row)


async def report_by_id(report_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {REPORT_COLUMNS} FROM reports WHERE report_id = $1", report_id
    )
    return db.as_dict(row)


async def list_reports(
    *,
    community_id: Optional[str] = None,
    status: str = "open",
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Managers see their own community's queue; staff see everything.

    Rows come back with the reporter's identity attached. Reviewing a report
    without knowing who filed it — and, from `report_detail`, what they were
    looking at — means deciding from a reason code alone.
    """
    where = ["r.status = $1"]
    args: list[Any] = [status]
    if community_id:
        args.append(community_id)
        where.append(f"r.community_id = ${len(args)}")

    args.extend([limit, offset])
    rows = await db.fetch(
        f"""
        SELECT {_prefixed(REPORT_COLUMNS, 'r')},
               u.name  AS reporter_name,
               u.email AS reporter_email,
               c.name  AS community_name
          FROM reports r
          LEFT JOIN users u ON u.user_id = r.reporter_user_id
          LEFT JOIN communities c ON c.community_id = r.community_id
         WHERE {' AND '.join(where)}
         ORDER BY {_QUEUE_ORDER}
         LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return db.as_dicts(rows)


async def report_detail(report_id: str) -> Optional[dict]:
    """One report, plus the reported content and the author's standing.

    The three joins below are `LEFT` on purpose: a report outlives the thing it
    points at, and a queue that drops rows once content is deleted would hide
    exactly the cases a moderator most needs to see.
    """
    row = await db.fetchrow(
        f"""
        SELECT {_prefixed(REPORT_COLUMNS, 'r')},
               u.name  AS reporter_name,
               u.email AS reporter_email,
               c.name  AS community_name,
               cp.body          AS post_body,
               cp.created_at    AS post_created_at,
               cp.author_user_id AS post_author_id,
               cm.body          AS comment_body,
               cm.created_at    AS comment_created_at,
               cm.author_user_id AS comment_author_id
          FROM reports r
          LEFT JOIN users u ON u.user_id = r.reporter_user_id
          LEFT JOIN communities c ON c.community_id = r.community_id
          LEFT JOIN community_posts cp
            ON r.target_type = 'community_post' AND cp.community_post_id = r.target_id
          LEFT JOIN comments cm
            ON r.target_type = 'comment' AND cm.comment_id = r.target_id
         WHERE r.report_id = $1
        """,
        report_id,
    )
    report = db.as_dict(row)
    if not report:
        return None

    author_id = report.pop("post_author_id", None) or report.pop(
        "comment_author_id", None
    )
    report["content"] = {
        "body": report.pop("post_body", None) or report.pop("comment_body", None),
        "created_at": report.pop("post_created_at", None)
        or report.pop("comment_created_at", None),
        "author_user_id": author_id,
    }
    report["author"] = await _author_standing(author_id) if author_id else None
    return report


async def _author_standing(user_id: str) -> dict:
    """The three counts the queue shows: who they are, and their history."""
    row = await db.fetchrow(
        """
        SELECT u.name, u.email, u.created_at,
               (SELECT COUNT(*) FROM reports rr
                 WHERE rr.status = 'actioned'
                   AND rr.target_id IN (
                     SELECT community_post_id FROM community_posts
                      WHERE author_user_id = u.user_id
                      UNION ALL
                     SELECT comment_id FROM comments WHERE author_user_id = u.user_id
                   )) AS prior_actioned,
               (SELECT COUNT(*) FROM community_members m
                 WHERE m.user_id = u.user_id AND m.status = 'active') AS communities,
               (SELECT COUNT(*) FROM community_members m
                 WHERE m.user_id = u.user_id AND m.muted_until IS NOT NULL) AS times_muted
          FROM users u
         WHERE u.user_id = $1
        """,
        user_id,
    )
    return db.as_dict(row) or {}


async def resolve_report(
    report_id: str,
    handler_id: str,
    status: str,
    *,
    resolution: Optional[str] = None,
    note: Optional[str] = None,
) -> Optional[dict]:
    row = await db.fetchrow(
        f"""
        UPDATE reports
           SET status = $3, handled_by = $2, handled_at = NOW(),
               resolution = $4, resolution_note = $5
         WHERE report_id = $1 AND status = 'open'
        RETURNING {REPORT_COLUMNS}
        """,
        report_id,
        handler_id,
        status,
        resolution,
        note,
    )
    return db.as_dict(row)


def _prefixed(columns: str, alias: str) -> str:
    """Qualifies a bare column list for use in a join."""
    names = [c.strip() for c in columns.replace("\n", " ").split(",") if c.strip()]
    return ", ".join(f"{alias}.{name}" for name in names)


# ---------- blocks ----------
async def add_block(blocker_user_id: str, blocked_user_id: str) -> None:
    await db.execute(
        "INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2) "
        "ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING",
        blocker_user_id,
        blocked_user_id,
    )


async def remove_block(blocker_user_id: str, blocked_user_id: str) -> bool:
    status = await db.execute(
        "DELETE FROM blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2",
        blocker_user_id,
        blocked_user_id,
    )
    return db.rows_affected(status) > 0


async def blocked_user_ids(user_id: str) -> list[str]:
    rows = await db.fetch(
        "SELECT blocked_user_id FROM blocks WHERE blocker_user_id = $1", user_id
    )
    return [r["blocked_user_id"] for r in rows]


async def is_blocked_either_way(user_a: str, user_b: str) -> bool:
    """Blocking is symmetric in effect: neither party should see the other."""
    found = await db.fetchval(
        "SELECT 1 FROM blocks "
        "WHERE (blocker_user_id = $1 AND blocked_user_id = $2) "
        "   OR (blocker_user_id = $2 AND blocked_user_id = $1)",
        user_a,
        user_b,
    )
    return bool(found)
