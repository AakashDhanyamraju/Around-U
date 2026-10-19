"""Shared test fixtures.

These are integration tests: they run the real app against the real database in
DATABASE_URL and they write to it. Point DATABASE_URL at a scratch Supabase
project (or a local Postgres) rather than production before running them.

Everything created is cleaned up, and the admin suite restores the seed baseline.
"""

import asyncio
import uuid

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import _ssl_context
from app.main import app

SEED_CREATOR_IDS = {"cr_morteza", "cr_houstonfoodie", "cr_aroundhtx", "cr_bayouwalks"}
SEED_POST_COUNT = 21
SEED_CREATOR_COUNT = 4

DEFAULT_REGION = "reg_houston"


# ---------- direct database access for test setup ----------
def _db(coro_fn):
    """Runs one statement on a throwaway connection in its own event loop.

    The app's pool belongs to the TestClient's loop, so reusing it from sync
    test code would cross loops. A separate short-lived connection sidesteps
    that entirely.
    """

    async def _run():
        conn = await asyncpg.connect(
            dsn=settings.database_url,
            ssl=_ssl_context(),
            statement_cache_size=0,
        )
        try:
            return await coro_fn(conn)
        finally:
            await conn.close()

    return asyncio.run(_run())


def db_execute(query: str, *args):
    return _db(lambda conn: conn.execute(query, *args))


def db_fetchval(query: str, *args):
    return _db(lambda conn: conn.fetchval(query, *args))


def set_platform_role(user_id: str, role: str) -> None:
    db_execute("UPDATE users SET platform_role = $2 WHERE user_id = $1", user_id, role)


def set_email_verified(user_id: str, verified: bool = True) -> None:
    db_execute(
        "UPDATE users SET email_verified = $2 WHERE user_id = $1", user_id, verified
    )


def link_creator(user_id: str, creator_id: str) -> None:
    db_execute(
        "UPDATE users SET creator_id = $2, platform_role = 'creator' "
        "WHERE user_id = $1",
        user_id,
        creator_id,
    )


def purge_users(user_ids: list[str]) -> None:
    """Hard-removes test accounts and everything hanging off them.

    Test accounts used to accumulate indefinitely — there is no account-deletion
    endpoint, so nothing cleaned them up. That was harmless until role-assignment
    tests started promoting them, at which point the database filled with
    superadmin accounts sharing one known password. Fixtures now always tear
    their accounts down.
    """
    if not user_ids:
        return

    # auth_codes is keyed by email, not user_id, so it has to be cleared while
    # the users rows are still there to resolve the addresses from.
    db_execute(
        "DELETE FROM auth_codes WHERE LOWER(email) IN "
        "(SELECT LOWER(email) FROM users WHERE user_id = ANY($1::text[]))",
        user_ids,
    )

    # Spot children first, and keyed on the SPOT rather than the user: deleting
    # someone's spots would otherwise strand visits and appreciations belonging
    # to *other* people, and the flat loop below cannot express that dependency.
    for table in (
        "spot_photos",
        "spot_visits",
        "spot_appreciations",
        "spot_confirmations",
        "spot_saves",
    ):
        db_execute(
            f"DELETE FROM {table} WHERE spot_id IN "
            "(SELECT spot_id FROM spots WHERE finder_user_id = ANY($1::text[]))",
            user_ids,
        )
    db_execute(
        "DELETE FROM notifications WHERE target_type = 'spot' AND target_id IN "
        "(SELECT spot_id FROM spots WHERE finder_user_id = ANY($1::text[]))",
        user_ids,
    )

    for table, column in (
        ("auth_identities", "user_id"),
        ("user_sessions", "user_id"),
        ("email_tokens", "user_id"),
        ("bookmarks", "user_id"),
        ("follows", "user_id"),
        ("community_members", "user_id"),
        ("reactions", "user_id"),
        ("blocks", "blocker_user_id"),
        ("blocks", "blocked_user_id"),
        ("comments", "author_user_id"),
        ("community_posts", "author_user_id"),
        ("events", "host_user_id"),
        ("communities", "created_by"),
        ("reports", "reporter_user_id"),
        ("spot_photos", "user_id"),
        ("spot_visits", "user_id"),
        ("spot_appreciations", "user_id"),
        ("spot_confirmations", "user_id"),
        ("spot_saves", "user_id"),
        ("notifications", "user_id"),
        ("notifications", "actor_user_id"),
        # Last: everything above may reference a spot this account found.
        ("spots", "finder_user_id"),
    ):
        db_execute(f"DELETE FROM {table} WHERE {column} = ANY($1::text[])", user_ids)

    db_execute(
        "DELETE FROM role_audit WHERE subject_id = ANY($1::text[]) "
        "   OR actor_id = ANY($1::text[])",
        user_ids,
    )
    db_execute("DELETE FROM users WHERE user_id = ANY($1::text[])", user_ids)


