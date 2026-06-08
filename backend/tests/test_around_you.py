"""Backend tests for Around You - Houston community app"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nearby-drops-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


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


# ---------- Admin (open) ----------
class TestAdmin:
    def test_admin_create_creator_and_post(self, s):
        payload = {
            "handle": "@test_creator",
            "name": "TEST_Creator",
            "bio": "TEST bio",
            "avatar": "https://example.com/a.jpg",
            "categories": ["Food"],
        }
        r = s.post(f"{API}/admin/creators", json=payload, timeout=20)
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
        rp = s.post(f"{API}/admin/posts", json=post_payload, timeout=20)
        assert rp.status_code == 200
        post = rp.json()
        assert post["creator_id"] == cid
        assert post["caption"] == "TEST_post caption"
        assert "_id" not in post

        # Cleanup via direct mongo not allowed here; leave TEST_ data identifiable.


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
