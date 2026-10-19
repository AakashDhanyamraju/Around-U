"""Redis cache and login rate limiting.

Every function here degrades to a no-op when Redis is unreachable or
unconfigured. A cache outage must never take the API down, and a rate limiter
that cannot reach Redis fails *open* (allows the request) rather than locking
every user out.
"""

import json
import logging
from time import monotonic
from typing import Any, Optional

import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app.config import settings

logger = logging.getLogger(__name__)

_client: Optional[aioredis.Redis] = None
_available = False

FEED_PREFIX = "aroundyou:feed"
CREATORS_KEY = "aroundyou:creators"


async def connect() -> None:
    global _client, _available
    if not settings.redis_configured:
        logger.info("Redis not configured — cache and rate limiting disabled")
        return
    try:
        _client = aioredis.from_url(
            settings.redis_url,
            socket_connect_timeout=5,
            socket_timeout=5,
            health_check_interval=30,
        )
        await _client.ping()
        _available = True
        logger.info("Redis connected — cache enabled")
    except (RedisError, OSError) as e:
        # Not fatal: the API is fully functional without a cache.
        _available = False
        logger.warning("Redis unavailable (%s) — running without cache", e)


async def disconnect() -> None:
    global _client, _available
    if _client is not None:
        try:
            await _client.aclose()
        except (RedisError, OSError) as e:
            logger.warning("Redis close failed: %s", e)
        _client = None
    _available = False


def is_available() -> bool:
    return _available and _client is not None


# ---------- cache ----------
async def get_json(key: str) -> Optional[Any]:
    if not is_available():
        return None
    try:
        raw = await _client.get(key)
        return json.loads(raw) if raw else None
    except (RedisError, OSError, json.JSONDecodeError) as e:
        logger.warning("Cache read failed for %s: %s", key, e)
        return None


async def set_json(key: str, value: Any, ttl: Optional[int] = None) -> None:
    if not is_available():
        return
    try:
        await _client.set(
            key,
            json.dumps(value, default=str),
            ex=ttl or settings.cache_ttl_seconds,
        )
    except (RedisError, OSError, TypeError) as e:
        logger.warning("Cache write failed for %s: %s", key, e)


async def invalidate_content() -> None:
    """Called after every admin write so the feed never serves stale content."""
    if not is_available():
        return
    try:
        keys = [CREATORS_KEY]
        async for key in _client.scan_iter(match=f"{FEED_PREFIX}:*", count=200):
            keys.append(key)
        if keys:
            await _client.delete(*keys)
        logger.info("Invalidated %d cache key(s)", len(keys))
    except (RedisError, OSError) as e:
        logger.warning("Cache invalidation failed: %s", e)


def feed_key(category: Optional[str], limit: int) -> str:
    return f"{FEED_PREFIX}:{(category or 'all').lower()}:{limit}"


# ---------- spots ----------
# The ranked spot list is a regional aggregate over four event tables, so unlike
# the feed it is expensive rather than merely repeated. Five minutes of drift in
# a ranking is invisible; five minutes of a removed spot still showing is not,
# hence `invalidate_spots` alongside the TTL.
SPOTS_PREFIX = "aroundyou:spots"

# Per worker, per key. `get_json` returns None when Redis is down, which for a
# feed just means a few extra cheap queries — but for this aggregate it means an
# endpoint designed to run one query per five minutes runs one per request. This
# bounds that to one per worker per TTL. It is not a Redis substitute: entries
# are per-process and `invalidate_spots` cannot reach them, which is why the TTL
# is deliberately short.
_local: dict[str, tuple[float, Any]] = {}
_LOCAL_MAX = 256


def spots_rank_key(region_id: str, category: Optional[str]) -> str:
    return f"{SPOTS_PREFIX}:rank:{region_id}:{(category or 'all').lower()}"


async def get_spots_json(key: str) -> Optional[Any]:
    cached = await get_json(key)
    if cached is not None:
        return cached
    entry = _local.get(key)
    if entry is not None:
        expires_at, value = entry
        if expires_at > monotonic():
            return value
        _local.pop(key, None)
    return None


async def set_spots_json(key: str, value: Any, ttl: int = 300) -> None:
    await set_json(key, value, ttl=ttl)
    if len(_local) >= _LOCAL_MAX:
        # Crude, but this is a bounded scratch space, not an LRU. Dropping the
        # whole thing costs one recompute per key and cannot leak.
        _local.clear()
    _local[key] = (monotonic() + ttl, value)


async def invalidate_spots(region_id: Optional[str] = None) -> None:
    """Drop cached rankings after a write that changes what may be shown.

    Called on create, hide, unhide, quiet toggle and status change. The TTL is a
    freshness budget for ranking drift, not a licence to keep serving something a
    moderator has just removed.
    """
    match = f"{SPOTS_PREFIX}:rank:{region_id}:*" if region_id else f"{SPOTS_PREFIX}:*"
    for key in list(_local):
        if key.startswith(f"{SPOTS_PREFIX}:rank:{region_id}:" if region_id else SPOTS_PREFIX):
            _local.pop(key, None)

    if not is_available():
        return
    try:
        keys = [k async for k in _client.scan_iter(match=match, count=200)]
        if keys:
            await _client.delete(*keys)
    except (RedisError, OSError) as e:
        logger.warning("Spot cache invalidation failed: %s", e)


# ---------- rate limiting ----------
async def register_failure(bucket: str) -> int:
    """Counts one failure in a fixed window. Returns the running total."""
    if not is_available():
        return 0
    key = f"aroundyou:ratelimit:{bucket}"
    try:
        pipe = _client.pipeline()
        pipe.incr(key)
        pipe.expire(key, settings.login_attempt_window_seconds)
        count, _ = await pipe.execute()
        return int(count)
    except (RedisError, OSError) as e:
        logger.warning("Rate limit increment failed: %s", e)
        return 0


async def failure_count(bucket: str) -> int:
    if not is_available():
        return 0
    try:
        raw = await _client.get(f"aroundyou:ratelimit:{bucket}")
        return int(raw) if raw else 0
    except (RedisError, OSError, ValueError) as e:
        logger.warning("Rate limit read failed: %s", e)
        return 0


async def clear_failures(bucket: str) -> None:
    if not is_available():
        return
    try:
        await _client.delete(f"aroundyou:ratelimit:{bucket}")
    except (RedisError, OSError) as e:
        logger.warning("Rate limit clear failed: %s", e)
