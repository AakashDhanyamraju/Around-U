"""Admin write endpoints and the X-Admin-Secret contract.

TestAdminAuth is the canonical reference for that contract: every new admin
route must be registered under require_admin and gain a case here.
"""

import pytest

from tests.conftest import SEED_CREATOR_COUNT, SEED_POST_COUNT

ADMIN_ROUTES = [
    ("get", "/api/admin/stats"),
    ("post", "/api/admin/creators"),
    ("post", "/api/admin/posts"),
    ("patch", "/api/admin/posts/po_seed_000"),
    ("patch", "/api/admin/creators/cr_morteza"),
    ("delete", "/api/admin/posts/po_nonexistent"),
    ("delete", "/api/admin/creators/cr_nonexistent"),
    ("post", "/api/admin/cleanup"),
]


@pytest.fixture
def temp_creator(client, admin_headers):
    """Creates a creator and removes it afterwards, whatever the test does."""
    r = client.post(
        "/api/admin/creators",
        headers=admin_headers,
        json={
            "handle": "@pytest.creator",
            "name": "Pytest Creator",
            "bio": "temporary",
            "avatar": "https://example.com/avatar.jpg",
            "categories": ["Food", "Events"],
        },
    )
    assert r.status_code == 201, r.text
    creator = r.json()
    yield creator
    client.delete(f"/api/admin/creators/{creator['creator_id']}", headers=admin_headers)


@pytest.fixture
def temp_post(client, admin_headers, temp_creator):
    r = client.post(
        "/api/admin/posts",
        headers=admin_headers,
        json={
            "creator_id": temp_creator["creator_id"],
            "image": "https://example.com/image.jpg",
            "caption": "temporary post",
            "category": "Food",
            "neighborhood": "Testville",
            "hashtags": ["pytest"],
        },
    )
    assert r.status_code == 201, r.text
    post = r.json()
    yield post
    client.delete(f"/api/admin/posts/{post['post_id']}", headers=admin_headers)


class TestAdminAuth:
    @pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
    def test_missing_secret_is_401(self, client, method, path):
        # client.request(), not client.get()/delete(), because httpx only accepts
        # a json body on the latter for methods that conventionally carry one.
        assert client.request(method, path, json={}).status_code == 401

    @pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
    def test_wrong_secret_is_401(self, client, method, path):
        r = client.request(method, path, headers={"X-Admin-Secret": "wrong"}, json={})
        assert r.status_code == 401

    def test_auth_is_checked_before_the_body(self, client):
        """A bad secret must not leak validation details about the payload."""
        r = client.post("/api/admin/posts", headers={"X-Admin-Secret": "wrong"}, json={})
        assert r.status_code == 401