def purge_community(community_id: str) -> None:
    """Hard-removes a test community and everything hanging off it."""
    db_execute(
        "DELETE FROM comments WHERE target_id IN "
        "(SELECT community_post_id FROM community_posts WHERE community_id = $1)",
        community_id,
    )
    db_execute(
        "DELETE FROM reactions WHERE target_id IN "
        "(SELECT community_post_id FROM community_posts WHERE community_id = $1)",
        community_id,
    )
    db_execute("DELETE FROM community_posts WHERE community_id = $1", community_id)
    db_execute("DELETE FROM community_members WHERE community_id = $1", community_id)
    db_execute("DELETE FROM reports WHERE community_id = $1", community_id)
    db_execute("DELETE FROM communities WHERE community_id = $1", community_id)


@pytest.fixture(scope="session", autouse=True)
def sweep_test_accounts():
    """Backstop that removes every `test-*@example.com` account after the run.

    Per-fixture teardown covers accounts created through `registered_user` and
    `make_user`, but several tests call `/api/auth/register` directly and would
    otherwise leak. Accounts accumulating here is how the live database ended up
    with dozens of superadmins sharing one hardcoded password, so the sweep is
    unconditional rather than opt-in.
    """
    yield
    ids = _db(
        lambda conn: conn.fetch(
            "SELECT user_id FROM users WHERE email LIKE 'test-%@example.com'"
        )
    )
    purge_users([r["user_id"] for r in ids])
    # Codes are requested before any account exists, so an address that never
    # completed sign-in leaves rows behind with no user to key off.
    db_execute("DELETE FROM auth_codes WHERE email LIKE 'test-%@example.com'")


@pytest.fixture(scope="session")
def client():
    # The context manager runs startup/shutdown, which opens the DB pool.
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def admin_headers():
    if not settings.admin_api_key:
        pytest.skip("ADMIN_API_KEY is not set")
    return {"X-Admin-Secret": settings.admin_api_key}


@pytest.fixture
def new_email():
    return lambda: f"test-{uuid.uuid4().hex[:10]}@example.com"


def request_code(client, email: str, name: str | None = None) -> str:
    """Asks for a one-time code and returns it.

    Outside production the endpoint echoes the code back as `dev_code`, which is
    what makes the real sign-in path testable without a mailbox — the code is
    stored hashed, so it cannot be read back out of the database.
    """
    r = client.post(
        "/api/auth/otp/request", json={"email": email, "name": name}
    )
    assert r.status_code == 200, r.text
    code = r.json().get("dev_code")
    assert code, "dev_code missing — is ENVIRONMENT set to production?"
    return code


