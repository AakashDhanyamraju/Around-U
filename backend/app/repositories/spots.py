"""Spots, appreciation and per-region rank.

Everything here is aggregated live from raw event tables. There is not one
denormalised counter in this module, and that is the central design decision —
see the header of `migrations/006_spots.sql` for why a counter cannot represent
a rolling window or a retroactive trust rule.

The three rules that decide what counts live in the SQL fragment constants
below rather than being repeated per query. Every place that asks "does this
visit credit the finder?" reads the same string, so a query cannot accidentally
implement two of the three exclusions.
"""

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

from app import db
from app.models import (
    APPRECIATION_BUDGET_PER_WEEK,
    DUPLICATE_NAME_SIMILARITY,
    DUPLICATE_RADIUS_M,
    name_similarity,
    normalise_spot_name,
)
from app.repositories import notifications

SPOT_COLUMNS = """
  spot_id, region_id, finder_user_id, name, name_normalised, blurb, best_time,
  category, address, lat, lng, is_quiet, quiet_unset_count, status,
  status_changed_at, hidden_at, created_at
"""

# The only three fields a finder may edit. Quiet, status and moderation each
# have their own endpoint, so none of them can arrive through a general PATCH.
_SPOT_UPDATABLE = {"name", "blurb", "best_time"}

# A visit that credits the finder. Three exclusions in one place:
#   * the finder's own taps are not discovery
#   * a visit inside the first minute is the finder testing their own button
#   * (the 90-day window is applied by the caller, since two laterals need it
#     and one does not)
_ATTRIBUTED_VISIT = """
      sv.user_id <> s.finder_user_id
  AND sv.created_at >= s.created_at + INTERVAL '60 seconds'
"""

# "Appreciations from accounts under 7 days old, or that have never recorded a
# visit, count for display but not for rank." Applied ONLY inside the score's
# appreciation lateral — the displayed count deliberately omits it, which is the
# whole point of the display/rank split.
#
# Retroactive by construction: the account turning seven days old makes the
# appreciation count, with no write happening anywhere.
_TRUSTED_APPRECIATION = """
      EXISTS (SELECT 1 FROM users au
               WHERE au.user_id = sa.user_id
                 AND au.deleted_at IS NULL
                 AND au.created_at <= NOW() - INTERVAL '7 days')
  AND EXISTS (SELECT 1 FROM spot_visits tv WHERE tv.user_id = sa.user_id)
"""

# The same trust idea applied to visits, which is what actually drives tier.
# Without it the ladder is farmable with a handful of throwaway accounts, and
# the ladder is the thing people try hardest to game.
_TRUSTED_VISITOR = """
      EXISTS (SELECT 1 FROM users vu
               WHERE vu.user_id = sv.user_id
                 AND vu.deleted_at IS NULL
                 AND vu.created_at <= NOW() - INTERVAL '7 days')
"""

# Monday 00:00 in the region's own timezone, expressed back as a UTC instant.
# `regions.timezone` carries real IANA names; date_trunc('week') is ISO, so the
# week starts on Monday exactly as the spec requires.
_WEEK_START_SQL = """
  (SELECT date_trunc('week', NOW() AT TIME ZONE r.timezone) AT TIME ZONE r.timezone
     FROM regions r WHERE r.region_id = {arg})
"""

# Whether an appreciation cost a unit of budget. Revoking inside a minute is a
# mis-tap and refunds; after that the unit is spent whether or not the
# appreciation is still live.
_BUDGET_SPENT = """
  (sa.revoked_at IS NULL
   OR sa.revoked_at - sa.created_at >= INTERVAL '60 seconds')
"""

_EARTH_M = 6_371_000.0
_LAT_DEG_M = 111_320.0

# Haversine in SQL. No PostGIS, matching how `events` already does geo. The
# bounding box is applied separately so `idx_spots_coords` stays usable — a trig
# call in the WHERE would force a sequential scan.
_DISTANCE_SQL = """
  (6371000 * 2 * ASIN(SQRT(
       POWER(SIN(RADIANS(s.lat - {lat}) / 2), 2)
     + COS(RADIANS({lat})) * COS(RADIANS(s.lat))
     * POWER(SIN(RADIANS(s.lng - {lng}) / 2), 2)
  )))
"""


def new_spot_id() -> str:
    return f"spt_{uuid.uuid4().hex[:8]}"


def new_spot_photo_id() -> str:
    return f"sph_{uuid.uuid4().hex[:8]}"


