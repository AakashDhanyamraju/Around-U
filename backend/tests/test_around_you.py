"""Backend tests for Around You - Houston community app"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://community-houston.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_SECRET = os.environ.get("ADMIN_API_KEY", "2CqEcj2JlHDJqqEvfK4RywE2I_aaETN_")
ADMIN_HDR = {"X-Admin-Secret": ADMIN_SECRET}
SEED_CREATOR_IDS = {"cr_morteza", "cr_houstonfoodie", "cr_aroundhtx", "cr_bayouwalks"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Public posts ----------
class TestPosts:
    def test_list_posts_no_auth(self, s):
        r = s.get(f"{API}/posts", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 18
        p = data[0]
        for k in ("post_id", "creator_id", "image", "caption", "category", "creator"):
            assert k in p, f"missing {k}"
        assert "_id" not in p
        assert p["creator"] and "creator_id" in p["creator"]
        assert "_id" not in p["creator"]

    def test_list_posts_category_food(self, s):
        r = s.get(f"{API}/posts", params={"category": "Food"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(p["category"] == "Food" for p in data)

    def test_list_posts_category_all(self, s):
        r_all = s.get(f"{API}/posts", params={"category": "All"}, timeout=20)
        r_none = s.get(f"{API}/posts", timeout=20)
        assert r_all.status_code == 200
        assert len(r_all.json()) == len(r_none.json())

    def test_get_post_detail(self, s):
        listing = s.get(f"{API}/posts", timeout=20).json()
        food_post = next(p for p in listing if p["category"] == "Food")
        r = s.get(f"{API}/posts/{food_post['post_id']}", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["post"]["post_id"] == food_post["post_id"]
        assert data["creator"]["creator_id"] == food_post["creator_id"]
        assert isinstance(data["related"], list)
        assert all(p["category"] == "Food" for p in data["related"])
        assert all(p["post_id"] != food_post["post_id"] for p in data["related"])
        assert "_id" not in data["post"]
        assert "_id" not in data["creator"]

    def test_get_post_404(self, s):
        r = s.get(f"{API}/posts/does_not_exist", timeout=20)
        assert r.status_code == 404


# ---------- Categories ----------
class TestCategories:
    def test_categories(self, s):
        r = s.get(f"{API}/categories", timeout=20)
        assert r.status_code == 200
        cats = r.json()
        keys = [c["key"] for c in cats]
        for expected in ["All", "Food", "Events", "Real Estate", "Hidden Gems", "Nightlife", "Outdoor", "Culture"]:
            assert expected in keys


# ---------- Creators ----------
class TestCreators:
    def test_list_creators(self, s):
        r = s.get(f"{API}/creators", timeout=20)
        assert r.status_code == 200
        creators = r.json()
        assert len(creators) >= 4
        names = [c["name"] for c in creators]
        assert "Morteza Safataj" in names
        assert all("_id" not in c for c in creators)

    def test_get_creator_with_posts(self, s):
        r = s.get(f"{API}/creators/cr_morteza", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["creator"]["creator_id"] == "cr_morteza"
        assert data["creator"]["name"] == "Morteza Safataj"
        assert isinstance(data["posts"], list) and len(data["posts"]) > 0
        assert all(p["creator_id"] == "cr_morteza" for p in data["posts"])

    def test_get_creator_404(self, s):
        r = s.get(f"{API}/creators/no_such_creator", timeout=20)
        assert r.status_code == 404


# ---------- Admin (protected by X-Admin-Secret header) ----------
class TestAdmin:
    def test_admin_create_creator_and_post(self, s):
        payload = {
            "handle": "@test_creator",
            "name": "TEST_Creator",
            "bio": "TEST bio",
            "avatar": "https://example.com/a.jpg",
            "categories": ["Food"],
        }
        r = s.post(f"{API}/admin/creators", json=payload, headers=ADMIN_HDR, timeout=20)
        assert r.status_code == 200
        created = r.json()
        assert created["name"] == "TEST_Creator"
        assert "_id" not in created
        cid = created["creator_id"]

        # Verify via list
        listing = s.get(f"{API}/creators", timeout=20).json()
        assert any(c["creator_id"] == cid for c in listing)

        # Create a post linked to creator
        post_payload = {
            "creator_id": cid,
            "image": "https://example.com/img.jpg",
            "caption": "TEST_post caption",
            "category": "Food",
            "neighborhood": "TEST_hood",
            "location_name": "TEST_place",
            "lat": 29.76,
            "lng": -95.36,
        }
        rp = s.post(f"{API}/admin/posts", json=post_payload, headers=ADMIN_HDR, timeout=20)
        assert rp.status_code == 200
        post = rp.json()
        assert post["creator_id"] == cid
        assert post["caption"] == "TEST_post caption"
        assert "_id" not in post


# ---------- Auth protection ----------
class TestAuth:
    @pytest.mark.parametrize("path,method", [
        ("/auth/me", "GET"),
        ("/bookmarks", "GET"),
        ("/bookmarks/po_seed_000", "POST"),
        ("/bookmarks/po_seed_000", "DELETE"),
        ("/follows", "GET"),
        ("/follows/cr_morteza", "POST"),
        ("/follows/cr_morteza", "DELETE"),
    ])
    def test_protected_requires_auth(self, s, path, method):
        r = s.request(method, f"{API}{path}", timeout=20)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}"

    def test_protected_with_bad_token(self, s):
        r = s.get(f"{API}/auth/me", headers={"Authorization": "Bearer not_a_real_token"}, timeout=20)
        assert r.status_code == 401

    def test_session_invalid_token(self, s):
        r = s.post(f"{API}/auth/session", json={"session_token": "definitely_invalid_token_xyz"}, timeout=30)
        assert r.status_code == 401


# ---------- Root ----------
class TestRoot:
    def test_root(self, s):
        r = s.get(f"{API}/", timeout=20)
        assert r.status_code == 200
        assert "message" in r.json()



# ---------- Seed v3: Morteza Instagram ingest + video support ----------
class TestSeedV3Ingest:
    """Verify the seed v3 migration: 21 posts, 2 videos, new fields present."""

    def test_total_posts_is_21(self, s):
        # Ignore admin-created TEST_* posts that may have been added by other tests.
        r = s.get(f"{API}/posts", params={"limit": 200}, timeout=20)
        assert r.status_code == 200
        data = [p for p in r.json() if p["post_id"].startswith("po_seed_")]
        assert len(data) == 21, f"expected 21 seed posts, got {len(data)}"

    def test_post_has_new_fields(self, s):
        r = s.get(f"{API}/posts", params={"limit": 200}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        required = ("media_type", "hashtags", "is_sponsored", "video_url", "source", "original_url")
        for p in data:
            for k in required:
                assert k in p, f"post {p.get('post_id')} missing field {k}"
            # Type checks on new fields
            assert isinstance(p["media_type"], str)
            assert p["media_type"] in ("image", "video")
            assert isinstance(p["hashtags"], list)
            assert isinstance(p["is_sponsored"], bool)

    def test_exactly_two_video_posts(self, s):
        r = s.get(f"{API}/posts", params={"limit": 200}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        videos = [p for p in data if p.get("media_type") == "video"]
        assert len(videos) == 2, f"expected 2 video posts, got {len(videos)}"
        for v in videos:
            assert v.get("video_url"), f"{v['post_id']} has empty video_url"
        video_ids = sorted(v["post_id"] for v in videos)
        assert video_ids == ["po_seed_000", "po_seed_003"], (
            f"expected video posts po_seed_000 & po_seed_003, got {video_ids}"
        )

    def test_po_seed_000_world_cup_detail(self, s):
        r = s.get(f"{API}/posts/po_seed_000", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        post = data["post"]
        assert post["post_id"] == "po_seed_000"
        assert post["media_type"] == "video"
        assert post["video_url"], "video_url should be non-empty"
        assert post["creator_id"] == "cr_morteza"
        # Caption is the World Cup listicle
        cap = post["caption"]
        assert "FIFA Fan Festival" in cap
        assert "Houston" in cap
        # Hashtags non-empty and contains WorldCup2026
        assert isinstance(post["hashtags"], list) and len(post["hashtags"]) > 0
        assert "WorldCup2026" in post["hashtags"]
        # Creator block hydrated
        assert data["creator"]["creator_id"] == "cr_morteza"
        # Related list
        assert isinstance(data["related"], list)
        assert all(rp["post_id"] != "po_seed_000" for rp in data["related"])

    def test_creators_count_is_4_and_includes_morteza(self, s):
        # Ignore admin-created TEST_* creators that may have been added by other tests.
        r = s.get(f"{API}/creators", timeout=20)
        assert r.status_code == 200
        creators = [c for c in r.json() if not c.get("name", "").startswith("TEST_")]
        assert len(creators) == 4, f"expected 4 seed creators, got {len(creators)}"
        ids = [c["creator_id"] for c in creators]
        assert "cr_morteza" in ids

    def test_events_category_filter_has_new_fields(self, s):
        r = s.get(f"{API}/posts", params={"category": "Events"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(p["category"] == "Events" for p in data)
        for p in data:
            for k in ("media_type", "hashtags", "is_sponsored", "video_url", "source", "original_url"):
                assert k in p, f"events post {p.get('post_id')} missing {k}"

    def test_category_all_equals_no_filter(self, s):
        r_all = s.get(f"{API}/posts", params={"category": "All", "limit": 200}, timeout=20)
        r_none = s.get(f"{API}/posts", params={"limit": 200}, timeout=20)
        assert r_all.status_code == 200 and r_none.status_code == 200
        a = [p for p in r_all.json() if p["post_id"].startswith("po_seed_")]
        n = [p for p in r_none.json() if p["post_id"].startswith("po_seed_")]
        assert len(a) == len(n) == 21
        assert sorted(p["post_id"] for p in a) == sorted(p["post_id"] for p in n)


# ---------- Admin auth (X-Admin-Secret) + cleanup/delete ----------
class TestAdminAuth:
    """Verify the new X-Admin-Secret protection on /api/admin/* routes and
    the cleanup/delete endpoints. Each mutating test cleans up after itself.
    """

    creator_payload = {
        "handle": "@test_admin_auth",
        "name": "TEST_AdminAuth",
        "bio": "TEST",
        "avatar": "https://example.com/a.jpg",
        "categories": ["Food"],
    }

    def _post_payload(self, creator_id):
        return {
            "creator_id": creator_id,
            "image": "https://example.com/p.jpg",
            "caption": "TEST_admin_auth post",
            "category": "Food",
            "neighborhood": "TEST_hood",
        }

    # POST /api/admin/creators auth
    def test_create_creator_without_header_401(self, s):
        r = s.post(f"{API}/admin/creators", json=self.creator_payload, timeout=20)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_create_creator_with_wrong_header_401(self, s):
        r = s.post(
            f"{API}/admin/creators",
            json=self.creator_payload,
            headers={"X-Admin-Secret": "definitely_not_the_real_key"},
            timeout=20,
        )
        assert r.status_code == 401

    def test_create_creator_with_correct_header_200(self, s):
        r = s.post(f"{API}/admin/creators", json=self.creator_payload, headers=ADMIN_HDR, timeout=20)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == "TEST_AdminAuth"
        assert "_id" not in created
        cid = created["creator_id"]
        # Verify persisted
        listing = s.get(f"{API}/creators", timeout=20).json()
        assert any(c["creator_id"] == cid for c in listing)
        # Cleanup
        d = s.delete(f"{API}/admin/creators/{cid}", headers=ADMIN_HDR, timeout=20)
        assert d.status_code == 200

    # POST /api/admin/posts auth (same 401/401/200 pattern)
    def test_create_post_without_header_401(self, s):
        r = s.post(f"{API}/admin/posts", json=self._post_payload("cr_morteza"), timeout=20)
        assert r.status_code == 401

    def test_create_post_with_wrong_header_401(self, s):
        r = s.post(
            f"{API}/admin/posts",
            json=self._post_payload("cr_morteza"),
            headers={"X-Admin-Secret": "wrong"},
            timeout=20,
        )
        assert r.status_code == 401

    def test_create_post_with_correct_header_200(self, s):
        # Create a throwaway creator first so cleanup is well-isolated
        cr = s.post(f"{API}/admin/creators", json=self.creator_payload, headers=ADMIN_HDR, timeout=20)
        assert cr.status_code == 200
        cid = cr.json()["creator_id"]

        r = s.post(f"{API}/admin/posts", json=self._post_payload(cid), headers=ADMIN_HDR, timeout=20)
        assert r.status_code == 200, r.text
        post = r.json()
        assert post["creator_id"] == cid
        assert post["caption"] == "TEST_admin_auth post"
        assert "_id" not in post

        # Cleanup: deleting the creator should also delete its posts (verified in a later test)
        d = s.delete(f"{API}/admin/creators/{cid}", headers=ADMIN_HDR, timeout=20)
        assert d.status_code == 200

    # DELETE /api/admin/posts/{id} auth
    def test_delete_post_requires_header(self, s):
        # Create a post via admin
        cr = s.post(f"{API}/admin/creators", json=self.creator_payload, headers=ADMIN_HDR, timeout=20)
        cid = cr.json()["creator_id"]
        rp = s.post(f"{API}/admin/posts", json=self._post_payload(cid), headers=ADMIN_HDR, timeout=20)
        pid = rp.json()["post_id"]

        # Without header -> 401
        r401 = s.delete(f"{API}/admin/posts/{pid}", timeout=20)
        assert r401.status_code == 401

        # With header -> 200 + deleted=1
        r_ok = s.delete(f"{API}/admin/posts/{pid}", headers=ADMIN_HDR, timeout=20)
        assert r_ok.status_code == 200
        assert r_ok.json().get("deleted") == 1

        # Verify post is gone
        g = s.get(f"{API}/posts/{pid}", timeout=20)
        assert g.status_code == 404

        # Cleanup creator
        s.delete(f"{API}/admin/creators/{cid}", headers=ADMIN_HDR, timeout=20)

    # DELETE /api/admin/creators/{id} auth + cascades to posts
    def test_delete_creator_requires_header_and_cascades_posts(self, s):
        cr = s.post(f"{API}/admin/creators", json=self.creator_payload, headers=ADMIN_HDR, timeout=20)
        assert cr.status_code == 200
        cid = cr.json()["creator_id"]
        # Create two posts under this creator
        p1 = s.post(f"{API}/admin/posts", json=self._post_payload(cid), headers=ADMIN_HDR, timeout=20).json()
        p2 = s.post(f"{API}/admin/posts", json=self._post_payload(cid), headers=ADMIN_HDR, timeout=20).json()

        # Without header -> 401, posts still exist
        r401 = s.delete(f"{API}/admin/creators/{cid}", timeout=20)
        assert r401.status_code == 401
        assert s.get(f"{API}/creators/{cid}", timeout=20).status_code == 200

        # With header -> 200, cascades posts
        r_ok = s.delete(f"{API}/admin/creators/{cid}", headers=ADMIN_HDR, timeout=20)
        assert r_ok.status_code == 200
        body = r_ok.json()
        assert body.get("deleted_creator") == 1
        assert body.get("deleted_posts") == 2

        # Verify creator gone and posts gone
        assert s.get(f"{API}/creators/{cid}", timeout=20).status_code == 404
        for pid in (p1["post_id"], p2["post_id"]):
            assert s.get(f"{API}/posts/{pid}", timeout=20).status_code == 404

    # POST /api/admin/cleanup auth + seed preservation
    def test_cleanup_requires_header(self, s):
        r = s.post(f"{API}/admin/cleanup", timeout=20)
        assert r.status_code == 401

    def test_cleanup_preserves_seed_and_removes_non_seed(self, s):
        # Create some non-seed records first
        cr = s.post(f"{API}/admin/creators", json=self.creator_payload, headers=ADMIN_HDR, timeout=20)
        assert cr.status_code == 200
        cid = cr.json()["creator_id"]
        assert cid not in SEED_CREATOR_IDS
        rp = s.post(f"{API}/admin/posts", json=self._post_payload(cid), headers=ADMIN_HDR, timeout=20)
        assert rp.status_code == 200
        pid = rp.json()["post_id"]
        assert not pid.startswith("po_seed_")

        # Sanity: extras visible pre-cleanup
        pre_creators = {c["creator_id"] for c in s.get(f"{API}/creators", timeout=20).json()}
        pre_posts = {p["post_id"] for p in s.get(f"{API}/posts", params={"limit": 500}, timeout=20).json()}
        assert cid in pre_creators
        assert pid in pre_posts

        # Cleanup
        c = s.post(f"{API}/admin/cleanup", headers=ADMIN_HDR, timeout=20)
        assert c.status_code == 200, c.text
        body = c.json()
        assert body.get("deleted_creators", 0) >= 1
        assert body.get("deleted_posts", 0) >= 1

        # Verify seed survives
        creators_after = s.get(f"{API}/creators", timeout=20).json()
        creator_ids = {c["creator_id"] for c in creators_after}
        assert creator_ids == SEED_CREATOR_IDS, (
            f"after cleanup, expected exactly seed creators, got {creator_ids}"
        )

        posts_after = s.get(f"{API}/posts", params={"limit": 500}, timeout=20).json()
        post_ids = {p["post_id"] for p in posts_after}
        assert len(posts_after) == 21, f"expected 21 seed posts after cleanup, got {len(posts_after)}"
        assert all(p["post_id"].startswith("po_seed_") for p in posts_after)
        # The non-seed records we created are gone
        assert cid not in creator_ids
        assert pid not in post_ids


# ---------- Lifespan migration regression ----------
class TestLifespanRegression:
    """Smoke tests confirming the @app.on_event -> lifespan() migration still
    boots the app, runs the seed migration, and serves the 21-post / 4-creator
    baseline."""

    def test_root_alive(self, s):
        r = s.get(f"{API}/", timeout=20)
        assert r.status_code == 200
        assert r.json().get("message")

    def test_seed_baseline_21_posts(self, s):
        r = s.get(f"{API}/posts", params={"limit": 200}, timeout=20)
        assert r.status_code == 200
        seed_posts = [p for p in r.json() if p["post_id"].startswith("po_seed_")]
        assert len(seed_posts) == 21

    def test_seed_baseline_4_creators(self, s):
        r = s.get(f"{API}/creators", timeout=20)
        assert r.status_code == 200
        ids = {c["creator_id"] for c in r.json()} & SEED_CREATOR_IDS
        assert ids == SEED_CREATOR_IDS

    def test_po_seed_000_reachable(self, s):
        r = s.get(f"{API}/posts/po_seed_000", timeout=20)
        assert r.status_code == 200
        assert r.json()["post"]["post_id"] == "po_seed_000"

    def test_category_filter_real_estate(self, s):
        r = s.get(f"{API}/posts", params={"category": "Real Estate"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(p["category"] == "Real Estate" for p in data)

