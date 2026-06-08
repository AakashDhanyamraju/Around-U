"""Backend tests for new Admin Dashboard endpoints:
- PATCH /api/admin/posts/{id}
- PATCH /api/admin/creators/{id}
- GET   /api/admin/stats
- Regression: public reads still serve 21 posts / 4 creators
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://community-houston.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_SECRET = os.environ.get("ADMIN_API_KEY", "2CqEcj2JlHDJqqEvfK4RywE2I_aaETN_")
ADMIN_HDR = {"X-Admin-Secret": ADMIN_SECRET}
WRONG_HDR = {"X-Admin-Secret": "definitely-not-the-key"}
SEED_CREATOR_IDS = {"cr_morteza", "cr_houstonfoodie", "cr_aroundhtx", "cr_bayouwalks"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Regression: public baseline ----------
class TestPublicBaseline:
    def test_posts_count_21(self, s):
        r = s.get(f"{API}/posts", params={"limit": 500}, timeout=20)
        assert r.status_code == 200
        assert len(r.json()) == 21

    def test_creators_count_4(self, s):
        r = s.get(f"{API}/creators", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 4
        assert {c["creator_id"] for c in data} == SEED_CREATOR_IDS

    def test_get_post_seed_000(self, s):
        r = s.get(f"{API}/posts/po_seed_000", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body["post"]["post_id"] == "po_seed_000"
        assert body["creator"] and body["creator"]["creator_id"] == "cr_morteza"


# ---------- PATCH /api/admin/posts/{id} ----------
class TestPatchPosts:
    POST_ID = "po_seed_001"  # Morteza real-estate post (image, not sponsored)

    def test_patch_post_no_header_401(self, s):
        r = s.patch(f"{API}/admin/posts/{self.POST_ID}", json={"is_sponsored": True}, timeout=15)
        assert r.status_code == 401

    def test_patch_post_wrong_header_401(self, s):
        r = s.patch(
            f"{API}/admin/posts/{self.POST_ID}",
            json={"is_sponsored": True},
            headers=WRONG_HDR,
            timeout=15,
        )
        assert r.status_code == 401

    def test_patch_post_empty_body_400(self, s):
        r = s.patch(f"{API}/admin/posts/{self.POST_ID}", json={}, headers=ADMIN_HDR, timeout=15)
        assert r.status_code == 400

    def test_patch_post_nonexistent_404(self, s):
        r = s.patch(
            f"{API}/admin/posts/po_does_not_exist",
            json={"is_sponsored": True},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert r.status_code == 404

    def test_patch_post_persists_and_revert(self, s):
        # baseline
        before = s.get(f"{API}/posts/{self.POST_ID}", timeout=15).json()["post"]
        assert before["is_sponsored"] is False, "Precondition: seed post should not be sponsored"

        # PATCH to sponsored=true
        r = s.patch(
            f"{API}/admin/posts/{self.POST_ID}",
            json={"is_sponsored": True},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["post_id"] == self.POST_ID
        assert body["is_sponsored"] is True
        assert "_id" not in body

        # Verify via GET
        verify = s.get(f"{API}/posts/{self.POST_ID}", timeout=15).json()["post"]
        assert verify["is_sponsored"] is True

        # Revert
        rev = s.patch(
            f"{API}/admin/posts/{self.POST_ID}",
            json={"is_sponsored": False},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert rev.status_code == 200
        assert rev.json()["is_sponsored"] is False

        # Verify reverted
        final = s.get(f"{API}/posts/{self.POST_ID}", timeout=15).json()["post"]
        assert final["is_sponsored"] is False


# ---------- PATCH /api/admin/creators/{id} ----------
class TestPatchCreators:
    CREATOR_ID = "cr_bayouwalks"

    def test_patch_creator_no_header_401(self, s):
        r = s.patch(f"{API}/admin/creators/{self.CREATOR_ID}", json={"bio": "x"}, timeout=15)
        assert r.status_code == 401

    def test_patch_creator_wrong_header_401(self, s):
        r = s.patch(
            f"{API}/admin/creators/{self.CREATOR_ID}",
            json={"bio": "x"},
            headers=WRONG_HDR,
            timeout=15,
        )
        assert r.status_code == 401

    def test_patch_creator_empty_body_400(self, s):
        r = s.patch(
            f"{API}/admin/creators/{self.CREATOR_ID}", json={}, headers=ADMIN_HDR, timeout=15
        )
        assert r.status_code == 400

    def test_patch_creator_nonexistent_404(self, s):
        r = s.patch(
            f"{API}/admin/creators/cr_nope",
            json={"bio": "x"},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert r.status_code == 404

    def test_patch_creator_persists_and_revert(self, s):
        # baseline
        before = s.get(f"{API}/creators/{self.CREATOR_ID}", timeout=15).json()["creator"]
        original_bio = before["bio"]
        new_bio = "TEST_PATCH bio for bayou walks"

        # PATCH
        r = s.patch(
            f"{API}/admin/creators/{self.CREATOR_ID}",
            json={"bio": new_bio},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["creator_id"] == self.CREATOR_ID
        assert body["bio"] == new_bio
        assert "_id" not in body

        # Verify via GET
        verify = s.get(f"{API}/creators/{self.CREATOR_ID}", timeout=15).json()["creator"]
        assert verify["bio"] == new_bio

        # Revert
        rev = s.patch(
            f"{API}/admin/creators/{self.CREATOR_ID}",
            json={"bio": original_bio},
            headers=ADMIN_HDR,
            timeout=15,
        )
        assert rev.status_code == 200
        assert rev.json()["bio"] == original_bio


# ---------- GET /api/admin/stats ----------
class TestAdminStats:
    def test_stats_no_header_401(self, s):
        r = s.get(f"{API}/admin/stats", timeout=15)
        assert r.status_code == 401

    def test_stats_wrong_header_401(self, s):
        r = s.get(f"{API}/admin/stats", headers=WRONG_HDR, timeout=15)
        assert r.status_code == 401

    def test_stats_correct_header_200(self, s):
        r = s.get(f"{API}/admin/stats", headers=ADMIN_HDR, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Required keys
        for k in ("total_posts", "total_creators", "video_count", "sponsored_count", "by_category", "by_creator"):
            assert k in body, f"missing key {k}"
        # Baseline expectations from seed v3
        assert body["total_posts"] == 21
        assert body["total_creators"] == 4
        assert body["video_count"] == 2
        assert isinstance(body["sponsored_count"], int)
        # by_category list of {category, count}
        assert isinstance(body["by_category"], list) and len(body["by_category"]) > 0
        for row in body["by_category"]:
            assert "category" in row and "count" in row and isinstance(row["count"], int)
        # by_creator list of {creator_id, name, count}, summing to total_posts
        assert isinstance(body["by_creator"], list) and len(body["by_creator"]) == 4
        total = 0
        for row in body["by_creator"]:
            assert "creator_id" in row and "name" in row and "count" in row
            total += row["count"]
        assert total == body["total_posts"]
        # Categories sum to total_posts as well
        assert sum(c["count"] for c in body["by_category"]) == body["total_posts"]