def bbox_deltas(lat: float, radius_m: float) -> tuple[float, float]:
    """Degree deltas for a radius, computed in Python so SQL sees plain numbers."""
    d_lat = radius_m / _LAT_DEG_M
    # cos goes to zero at the poles; clamp so the longitude window cannot explode.
    d_lng = radius_m / max(_LAT_DEG_M * math.cos(math.radians(lat)), 1.0)
    return d_lat, d_lng


def json_safe(value: Any) -> Any:
    """Datetimes to ISO 8601 before anything is handed to the cache.

    `cache.set_json` serialises with `json.dumps(default=str)`, and `str(datetime)`
    produces a space separator where FastAPI produces a `T`. Without this the
    cached and uncached paths return different timestamp formats for the same
    endpoint — a bug `/api/posts` already has. Do not inherit it.
    """
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    return value


# ---------- reads ----------
def _select_sql(*, distance: Optional[str] = None) -> str:
    """The spot projection, with every aggregate as its own correlated lateral.

    Laterals rather than a pre-aggregating CTE: each is an index scan restricted
    to the candidate spots the outer WHERE already picked, whereas a global
    GROUP BY would sweep every region's history and hash-join the result.
    """
    dist = f", {distance} AS distance_m" if distance else ""
    return f"""
    SELECT
      s.spot_id, s.region_id, s.finder_user_id, s.name, s.blurb, s.category,
      s.best_time, s.address, s.lat, s.lng, s.status, s.status_changed_at,
      s.is_quiet, s.quiet_unset_count, s.created_at,
      u.name AS finder_name, u.picture AS finder_picture,
      hero.url AS hero_photo_url,
      v.n  AS visits_attributed_90d,
      tv.n AS visits_attributed_total,
      a.n  AS trusted_appreciations_90d,
      ta.n AS appreciation_count,
      c.n  AS confirmations_30d,
      ph.n AS photo_count,
      -- ::double precision is not cosmetic. 0.5 is `numeric` in Postgres, so an
      -- uncast score arrives as a Decimal from the database and as the STRING
      -- "3.5" back out of Redis, and the two paths stop agreeing.
      (v.n + 0.5 * a.n + 0.25 * c.n)::double precision AS score
      {dist}
    FROM spots s
    LEFT JOIN users u
      ON u.user_id = s.finder_user_id AND u.deleted_at IS NULL
    -- The hero is the OLDEST surviving photo, derived rather than stored, so
    -- hiding one promotes the next with no write and no dangling pointer.
    LEFT JOIN LATERAL (
      SELECT sp.url FROM spot_photos sp
       WHERE sp.spot_id = s.spot_id
         AND sp.deleted_at IS NULL AND sp.hidden_at IS NULL
       ORDER BY sp.created_at LIMIT 1
    ) hero ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_visits sv
       WHERE sv.spot_id = s.spot_id
         AND sv.created_at >= NOW() - INTERVAL '90 days'
         AND {_ATTRIBUTED_VISIT}
    ) v ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_visits sv
       WHERE sv.spot_id = s.spot_id AND {_ATTRIBUTED_VISIT}
    ) tv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_appreciations sa
       WHERE sa.spot_id = s.spot_id AND sa.revoked_at IS NULL
         AND sa.created_at >= NOW() - INTERVAL '90 days'
         AND {_TRUSTED_APPRECIATION}
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_appreciations sa
       WHERE sa.spot_id = s.spot_id AND sa.revoked_at IS NULL
    ) ta ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_confirmations sc
       WHERE sc.spot_id = s.spot_id
         AND sc.confirmed_at >= NOW() - INTERVAL '30 days'
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM spot_photos sp
       WHERE sp.spot_id = s.spot_id
         AND sp.deleted_at IS NULL AND sp.hidden_at IS NULL
    ) ph ON TRUE
    """


def _clean(row: dict) -> dict:
    """Drop the internal-only columns before the row becomes a response."""
    row.pop("trusted_appreciations_90d", None)
    row.pop("quiet_unset_count", None)
    return row


