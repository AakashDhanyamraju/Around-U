"""Postgres access via a single asyncpg pool, plus a file-based migration runner."""

import logging
import ssl
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Optional, Sequence

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_pool: Optional[asyncpg.Pool] = None


def _ssl_context() -> Optional[ssl.SSLContext]:
    """Supabase's pooler requires TLS but serves a certificate for a shared
    hostname, so hostname/chain verification is disabled here. Traffic is still
    encrypted."""
    if settings.db_ssl.lower() in ("disable", "false", ""):
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        command_timeout=settings.db_command_timeout,
        ssl=_ssl_context(),
        # Supabase's port 6543 is PgBouncer in transaction mode, which cannot
        # carry server-side prepared statements across pooled connections.
        # Leaving the cache on produces intermittent
        # "prepared statement _pg_N already exists" errors under concurrency.
        statement_cache_size=0,
        max_cacheable_statement_size=0,
    )
    logger.info("Postgres pool ready (max_size=%s)", settings.db_pool_max_size)
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Postgres pool closed")


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialised; call connect() first")
    return _pool


# ---------- query helpers ----------
async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    async with pool().acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchrow(query: str, *args: Any) -> Optional[asyncpg.Record]:
    async with pool().acquire() as conn:
        return await conn.fetchrow(query, *args)


async def fetchval(query: str, *args: Any) -> Any:
    async with pool().acquire() as conn:
        return await conn.fetchval(query, *args)


async def execute(query: str, *args: Any) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(query, *args)


@asynccontextmanager
async def transaction() -> AsyncIterator[asyncpg.Connection]:
    """Runs several writes atomically on one connection.

    Needed wherever a row write and a denormalised counter have to move
    together — `creators.followers` already drifts because `follows` inserts
    were never paired with an increment, and `communities.member_count` must
    not repeat that.

    The module-level fetch/execute helpers each acquire their own connection,
    so they are *not* covered by this block; use the yielded connection.
    """
    async with pool().acquire() as conn:
        async with conn.transaction():
            yield conn


def rows_affected(status: str) -> int:
    """asyncpg returns command tags like 'UPDATE 1' / 'DELETE 0'."""
    parts = status.split()
    return int(parts[-1]) if parts and parts[-1].isdigit() else 0


def as_dict(record: Optional[asyncpg.Record]) -> Optional[dict]:
    return dict(record) if record is not None else None


def as_dicts(records: Sequence[asyncpg.Record]) -> list[dict]:
    return [dict(r) for r in records]


# ---------- migrations ----------
async def run_migrations() -> None:
    """Applies every .sql file in migrations/ in filename order, exactly once.

    Each file runs inside a transaction, so a failure part-way leaves nothing
    half-applied. The scripts are written to be idempotent anyway (IF NOT
    EXISTS / CREATE OR REPLACE) so re-running them by hand is safe.
    """
    if not MIGRATIONS_DIR.exists():
        logger.warning("No migrations directory at %s", MIGRATIONS_DIR)
        return

    async with pool().acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              filename   TEXT PRIMARY KEY,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        applied = {
            r["filename"] for r in await conn.fetch("SELECT filename FROM schema_migrations")
        }

        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            logger.info("Applying migration %s", path.name)
            sql = path.read_text(encoding="utf-8")
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", path.name
                )
            logger.info("Applied migration %s", path.name)


async def cleanup_expired_auth_rows() -> None:
    await execute("SELECT cleanup_expired_auth_rows()")
