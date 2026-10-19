"""Bookmarks and follows. Every endpoint here requires a session."""

import pytest

from tests.conftest import sign_in


class TestAuthRequired:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/bookmarks"),
            ("post", "/api/bookmarks/po_seed_000"),
            ("delete", "/api/bookmarks/po_seed_000"),
            ("get", "/api/follows"),
            ("post", "/api/follows/cr_morteza"),
            ("delete", "/api/follows/cr_morteza"),
        ],
    )
    def test_requires_auth(self, client, method, path):
        assert getattr(client, method)(path).status_code == 401


class TestBookmarks:
    def test_new_user_has_no_bookmarks(self, client, registered_user):
        body = client.get("/api/bookmarks", headers=registered_user["headers"]).json()
        assert body == {"post_ids": [], "posts": []}

    def test_add_list_and_remove(self, client, registered_user):
        headers = registered_user["headers"]

        assert client.post("/api/bookmarks/po_seed_002", headers=headers).status_code == 200
        body = client.get("/api/bookmarks", headers=headers).json()
        assert body["post_ids"] == ["po_seed_002"]
        # The list is hydrated with full posts, including nested creators.
        assert body["posts"][0]["post_id"] == "po_seed_002"
        assert body["posts"][0]["creator"]

        assert client.delete("/api/bookmarks/po_seed_002", headers=headers).status_code == 200
        assert client.get("/api/bookmarks", headers=headers).json()["post_ids"] == []

    def test_adding_twice_is_idempotent(self, client, registered_user):
        headers = registered_user["headers"]
        client.post("/api/bookmarks/po_seed_004", headers=headers)
        client.post("/api/bookmarks/po_seed_004", headers=headers)
        assert client.get("/api/bookmarks", headers=headers).json()["post_ids"] == ["po_seed_004"]

    def test_removing_a_missing_bookmark_is_ok(self, client, registered_user):
        r = client.delete("/api/bookmarks/po_seed_009", headers=registered_user["headers"])
        assert r.status_code == 200

    def test_bookmarks_are_per_user(self, client, registered_user, new_email):
        client.post("/api/bookmarks/po_seed_005", headers=registered_user["headers"])

        other_headers = sign_in(client, new_email(), "Other")["headers"]

        assert client.get("/api/bookmarks", headers=other_headers).json()["post_ids"] == []


class TestFollows:
    def test_add_list_and_remove(self, client, registered_user):
        headers = registered_user["headers"]

        assert client.post("/api/follows/cr_bayouwalks", headers=headers).status_code == 200
        body = client.get("/api/follows", headers=headers).json()
        assert body["creator_ids"] == ["cr_bayouwalks"]
        assert body["creators"][0]["creator_id"] == "cr_bayouwalks"

        assert client.delete("/api/follows/cr_bayouwalks", headers=headers).status_code == 200
        assert client.get("/api/follows", headers=headers).json()["creator_ids"] == []

    def test_following_twice_is_idempotent(self, client, registered_user):
        headers = registered_user["headers"]
        client.post("/api/follows/cr_aroundhtx", headers=headers)
        client.post("/api/follows/cr_aroundhtx", headers=headers)
        assert client.get("/api/follows", headers=headers).json()["creator_ids"] == ["cr_aroundhtx"]