async def list_spots(
    *,
    region_id: str,
    category: Optional[str] = None,
    sort: str = "rank",
    search: Optional[str] = None,
    near: Optional[tuple[float, float]] = None,
    include_quiet: bool = False,
    include_closed: bool = False,
    limit: int = 30,
    offset: int = 0,
) -> list[dict]:
    where = ["s.deleted_at IS NULL", "s.hidden_at IS NULL", "s.region_id = $1"]
    args: list[Any] = [region_id]

    if not include_quiet:
        where.append("s.is_quiet = FALSE")
    if not include_closed:
        where.append("s.status = 'active'")
    if category and category != "All":
        args.append(category)
        where.append(f"s.category = ${len(args)}")
    if search:
        args.append(f"%{normalise_spot_name(search)}%")
        where.append(f"s.name_normalised LIKE ${len(args)}")

    distance = None
    if near is not None:
        args.extend([near[0], near[1]])
        distance = _DISTANCE_SQL.format(lat=f"${len(args) - 1}", lng=f"${len(args)}")

    if sort == "near" and distance:
        order = "distance_m ASC, s.created_at DESC"
    elif sort == "new":
        order = "s.created_at DESC"
    else:
        # Ties break newest-first so a brand-new spot is not buried under a wall
        # of equally-unvisited older ones.
        order = "score DESC, s.created_at DESC"

    args.extend([limit, offset])
    rows = await db.fetch(
        f"""
        {_select_sql(distance=distance)}
        WHERE {' AND '.join(where)}
        ORDER BY {order}
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return [_clean(dict(r)) for r in rows]


async def by_id(spot_id: str, *, include_hidden: bool = False) -> Optional[dict]:
    where = ["s.spot_id = $1", "s.deleted_at IS NULL"]
    if not include_hidden:
        where.append("s.hidden_at IS NULL")
    row = await db.fetchrow(
        f"{_select_sql()} WHERE {' AND '.join(where)}", spot_id
    )
    return _clean(dict(row)) if row is not None else None


async def raw_by_id(spot_id: str) -> Optional[dict]:
    """The bare row, for permission and state checks that need no aggregates."""
    return db.as_dict(
        await db.fetchrow(
            f"SELECT {SPOT_COLUMNS} FROM spots "
            "WHERE spot_id = $1 AND deleted_at IS NULL",
            spot_id,
        )
    )


async def region_spot_count(region_id: str) -> int:
    """Rankable spots in the region — what decides cold start.

    Deliberately the *rankable* count rather than every row: five spots of which
    four are quiet does not make a ranking meaningful.
    """
    return int(
        await db.fetchval(
            """
            SELECT COUNT(*) FROM spots
             WHERE region_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL
               AND status = 'active' AND is_quiet = FALSE
            """,
            region_id,
        )
        or 0
    )


async def viewer_flags(spot_ids: list[str], user_id: str) -> dict[str, dict]:
    """Per-viewer state for a batch of spots, as a second query on purpose.

    Inlining these into the ranked query would make its payload per-user and
    destroy the cache, which is the one thing keeping the aggregate off the
    database on every request.
    """
    if not spot_ids:
        return {}
    rows = await db.fetch(
        """
        SELECT sid AS spot_id,
               EXISTS (SELECT 1 FROM spot_appreciations sa
                        WHERE sa.spot_id = sid AND sa.user_id = $2
                          AND sa.revoked_at IS NULL)              AS viewer_appreciated,
               EXISTS (SELECT 1 FROM spot_visits sv
                        WHERE sv.spot_id = sid AND sv.user_id = $2) AS viewer_visited,
               EXISTS (SELECT 1 FROM spot_saves ss
                        WHERE ss.spot_id = sid AND ss.user_id = $2) AS viewer_saved,
               EXISTS (SELECT 1 FROM spot_confirmations sc
                        WHERE sc.spot_id = sid AND sc.user_id = $2
                          AND sc.confirmed_at >= NOW() - INTERVAL '30 days')
                                                                  AS viewer_confirmed
          FROM UNNEST($1::text[]) AS sid
        """,
        spot_ids,
        user_id,
    )
    return {r["spot_id"]: dict(r) for r in rows}


async def credited_spots_for(user_ids: list[str], region_id: str) -> dict[str, int]:
    """Distinct spots each person found that somebody else actually went to.

    This is the tier number, and every clause below is load-bearing:

      * `sv.user_id <> s.finder_user_id` — your own taps are not discovery
      * the 60-second rule — a visit that fast is the finder's own script
      * `is_quiet = FALSE` — quiet spots trade rank credit for privacy
      * `_TRUSTED_VISITOR` — a fresh account's visit earns nothing until day 7
      * `hidden_at IS NULL OR sv.created_at < s.hidden_at` — this single line is
        the whole "tiers never decrease from moderation" rule. Visits predating
        the hide keep their credit, so a moderator cannot take a tier away;
        visits after it earn nothing, so a hidden spot cannot promote anyone;
        and un-hiding restores everything with no write. Monotonicity is a
        property of the query, which is why there is no watermark table.
    """
    if not user_ids:
        return {}
    rows = await db.fetch(
        f"""
        SELECT s.finder_user_id, COUNT(DISTINCT s.spot_id)::int AS n
          FROM spots s
          JOIN spot_visits sv ON sv.spot_id = s.spot_id
         WHERE s.finder_user_id = ANY($1::text[])
           AND s.region_id = $2
           AND s.deleted_at IS NULL
           AND s.is_quiet = FALSE
           AND {_ATTRIBUTED_VISIT}
           AND {_TRUSTED_VISITOR}
           AND (s.hidden_at IS NULL OR sv.created_at < s.hidden_at)
         GROUP BY s.finder_user_id
        """,
        user_ids,
        region_id,
    )
    return {r["finder_user_id"]: r["n"] for r in rows}


async def rank_totals(user_id: str, region_id: str) -> dict:
    """The three headline numbers on the rank screen, in one round trip."""
    row = await db.fetchrow(
        f"""
        SELECT
          (SELECT COUNT(*)::int FROM spots s
            WHERE s.finder_user_id = $1 AND s.region_id = $2
              AND s.deleted_at IS NULL) AS spots_found,
          (SELECT COUNT(*)::int FROM spots s
             JOIN spot_visits sv ON sv.spot_id = s.spot_id
            WHERE s.finder_user_id = $1 AND s.region_id = $2
              AND s.deleted_at IS NULL AND s.hidden_at IS NULL
              AND {_ATTRIBUTED_VISIT}) AS people_sent,
          (SELECT COUNT(*)::int FROM spots s
             JOIN spot_appreciations sa ON sa.spot_id = s.spot_id
            WHERE s.finder_user_id = $1 AND s.region_id = $2
              AND s.deleted_at IS NULL AND s.hidden_at IS NULL
              AND sa.revoked_at IS NULL) AS appreciations_received
        """,
        user_id,
        region_id,
    )
    return dict(row) if row else {
        "spots_found": 0,
        "people_sent": 0,
        "appreciations_received": 0,
    }


async def find_duplicates(
    region_id: str, lat: float, lng: float, name: str
) -> list[dict]:
    """Spots within 60 m whose name is at least 0.6 similar.

    Distance in SQL, similarity in Python. `pg_trgm` is available on the server
    but not installed, and `run_migrations()` does not catch exceptions — a
    `CREATE EXTENSION` that the role cannot execute would propagate through the
    lifespan and the API would never start. There is no performance case for it
    either: the bounding box returns a handful of rows.

    Quiet and closed spots are candidates on purpose. Offering "add your photo
    to that one instead" for a quiet spot is exactly right.
    """
    d_lat, d_lng = bbox_deltas(lat, DUPLICATE_RADIUS_M)
    rows = await db.fetch(
        f"""
        SELECT c.* FROM (
          SELECT s.spot_id, s.name, s.name_normalised, s.finder_user_id,
                 {_DISTANCE_SQL.format(lat='$2', lng='$3')} AS distance_m
            FROM spots s
           WHERE s.region_id = $1
             AND s.deleted_at IS NULL
             AND s.hidden_at IS NULL
             AND s.lat BETWEEN $2 - $4 AND $2 + $4
             AND s.lng BETWEEN $3 - $5 AND $3 + $5
        ) c
        WHERE c.distance_m <= $6
        ORDER BY c.distance_m
        LIMIT 20
        """,
        region_id,
        lat,
        lng,
        d_lat,
        d_lng,
        DUPLICATE_RADIUS_M,
    )

    target = normalise_spot_name(name)
    out: list[dict] = []
    for r in rows:
        similarity = name_similarity(target, r["name_normalised"])
        if similarity >= DUPLICATE_NAME_SIMILARITY:
            out.append(
                {
                    "spot_id": r["spot_id"],
                    "name": r["name"],
                    "distance_m": round(float(r["distance_m"]), 1),
                    "similarity": round(similarity, 2),
                    "finder_user_id": r["finder_user_id"],
                }
            )
    return out


# ---------- writes ----------
async def create(finder_user_id: str, payload: dict) -> dict:
    """Insert the spot and any photos it arrived with, atomically.

    One transaction so a spot never exists with half its photos — the create
    screen shows them together, and a partial write would look like data loss.
    """
    spot_id = payload.get("spot_id") or new_spot_id()
    photos = list(payload.get("photos") or [])

    async with db.transaction() as conn:
        await conn.execute(
            """
            INSERT INTO spots
              (spot_id, region_id, finder_user_id, name, name_normalised, blurb,
               best_time, category, address, lat, lng, is_quiet)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            """,
            spot_id,
            payload["region_id"],
            finder_user_id,
            payload["name"],
            normalise_spot_name(payload["name"]),
            payload.get("blurb", ""),
            payload.get("best_time"),
            payload.get("category"),
            payload.get("address"),
            payload["lat"],
            payload["lng"],
            bool(payload.get("is_quiet", False)),
        )
        for url in photos:
            await conn.execute(
                "INSERT INTO spot_photos (spot_photo_id, spot_id, user_id, url) "
                "VALUES ($1, $2, $3, $4)",
                new_spot_photo_id(),
                spot_id,
                finder_user_id,
                url,
            )

    spot = await by_id(spot_id)
    if spot is None:  # pragma: no cover - the row was just written
        raise RuntimeError("Spot vanished immediately after insert")
    return spot


async def update(spot_id: str, updates: dict[str, Any]) -> Optional[dict]:
    fields = {k: v for k, v in updates.items() if k in _SPOT_UPDATABLE}
    if not fields:
        return await by_id(spot_id)

    assignments, args = [], []
    for i, (column, value) in enumerate(fields.items(), start=2):
        assignments.append(f"{column} = ${i}")
        args.append(value)
    # Renaming has to move the canonical form with it, or the duplicate guard
    # and name search keep matching the old name forever.
    if "name" in fields:
        args.append(normalise_spot_name(fields["name"]))
        assignments.append(f"name_normalised = ${len(args) + 1}")

    status = await db.execute(
        f"UPDATE spots SET {', '.join(assignments)} "
        "WHERE spot_id = $1 AND deleted_at IS NULL",
        spot_id,
        *args,
    )
    if db.rows_affected(status) == 0:
        return None
    return await by_id(spot_id)


async def set_status(spot_id: str, status_value: str, actor_user_id: str) -> bool:
    status = await db.execute(
        "UPDATE spots SET status = $2, status_changed_at = NOW(), "
        "status_changed_by = $3 WHERE spot_id = $1 AND deleted_at IS NULL",
        spot_id,
        status_value,
        actor_user_id,
    )
    return db.rows_affected(status) > 0


async def set_quiet(spot_id: str, is_quiet: bool) -> bool:
    """Toggle quiet. Turning it OFF is allowed once, ever.

    The guard is in the WHERE rather than a read-then-write, so two concurrent
    requests cannot both see `quiet_unset_count = 0` and both succeed. Zero rows
    affected is the caller's signal to return 409.
    """
    if is_quiet:
        status = await db.execute(
            "UPDATE spots SET is_quiet = TRUE "
            "WHERE spot_id = $1 AND deleted_at IS NULL AND is_quiet = FALSE",
            spot_id,
        )
    else:
        status = await db.execute(
            "UPDATE spots SET is_quiet = FALSE, "
            "                 quiet_unset_count = quiet_unset_count + 1 "
            "WHERE spot_id = $1 AND deleted_at IS NULL "
            "  AND is_quiet = TRUE AND quiet_unset_count = 0",
            spot_id,
        )
    return db.rows_affected(status) > 0


async def set_hidden(
    spot_id: str, hidden: bool, actor_user_id: str, reason: Optional[str] = None
) -> bool:
    if hidden:
        status = await db.execute(
            "UPDATE spots SET hidden_at = NOW(), hidden_by = $2, hidden_reason = $3 "
            "WHERE spot_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL",
            spot_id,
            actor_user_id,
            reason,
        )
    else:
        status = await db.execute(
            "UPDATE spots SET hidden_at = NULL, hidden_by = NULL, "
            "                 hidden_reason = NULL "
            "WHERE spot_id = $1 AND deleted_at IS NULL AND hidden_at IS NOT NULL",
            spot_id,
        )
    return db.rows_affected(status) > 0


async def created_since(user_id: str, hours: int = 24) -> int:
    """Spots this account created in a rolling window.

    No `deleted_at IS NULL` filter, deliberately: if deleted rows stopped
    counting, delete-and-recreate would be an unlimited daily quota.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM spots "
            "WHERE finder_user_id = $1 AND created_at >= $2",
            user_id,
            since,
        )
        or 0
    )