def sign_in(client, email: str, name: str | None = None) -> dict:
    """Full passwordless sign-in, creating the account on first use.

    There is no separate registration step any more: verifying a code creates the
    account if it does not exist, already email-verified.
    """
    code = request_code(client, email, name)
    r = client.post(
        "/api/auth/otp/verify",
        json={"email": email, "code": code, "name": name},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {
        "email": email,
        "user_id": body["user"]["user_id"],
        "token": body["session_token"],
        "created": body.get("created", False),
        "headers": {"Authorization": f"Bearer {body['session_token']}"},
    }


# Kept under the old name so the many call sites elsewhere keep reading naturally.
def _register(client, email: str, name: str = "Test User") -> dict:
    return sign_in(client, email, name)


@pytest.fixture
def registered_user(client, new_email):
    """Registers a throwaway user and removes it afterwards."""
    user = _register(client, new_email())
    yield user
    purge_users([user["user_id"]])


@pytest.fixture
def make_user(client, new_email):
    """Factory for extra accounts — membership tests need several at once.

    Every account it hands out is torn down at the end of the test, including any
    elevated role it was given along the way.

    Accounts arrive **already verified**: entering a one-time code proves ownership
    of the address, so passwordless sign-in cannot produce an unverified account.
    Pass `verified=False` to force the flag off — the only way to exercise
    `require_verified`, since no real sign-in path yields that state.
    """
    created: list[str] = []

    def _make(name: str = "Test User", *, verified: bool = True) -> dict:
        user = _register(client, new_email(), name)
        created.append(user["user_id"])
        if not verified:
            set_email_verified(user["user_id"], False)
        return user

    yield _make

    purge_users(created)


@pytest.fixture
def verified_user(make_user):
    return make_user("Verified User", verified=True)


# ---------- time travel ----------
# Half the spots spec is time-windowed — a 60-second attribution delay, a 7-day
# trust gate, 30/90-day scoring windows, a Monday budget reset. None of it is
# reachable from a test that can only create rows in the present, so these push
# existing rows into the past instead.
def set_account_age(user_id: str, days: int) -> None:
    db_execute(
        "UPDATE users SET created_at = NOW() - make_interval(days => $2) "
        "WHERE user_id = $1",
        user_id,
        days,
    )


def backdate_spot(spot_id: str, seconds: int) -> None:
    """Ages a spot so visits against it clear the 60-second attribution rule."""
    db_execute(
        "UPDATE spots SET created_at = created_at - make_interval(secs => $2) "
        "WHERE spot_id = $1",
        spot_id,
        seconds,
    )


def backdate_visit(spot_id: str, user_id: str, days: int) -> None:
    db_execute(
        "UPDATE spot_visits SET created_at = created_at - make_interval(days => $3) "
        "WHERE spot_id = $1 AND user_id = $2",
        spot_id,
        user_id,
        days,
    )


def backdate_appreciation(spot_id: str, user_id: str, seconds: int) -> None:
    db_execute(
        "UPDATE spot_appreciations "
        "   SET created_at = created_at - make_interval(secs => $3) "
        " WHERE spot_id = $1 AND user_id = $2",
        spot_id,
        user_id,
        seconds,
    )


def purge_spot(spot_id: str) -> None:
    for table in (
        "spot_photos",
        "spot_visits",
        "spot_appreciations",
        "spot_confirmations",
        "spot_saves",
    ):
        db_execute(f"DELETE FROM {table} WHERE spot_id = $1", spot_id)
    db_execute(
        "DELETE FROM notifications WHERE target_type = 'spot' AND target_id = $1",
        spot_id,
    )
    db_execute("DELETE FROM reports WHERE target_type = 'spot' AND target_id = $1", spot_id)
    db_execute("DELETE FROM spots WHERE spot_id = $1", spot_id)


@pytest.fixture
def make_spot(client):
    """Creates spots and hard-deletes them (and their contents) after.

    Coordinates are jittered per spot so the 60-metre duplicate guard does not
    fire between unrelated tests sharing the seed region.
    """
    created: list[str] = []
    counter = {"n": 0}

    def _make(finder: dict, **overrides) -> dict:
        counter["n"] += 1
        payload = {
            "region_id": DEFAULT_REGION,
            "name": f"Test Spot {uuid.uuid4().hex[:8]}",
            "blurb": "created by pytest",
            "best_time": "Morning",
            "category": "Hidden Gems",
            # ~11 m apart per step, well outside the 60 m guard after a few.
            "lat": 29.7604 + counter["n"] * 0.01,
            "lng": -95.3698 + counter["n"] * 0.01,
            "confirm_duplicate": True,
        }
        payload.update(overrides)
        r = client.post("/api/spots", headers=finder["headers"], json=payload)
        assert r.status_code == 201, r.text
        spot = r.json()
        created.append(spot["spot_id"])
        return spot

    yield _make

    for spot_id in created:
        purge_spot(spot_id)


@pytest.fixture
def make_community(client):
    """Creates communities and hard-deletes them (and their contents) after."""
    created: list[str] = []

    def _make(owner: dict, **overrides) -> dict:
        payload = {
            "region_id": DEFAULT_REGION,
            "name": f"Test Community {uuid.uuid4().hex[:8]}",
            "description": "created by pytest",
            "visibility": "public",
            "join_policy": "open",
        }
        payload.update(overrides)
        r = client.post("/api/communities", headers=owner["headers"], json=payload)
        assert r.status_code == 201, r.text
        community = r.json()
        created.append(community["community_id"])
        return community

    yield _make

    for community_id in created:
        purge_community(community_id)