class TestCreators:
    def test_create_creator(self, temp_creator):
        assert temp_creator["creator_id"].startswith("cr_")
        assert temp_creator["categories"] == ["Food", "Events"]
        assert temp_creator["city"] == "Houston"
        assert temp_creator["followers"] == 0

    def test_created_creator_is_listed(self, client, temp_creator):
        ids = {c["creator_id"] for c in client.get("/api/creators").json()}
        assert temp_creator["creator_id"] in ids

    def test_patch_creator(self, client, admin_headers, temp_creator):
        r = client.patch(
            f"/api/admin/creators/{temp_creator['creator_id']}",
            headers=admin_headers,
            json={"name": "Renamed", "categories": ["Outdoor"]},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed"
        assert r.json()["categories"] == ["Outdoor"]
        # Untouched fields survive a partial update.
        assert r.json()["handle"] == temp_creator["handle"]

    def test_patch_unknown_creator_404(self, client, admin_headers):
        r = client.patch(
            "/api/admin/creators/cr_nonexistent", headers=admin_headers, json={"name": "X"}
        )
        assert r.status_code == 404

    def test_patch_empty_body_400(self, client, admin_headers, temp_creator):
        r = client.patch(
            f"/api/admin/creators/{temp_creator['creator_id']}", headers=admin_headers, json={}
        )
        assert r.status_code == 400

    def test_deleting_a_creator_removes_their_posts(self, client, admin_headers, temp_post):
        creator_id = temp_post["creator_id"]
        r = client.delete(f"/api/admin/creators/{creator_id}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["deleted_creator"] == 1
        assert r.json()["deleted_posts"] >= 1
        # No orphaned posts left behind in the feed.
        assert client.get(f"/api/posts/{temp_post['post_id']}").status_code == 404

    def test_delete_unknown_creator_404(self, client, admin_headers):
        assert client.delete(
            "/api/admin/creators/cr_nonexistent", headers=admin_headers
        ).status_code == 404


class TestPosts:
    def test_create_post(self, temp_post):
        assert temp_post["post_id"].startswith("po_")
        assert temp_post["hashtags"] == ["pytest"]
        assert temp_post["media_type"] == "image"
        assert temp_post["is_sponsored"] is False
        assert temp_post["creator"] is not None

    def test_created_post_appears_in_feed(self, client, temp_post):
        ids = {p["post_id"] for p in client.get("/api/posts").json()}
        assert temp_post["post_id"] in ids

    def test_post_with_unknown_creator_is_rejected(self, client, admin_headers):
        """There are no FK constraints, so the app must reject orphans itself."""
        r = client.post(
            "/api/admin/posts",
            headers=admin_headers,
            json={
                "creator_id": "cr_definitely_not_real",
                "image": "https://example.com/i.jpg",
                "caption": "orphan",
                "category": "Food",
                "neighborhood": "Nowhere",
            },
        )
        assert r.status_code == 400

    def test_missing_required_fields_422(self, client, admin_headers):
        r = client.post("/api/admin/posts", headers=admin_headers, json={"caption": "no ids"})
        assert r.status_code == 422

    def test_patch_post(self, client, admin_headers, temp_post):
        r = client.patch(
            f"/api/admin/posts/{temp_post['post_id']}",
            headers=admin_headers,
            json={"caption": "edited", "is_sponsored": True, "hashtags": ["a", "b"]},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["caption"] == "edited"
        assert body["is_sponsored"] is True
        assert body["hashtags"] == ["a", "b"]
        assert body["neighborhood"] == "Testville"

    def test_patch_can_move_a_post_between_creators(self, client, admin_headers, temp_post):
        r = client.patch(
            f"/api/admin/posts/{temp_post['post_id']}",
            headers=admin_headers,
            json={"creator_id": "cr_morteza"},
        )
        assert r.status_code == 200
        assert r.json()["creator"]["creator_id"] == "cr_morteza"

    def test_patch_to_unknown_creator_400(self, client, admin_headers, temp_post):
        r = client.patch(
            f"/api/admin/posts/{temp_post['post_id']}",
            headers=admin_headers,
            json={"creator_id": "cr_nope"},
        )
        assert r.status_code == 400

    def test_patch_unknown_post_404(self, client, admin_headers):
        r = client.patch(
            "/api/admin/posts/po_nonexistent", headers=admin_headers, json={"caption": "x"}
        )
        assert r.status_code == 404

    def test_patch_empty_body_400(self, client, admin_headers, temp_post):
        r = client.patch(
            f"/api/admin/posts/{temp_post['post_id']}", headers=admin_headers, json={}
        )
        assert r.status_code == 400

    def test_delete_post(self, client, admin_headers, temp_post):
        post_id = temp_post["post_id"]
        assert client.delete(f"/api/admin/posts/{post_id}", headers=admin_headers).status_code == 200
        assert client.get(f"/api/posts/{post_id}").status_code == 404
        # Soft-deleted rows must not resurface as a second delete.
        assert client.delete(f"/api/admin/posts/{post_id}", headers=admin_headers).status_code == 404


class TestStats:
    def test_stats_shape(self, client, admin_headers):
        body = client.get("/api/admin/stats", headers=admin_headers).json()
        for key in ("total_posts", "total_creators", "video_count",
                    "sponsored_count", "by_category", "by_creator"):
            assert key in body
        assert body["by_category"][0]["count"] >= body["by_category"][-1]["count"]
        assert all("name" in row for row in body["by_creator"])

    def test_stats_count_only_live_rows(self, client, admin_headers, temp_post):
        before = client.get("/api/admin/stats", headers=admin_headers).json()["total_posts"]
        client.delete(f"/api/admin/posts/{temp_post['post_id']}", headers=admin_headers)
        after = client.get("/api/admin/stats", headers=admin_headers).json()["total_posts"]
        assert after == before - 1


class TestCleanup:
    def test_cleanup_restores_the_seed_baseline(self, client, admin_headers):
        client.post(
            "/api/admin/creators",
            headers=admin_headers,
            json={"handle": "@throwaway", "name": "Throwaway", "bio": "", "avatar": ""},
        )
        assert client.post("/api/admin/cleanup", headers=admin_headers).status_code == 200

        stats = client.get("/api/admin/stats", headers=admin_headers).json()
        assert stats["total_posts"] == SEED_POST_COUNT
        assert stats["total_creators"] == SEED_CREATOR_COUNT