async def photos_since(user_id: str, hours: int = 24) -> int:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM spot_photos "
            "WHERE user_id = $1 AND created_at >= $2",
            user_id,
            since,
        )
        or 0
    )


# ---------- photos ----------
async def list_photos(spot_id: str, limit: int = 50) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT sp.spot_photo_id, sp.spot_id, sp.user_id, sp.url, sp.caption,
               sp.width, sp.height, sp.created_at,
               u.name AS author_name, u.picture AS author_picture
          FROM spot_photos sp
          LEFT JOIN users u ON u.user_id = sp.user_id AND u.deleted_at IS NULL
         WHERE sp.spot_id = $1 AND sp.deleted_at IS NULL AND sp.hidden_at IS NULL
         ORDER BY sp.created_at
         LIMIT $2
        """,
        spot_id,
        limit,
    )
    return db.as_dicts(rows)


async def add_photo(spot_id: str, user_id: str, payload: dict) -> dict:
    photo_id = new_spot_photo_id()
    await db.execute(
        "INSERT INTO spot_photos "
        "  (spot_photo_id, spot_id, user_id, url, caption, width, height) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        photo_id,
        spot_id,
        user_id,
        payload["url"],
        payload.get("caption", ""),
        payload.get("width"),
        payload.get("height"),
    )
    row = await db.fetchrow(
        """
        SELECT sp.spot_photo_id, sp.spot_id, sp.user_id, sp.url, sp.caption,
               sp.width, sp.height, sp.created_at,
               u.name AS author_name, u.picture AS author_picture
          FROM spot_photos sp
          LEFT JOIN users u ON u.user_id = sp.user_id
         WHERE sp.spot_photo_id = $1
        """,
        photo_id,
    )
    return dict(row)


async def photo_by_id(spot_photo_id: str) -> Optional[dict]:
    return db.as_dict(
        await db.fetchrow(
            "SELECT spot_photo_id, spot_id, user_id, url, hidden_at "
            "FROM spot_photos WHERE spot_photo_id = $1 AND deleted_at IS NULL",
            spot_photo_id,
        )
    )


async def delete_photo(spot_photo_id: str) -> bool:
    status = await db.execute(
        "UPDATE spot_photos SET deleted_at = NOW() "
        "WHERE spot_photo_id = $1 AND deleted_at IS NULL",
        spot_photo_id,
    )
    return db.rows_affected(status) > 0


async def hide_photo(spot_photo_id: str, actor_user_id: str) -> bool:
    status = await db.execute(
        "UPDATE spot_photos SET hidden_at = NOW(), hidden_by = $2 "
        "WHERE spot_photo_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL",
        spot_photo_id,
        actor_user_id,
    )
    return db.rows_affected(status) > 0


# ---------- visits, confirmations, saves ----------
async def add_visit(spot: dict, user_id: str, actor_name: str) -> int:
    """Record "I went", and tell the finder — once per spot per day.

    `(xmax = 0) AS inserted` distinguishes a genuinely new row from a repeat tap,
    the same trick `communities.join` uses, so a second tap does not re-notify.
    """
    async with db.transaction() as conn:
        row = await conn.fetchrow(
            "INSERT INTO spot_visits (spot_id, user_id) VALUES ($1, $2) "
            "ON CONFLICT (spot_id, user_id) DO NOTHING "
            "RETURNING (xmax = 0) AS inserted",
            spot["spot_id"],
            user_id,
        )
        if row is not None and row["inserted"]:
            await notifications.push_visit(
                conn,
                user_id=spot["finder_user_id"],
                actor_user_id=user_id,
                region_id=spot["region_id"],
                spot_id=spot["spot_id"],
                spot_name=spot["name"],
                actor_name=actor_name,
            )
    return await attributed_visits(spot["spot_id"])


async def remove_visit(spot_id: str, user_id: str) -> int:
    await db.execute(
        "DELETE FROM spot_visits WHERE spot_id = $1 AND user_id = $2",
        spot_id,
        user_id,
    )
    return await attributed_visits(spot_id)


async def attributed_visits(spot_id: str) -> int:
    return int(
        await db.fetchval(
            f"""
            SELECT COUNT(*) FROM spot_visits sv
              JOIN spots s ON s.spot_id = sv.spot_id
             WHERE sv.spot_id = $1 AND {_ATTRIBUTED_VISIT}
            """,
            spot_id,
        )
        or 0
    )


async def confirm(spot_id: str, user_id: str) -> int:
    """"Still good." One row per person, with the timestamp refreshed.

    Not an append-only log: that would let a single account confirm daily and
    contribute 30 x 0.25 = 7.5 to a spot's score in a month.
    """
    await db.execute(
        "INSERT INTO spot_confirmations (spot_id, user_id) VALUES ($1, $2) "
        "ON CONFLICT (spot_id, user_id) DO UPDATE SET confirmed_at = NOW()",
        spot_id,
        user_id,
    )
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM spot_confirmations "
            "WHERE spot_id = $1 AND confirmed_at >= NOW() - INTERVAL '30 days'",
            spot_id,
        )
        or 0
    )


async def set_saved(spot_id: str, user_id: str, saved: bool) -> None:
    if saved:
        await db.execute(
            "INSERT INTO spot_saves (spot_id, user_id) VALUES ($1, $2) "
            "ON CONFLICT (spot_id, user_id) DO NOTHING",
            spot_id,
            user_id,
        )
    else:
        await db.execute(
            "DELETE FROM spot_saves WHERE spot_id = $1 AND user_id = $2",
            spot_id,
            user_id,
        )


async def saved_spot_ids(user_id: str, limit: int = 200) -> list[str]:
    rows = await db.fetch(
        "SELECT spot_id FROM spot_saves WHERE user_id = $1 "
        "ORDER BY created_at DESC LIMIT $2",
        user_id,
        limit,
    )
    return [r["spot_id"] for r in rows]


async def spots_by_ids(spot_ids: list[str]) -> list[dict]:
    """Full spot rows for an arbitrary id list, preserving the caller's order."""
    if not spot_ids:
        return []
    rows = await db.fetch(
        f"{_select_sql()} WHERE s.spot_id = ANY($1::text[]) "
        "AND s.deleted_at IS NULL AND s.hidden_at IS NULL",
        spot_ids,
    )
    by_key = {r["spot_id"]: _clean(dict(r)) for r in rows}
    return [by_key[sid] for sid in spot_ids if sid in by_key]


