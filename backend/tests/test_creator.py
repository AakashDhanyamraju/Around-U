"""Creator self-publishing and the platform-role half of RBAC.

The important assertion here is the region grant: being a creator is not enough,
you must be a creator *for that region*.
"""

import uuid

import pytest

from tests.conftest import (
    DEFAULT_REGION,
    db_execute,
    db_fetchval,
    link_creator,
    sign_in,
)

OTHER_REGION = "reg_pytest_austin"


@pytest.fixture
def creator_account(client, admin_headers, make_user):
    """A signed-in account linked to a real creator profile, granted Houston."""
    r = client.post(
        "/api/admin/creators",
        headers=admin_headers,
        json={
            "handle": f"@pytest.creator.{uuid.uuid4().hex[:6]}",
            "name": "Pytest Creator",
            "bio": "temporary",
            "avatar": "https://example.com/avatar.jpg",
            "categories": ["Food"],
        },
    )
    assert r.status_code == 201, r.text
    creator = r.json()

    user = make_user("Creator User", verified=True)
    link_creator(user["user_id"], creator["creator_id"])

    # Sign in again so the session's user row carries the new role and link.
    user["headers"] = sign_in(client, user["email"])["headers"]
    user["creator_id"] = creator["creator_id"]

    yield user

    db_execute(
        "DELETE FROM posts WHERE creator_id = $1", creator["creator_id"]
    )
    db_execute(
        "DELETE FROM creator_regions WHERE creator_id = $1", creator["creator_id"]
    )
    db_execute("DELETE FROM creators WHERE creator_id = $1", creator["creator_id"])


@pytest.fixture
def second_region():
    """A region the test creator is deliberately NOT granted."""
    db_execute(
        "INSERT INTO regions (region_id, slug, name, state, timezone) "
        "VALUES ($1, 'pytest-austin', 'Pytest Austin', 'TX', 'America/Chicago') "
        "ON CONFLICT (region_id) DO NOTHING",
        OTHER_REGION,
    )
    yield OTHER_REGION
    db_execute("DELETE FROM regions WHERE region_id = $1", OTHER_REGION)


class TestPlatformRole:
    def test_plain_user_cannot_publish(self, client, registered_user):
        r = client.post(
            "/api/creator/posts",
            headers=registered_user["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "image": "https://example.com/a.jpg",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        )
        assert r.status_code == 403

    def test_publishing_requires_auth(self, client):
        assert client.post("/api/creator/posts", json={}).status_code == 401

    def test_creator_role_without_profile_is_rejected(self, client, make_user):
        """A creator-role account with no creator_id is a provisioning mistake and
        should say so, not fail with a null further down."""
        from tests.conftest import set_platform_role

        user = make_user("Roleless", verified=True)
        set_platform_role(user["user_id"], "creator")
        headers = sign_in(client, user["email"])["headers"]

        r = client.get("/api/creator/me", headers=headers)
        assert r.status_code == 403
        assert "creator profile" in r.json()["detail"]


class TestRegionGrant:
    def test_creator_sees_their_granted_regions(self, client, creator_account):
        body = client.get("/api/creator/me", headers=creator_account["headers"]).json()
        assert body["creator"]["creator_id"] == creator_account["creator_id"]
        assert DEFAULT_REGION in {r["region_id"] for r in body["regions"]}

    def test_publish_into_granted_region(self, client, creator_account):
        r = client.post(
            "/api/creator/posts",
            headers=creator_account["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "image": "https://example.com/a.jpg",
                "caption": "pytest publish",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        )
        assert r.status_code == 201, r.text
        post = r.json()
        assert post["creator_id"] == creator_account["creator_id"]
        assert post["region_id"] == DEFAULT_REGION

    def test_cannot_publish_into_ungranted_region(
        self, client, creator_account, second_region
    ):
        r = client.post(
            "/api/creator/posts",
            headers=creator_account["headers"],
            json={
                "region_id": second_region,
                "image": "https://example.com/a.jpg",
                "category": "Food",
                "neighborhood": "Downtown",
            },
        )
        assert r.status_code == 403
        assert "not a creator for that region" in r.json()["detail"].lower()

    def test_creator_id_cannot_be_spoofed(self, client, creator_account):
        """creator_id is taken from the session, never the body."""
        r = client.post(
            "/api/creator/posts",
            headers=creator_account["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "creator_id": "cr_morteza",
                "image": "https://example.com/a.jpg",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        )
        assert r.status_code == 201
        assert r.json()["creator_id"] == creator_account["creator_id"]


class TestOwnership:
    def test_creator_cannot_edit_another_creators_post(self, client, creator_account):
        r = client.patch(
            "/api/creator/posts/po_seed_000",
            headers=creator_account["headers"],
            json={"caption": "hijacked"},
        )
        assert r.status_code == 403

        # And the seed post is untouched.
        caption = db_fetchval(
            "SELECT caption FROM posts WHERE post_id = 'po_seed_000'"
        )
        assert caption != "hijacked"

    def test_creator_can_edit_own_post(self, client, creator_account):
        post = client.post(
            "/api/creator/posts",
            headers=creator_account["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "image": "https://example.com/a.jpg",
                "caption": "before",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        ).json()

        r = client.patch(
            f"/api/creator/posts/{post['post_id']}",
            headers=creator_account["headers"],
            json={"caption": "after"},
        )
        assert r.status_code == 200
        assert r.json()["caption"] == "after"

    def test_creator_cannot_mark_own_post_sponsored(self, client, creator_account):
        """Sponsorship is a commercial flag, not a creator-editable field."""
        post = client.post(
            "/api/creator/posts",
            headers=creator_account["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "image": "https://example.com/a.jpg",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        ).json()

        client.patch(
            f"/api/creator/posts/{post['post_id']}",
            headers=creator_account["headers"],
            json={"caption": "x", "is_sponsored": True},
        )
        assert db_fetchval(
            "SELECT is_sponsored FROM posts WHERE post_id = $1", post["post_id"]
        ) is False
