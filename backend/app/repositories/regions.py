"""Regions.

Region was previously a hardcoded 'Houston' default on creators.city. It is now
the scope that communities, creators and events hang off, and the thing that
makes multi-city possible.
"""

import uuid
from typing import Optional

from app import db

REGION_COLUMNS = """
  region_id, slug, name, state, country, timezone,
  center_lat, center_lng, is_active
"""


def new_region_id() -> str:
    return f"reg_{uuid.uuid4().hex[:8]}"


async def list_regions(*, active_only: bool = True) -> list[dict]:
    where = "deleted_at IS NULL" + (" AND is_active" if active_only else "")
    rows = await db.fetch(
        f"SELECT {REGION_COLUMNS} FROM regions WHERE {where} ORDER BY name"
    )
    return db.as_dicts(rows)


async def by_id(region_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {REGION_COLUMNS} FROM regions "
        "WHERE region_id = $1 AND deleted_at IS NULL",
        region_id,
    )
    return db.as_dict(row)


async def by_slug(slug: str) -> Optional[dict]:
    row = await db.fetchrow(
        f"SELECT {REGION_COLUMNS} FROM regions "
        "WHERE LOWER(slug) = LOWER($1) AND deleted_at IS NULL",
        slug,
    )
    return db.as_dict(row)


async def exists(region_id: str) -> bool:
    """Cheap existence check for the no-foreign-keys validation callers must do."""
    found = await db.fetchval(
        "SELECT 1 FROM regions WHERE region_id = $1 AND deleted_at IS NULL AND is_active",
        region_id,
    )
    return bool(found)


async def insert(payload: dict) -> dict:
    row = await db.fetchrow(
        f"""
        INSERT INTO regions
          (region_id, slug, name, state, country, timezone, center_lat, center_lng)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING {REGION_COLUMNS}
        """,
        payload.get("region_id") or new_region_id(),
        payload["slug"],
        payload["name"],
        payload.get("state"),
        payload.get("country", "US"),
        payload.get("timezone", "UTC"),
        payload.get("center_lat"),
        payload.get("center_lng"),
    )
    return dict(row)