async def spots_for_finder(user_id: str, limit: int, offset: int) -> list[dict]:
    """Spots I found — including quiet, closed and hidden ones, which are mine."""
    rows = await db.fetch(
        f"""
        {_select_sql()}
        WHERE s.finder_user_id = $1 AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        user_id,
        limit,
        offset,
    )
    return [_clean(dict(r)) for r in rows]


async def spots_visited_by(user_id: str, limit: int, offset: int) -> list[dict]:
    rows = await db.fetch(
        f"""
        {_select_sql()}
        JOIN spot_visits mv ON mv.spot_id = s.spot_id AND mv.user_id = $1
        WHERE s.deleted_at IS NULL AND s.hidden_at IS NULL
        ORDER BY mv.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        user_id,
        limit,
        offset,
    )
    return [_clean(dict(r)) for r in rows]


# ---------- appreciation ----------
async def _week_bounds(conn: asyncpg.Connection, region_id: str) -> tuple:
    row = await conn.fetchrow(
        """
        SELECT date_trunc('week', NOW() AT TIME ZONE r.timezone)
                 AT TIME ZONE r.timezone AS week_start,
               (date_trunc('week', NOW() AT TIME ZONE r.timezone) + INTERVAL '7 days')
                 AT TIME ZONE r.timezone AS resets_at
          FROM regions r WHERE r.region_id = $1
        """,
        region_id,
    )
    return (row["week_start"], row["resets_at"]) if row else (None, None)


