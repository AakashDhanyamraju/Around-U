"""Public read endpoints. No auth required — the app browses as a guest."""

from tests.conftest import SEED_CREATOR_COUNT, SEED_CREATOR_IDS, SEED_POST_COUNT


class TestHealth:
    def test_health_reports_dependencies(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["database"] == "ok"
        # Cache/email/uploads are optional, so only their presence is asserted.
        for key in ("cache", "email", "uploads"):
            assert key in body

    def test_root(self, client):
        assert client.get("/api/").json() == {"message": "Around You API"}


class TestPosts:
    def test_list_posts(self, client):
        r = client.get("/api/posts")
        assert r.status_code == 200
        posts = r.json()
        assert len(posts) == SEED_POST_COUNT

        post = posts[0]
        for key in ("post_id", "creator_id", "image", "caption", "category",
                    "neighborhood", "likes", "created_at", "creator"):
            assert key in post, f"missing {key}"
        # Mongo's internal id must not appear now that Postgres backs this.
        assert "_id" not in post

    def test_posts_are_newest_first(self, client):
        dates = [p["created_at"] for p in client.get("/api/posts").json()]
        assert dates == sorted(dates, reverse=True)

    def test_nested_creator_is_hydrated(self, client):
        post = client.get("/api/posts").json()[0]
        assert post["creator"]["creator_id"] == post["creator_id"]
        assert isinstance(post["creator"]["categories"], list)

    def test_array_columns_round_trip_as_lists(self, client):
        for post in client.get("/api/posts").json():
            assert isinstance(post["hashtags"], list)

    def test_category_filter(self, client):
        posts = client.get("/api/posts", params={"category": "Food"}).json()
        assert posts
        assert {p["category"] for p in posts} == {"Food"}

    def test_category_all_is_unfiltered(self, client):
        assert len(client.get("/api/posts", params={"category": "all"}).json()) == SEED_POST_COUNT

    def test_limit_is_respected(self, client):
        assert len(client.get("/api/posts", params={"limit": 5}).json()) == 5

    def test_limit_is_validated(self, client):
        assert client.get("/api/posts", params={"limit": 0}).status_code == 422
        assert client.get("/api/posts", params={"limit": 9999}).status_code == 422

    def test_post_detail(self, client):
        r = client.get("/api/posts/po_seed_000")
        assert r.status_code == 200
        body = r.json()
        assert body["post"]["post_id"] == "po_seed_000"
        assert body["creator"]["creator_id"] == body["post"]["creator_id"]
        assert all(p["category"] == body["post"]["category"] for p in body["related"])
        assert all(p["post_id"] != "po_seed_000" for p in body["related"])

    def test_unknown_post_404(self, client):
        assert client.get("/api/posts/po_does_not_exist").status_code == 404


class TestCreators:
    def test_list_creators(self, client):
        creators = client.get("/api/creators").json()
        assert len(creators) == SEED_CREATOR_COUNT
        assert {c["creator_id"] for c in creators} == SEED_CREATOR_IDS

    def test_creators_sorted_by_followers(self, client):
        followers = [c["followers"] for c in client.get("/api/creators").json()]
        assert followers == sorted(followers, reverse=True)

    def test_creator_detail_includes_posts(self, client):
        r = client.get("/api/creators/cr_morteza")
        assert r.status_code == 200
        body = r.json()
        assert body["creator"]["handle"] == "@morteza.safataj"
        assert body["posts"]
        assert {p["creator_id"] for p in body["posts"]} == {"cr_morteza"}

    def test_unknown_creator_404(self, client):
        assert client.get("/api/creators/cr_does_not_exist").status_code == 404


class TestCategories:
    def test_categories(self, client):
        cats = client.get("/api/categories").json()
        assert [c["key"] for c in cats][0] == "All"
        assert all("icon" in c for c in cats)