async def _spent_this_week(
    conn: asyncpg.Connection, user_id: str, region_id: str
) -> int:
    return int(
        await conn.fetchval(
            f"""
            SELECT COUNT(*) FROM spot_appreciations sa
             WHERE sa.user_id = $1 AND sa.region_id = $2
               AND sa.created_at >= (
                     SELECT date_trunc('week', NOW() AT TIME ZONE r.timezone)
                              AT TIME ZONE r.timezone
                       FROM regions r WHERE r.region_id = $2)
               AND {_BUDGET_SPENT}
            """,
            user_id,
            region_id,
        )
        or 0
    )


async def _budget(conn: asyncpg.Connection, user_id: str, region_id: str) -> dict:
    used = await _spent_this_week(conn, user_id, region_id)
    week_start, resets_at = await _week_bounds(conn, region_id)
    return {
        "limit": APPRECIATION_BUDGET_PER_WEEK,
        "used": used,
        "remaining": max(APPRECIATION_BUDGET_PER_WEEK - used, 0),
        "region_id": region_id,
        "week_start": week_start,
        "resets_at": resets_at,
    }


async def budget_for(user_id: str, region_id: str) -> dict:
    async with db.transaction() as conn:
        return await _budget(conn, user_id, region_id)


async def appreciate(spot: dict, user_id: str, actor_name: str) -> dict:
    """Idempotent, budgeted and race-free.

    The advisory lock is not optional. Under READ COMMITTED two concurrent
    requests both read "4 spent" and both insert, producing 6 in a week capped
    at 5. `pg_advisory_xact_lock` is transaction-scoped, so it survives
    Supabase's port-6543 pooler running PgBouncer in transaction mode — a
    session-scoped lock would be released onto the wrong connection.
    """
    region_id = spot["region_id"]
    async with db.transaction() as conn:
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            f"appr:{user_id}:{region_id}",
        )

        existing = await conn.fetchrow(
            "SELECT created_at, revoked_at FROM spot_appreciations "
            "WHERE spot_id = $1 AND user_id = $2 FOR UPDATE",
            spot["spot_id"],
            user_id,
        )

        if existing is not None and existing["revoked_at"] is None:
            # Already appreciated: charge nothing, report the budget unchanged.
            budget = await _budget(conn, user_id, region_id)
            return {"charged": False, "budget": budget}

        if existing is not None:
            spent_delta = existing["revoked_at"] - existing["created_at"]
            if spent_delta >= timedelta(seconds=60):
                # The unit was spent and never refunded, so re-appreciating is
                # free. `created_at` is left alone so the charge stays booked to
                # the week it was actually made — moving it would refund it.
                await conn.execute(
                    "UPDATE spot_appreciations SET revoked_at = NULL "
                    "WHERE spot_id = $1 AND user_id = $2",
                    spot["spot_id"],
                    user_id,
                )
                budget = await _budget(conn, user_id, region_id)
                return {"charged": False, "budget": budget}
            # Refunded earlier, so this is a genuinely new charge; fall through.

        if await _spent_this_week(conn, user_id, region_id) >= APPRECIATION_BUDGET_PER_WEEK:
            budget = await _budget(conn, user_id, region_id)
            return {"exhausted": True, "budget": budget}

        await conn.execute(
            """
            INSERT INTO spot_appreciations (spot_id, user_id, region_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (spot_id, user_id) DO UPDATE
              SET revoked_at = NULL, created_at = NOW()
            """,
            spot["spot_id"],
            user_id,
            region_id,
        )
        await notifications.push(
            conn,
            user_id=spot["finder_user_id"],
            type="spot_appreciated",
            region_id=region_id,
            actor_user_id=user_id,
            target_type="spot",
            target_id=spot["spot_id"],
            data={"spot_name": spot["name"], "actor_name": actor_name},
            dedupe_key=f"appr:{spot['spot_id']}:{user_id}",
        )
        budget = await _budget(conn, user_id, region_id)
        return {"charged": True, "budget": budget}


async def unappreciate(spot: dict, user_id: str) -> dict:
    """Revoke, refunding the unit only inside the mis-tap window.

    `RETURNING (NOW() - created_at < INTERVAL '60 seconds')` is evaluated against
    the pre-update row, so the caller learns whether the unit came back without
    a second round trip.
    """
    region_id = spot["region_id"]
    async with db.transaction() as conn:
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            f"appr:{user_id}:{region_id}",
        )
        row = await conn.fetchrow(
            "UPDATE spot_appreciations SET revoked_at = NOW() "
            "WHERE spot_id = $1 AND user_id = $2 AND revoked_at IS NULL "
            "RETURNING (NOW() - created_at < INTERVAL '60 seconds') AS refunded",
            spot["spot_id"],
            user_id,
        )
        budget = await _budget(conn, user_id, region_id)
        return {
            "removed": row is not None,
            "refunded": bool(row["refunded"]) if row is not None else False,
            "budget": budget,
        }


async def appreciation_count(spot_id: str) -> int:
    return int(
        await db.fetchval(
            "SELECT COUNT(*) FROM spot_appreciations "
            "WHERE spot_id = $1 AND revoked_at IS NULL",
            spot_id,
        )
        or 0
    )
