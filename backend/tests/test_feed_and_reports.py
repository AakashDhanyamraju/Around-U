"""The two endpoints the redesigned Feed tab and staff reports queue need.

`/feed` is the follow graph as a join rather than a client-side filter, and the
reports queue now carries enough context to actually decide something: who filed
it, what they were looking at, and the author's history.
"""

import pytest

from tests.conftest import set_platform_role, sign_in


class TestFeed:
    def test_requires_auth(self, client):
        # There is no anonymous follow graph, so this is 401 rather than empty.
        assert client.get("/api/feed").status_code == 401

    def test_empty_before_following_anyone(self, client, registered_user):
        r = client.get("/api/feed", headers=registered_user["headers"])
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_only_followed_creators(self, client, registered_user):
        headers = registered_user["headers"]
        client.post("/api/follows/cr_morteza", headers=headers)

        feed = client.get("/api/feed", headers=headers).json()
        assert feed, "following a seeded creator should produce posts"
        assert {p["creator_id"] for p in feed} == {"cr_morteza"}
        # The nested creator the feed card renders comes back on every row.
        assert all(p["creator"]["creator_id"] == "cr_morteza" for p in feed)

    def test_unfollowing_empties_it_again(self, client, registered_user):
        headers = registered_user["headers"]
        client.post("/api/follows/cr_bayouwalks", headers=headers)
        assert client.get("/api/feed", headers=headers).json()

        client.delete("/api/follows/cr_bayouwalks", headers=headers)
        assert client.get("/api/feed", headers=headers).json() == []

    def test_category_filter(self, client, registered_user):
        headers = registered_user["headers"]
        for creator in ("cr_morteza", "cr_houstonfoodie", "cr_aroundhtx"):
            client.post(f"/api/follows/{creator}", headers=headers)

        everything = client.get("/api/feed", headers=headers).json()
        categories = {p["category"] for p in everything}
        assert categories, "seeded creators should cover at least one category"

        one = sorted(categories)[0]
        filtered = client.get(f"/api/feed?category={one}", headers=headers).json()
        assert filtered
        assert {p["category"] for p in filtered} == {one}

    def test_newest_first(self, client, registered_user):
        headers = registered_user["headers"]
        client.post("/api/follows/cr_morteza", headers=headers)
        feed = client.get("/api/feed", headers=headers).json()
        stamps = [p["created_at"] for p in feed]
        assert stamps == sorted(stamps, reverse=True)

    def test_is_per_user(self, client, registered_user, new_email):
        client.post("/api/follows/cr_morteza", headers=registered_user["headers"])
        other = sign_in(client, new_email(), "Other")
        assert client.get("/api/feed", headers=other["headers"]).json() == []


@pytest.fixture
def staff_user(make_user):
    user = make_user("Staff Member")
    set_platform_role(user["user_id"], "staff")
    # The role is read from the row on each request, so no re-auth is needed.
    return user


@pytest.fixture
def reported_post(client, make_user, make_community):
    """A community post with one open report filed against it."""
    author = make_user("Post Author")
    community = make_community(author)
    post = client.post(
        f"/api/communities/{community['community_id']}/posts",
        headers=author["headers"],
        json={"body": "reported in a test"},
    ).json()

    reporter = make_user("Reporter")
    client.post(
        f"/api/communities/{community['community_id']}/join",
        headers=reporter["headers"],
    )
    r = client.post(
        "/api/reports",
        headers=reporter["headers"],
        json={
            "target_type": "community_post",
            "target_id": post["community_post_id"],
            "reason": "harassment",
            "note": "someone should look at this",
        },
    )
    assert r.status_code == 201, r.text
    return {
        "report": r.json(),
        "post": post,
        "author": author,
        "reporter": reporter,
        "community": community,
    }


class TestReportsQueue:
    def test_requires_staff(self, client, registered_user):
        assert client.get("/api/reports").status_code == 401
        assert (
            client.get("/api/reports", headers=registered_user["headers"]).status_code
            == 403
        )

    def test_list_carries_the_reporter_and_community(
        self, client, staff_user, reported_post
    ):
        rows = client.get("/api/reports", headers=staff_user["headers"]).json()["reports"]
        row = next(
            r
            for r in rows
            if r["report_id"] == reported_post["report"]["report_id"]
        )
        # Deciding from a bare reason code is what the redesign set out to fix.
        assert row["reporter_name"] == "Reporter"
        assert row["community_name"] == reported_post["community"]["name"]

    def test_welfare_reports_sort_first(self, client, staff_user, make_user, reported_post):
        """A self-harm report jumps the queue however recent the others are."""
        reporter = make_user("Worried Person")
        client.post(
            f"/api/communities/{reported_post['community']['community_id']}/join",
            headers=reporter["headers"],
        )
        urgent = client.post(
            "/api/reports",
            headers=reporter["headers"],
            json={
                "target_type": "community_post",
                "target_id": reported_post["post"]["community_post_id"],
                "reason": "self_harm",
            },
        ).json()

        rows = client.get("/api/reports", headers=staff_user["headers"]).json()["reports"]
        assert rows[0]["report_id"] == urgent["report_id"]

    def test_detail_includes_content_and_author_history(
        self, client, staff_user, reported_post
    ):
        report_id = reported_post["report"]["report_id"]
        detail = client.get(
            f"/api/reports/{report_id}", headers=staff_user["headers"]
        ).json()

        assert detail["content"]["body"] == "reported in a test"
        assert detail["content"]["author_user_id"] == reported_post["author"]["user_id"]
        assert detail["note"] == "someone should look at this"
        assert detail["author"]["name"] == "Post Author"
        assert detail["author"]["prior_actioned"] == 0
        assert detail["author"]["communities"] >= 1

    def test_detail_survives_the_content_being_deleted(
        self, client, staff_user, reported_post
    ):
        """A report outlives its target — the row must not vanish with it."""
        client.delete(
            f"/api/community-posts/{reported_post['post']['community_post_id']}",
            headers=reported_post["author"]["headers"],
        )
        detail = client.get(
            f"/api/reports/{reported_post['report']['report_id']}",
            headers=staff_user["headers"],
        )
        assert detail.status_code == 200
        assert detail.json()["report_id"] == reported_post["report"]["report_id"]

    def test_detail_is_staff_only(self, client, registered_user, reported_post):
        r = client.get(
            f"/api/reports/{reported_post['report']['report_id']}",
            headers=registered_user["headers"],
        )
        assert r.status_code == 403

    def test_resolving_records_the_note_and_action(
        self, client, staff_user, reported_post
    ):
        report_id = reported_post["report"]["report_id"]
        r = client.post(
            f"/api/reports/{report_id}/resolve",
            headers=staff_user["headers"],
            json={
                "status": "actioned",
                "resolution": "hidden",
                "note": "Removed, second strike.",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "actioned"
        assert body["resolution"] == "hidden"
        assert body["resolution_note"] == "Removed, second strike."
        assert body["handled_by"] == staff_user["user_id"]

    def test_resolution_must_be_a_known_action(
        self, client, staff_user, reported_post
    ):
        r = client.post(
            f"/api/reports/{reported_post['report']['report_id']}/resolve",
            headers=staff_user["headers"],
            json={"status": "actioned", "resolution": "vaporised"},
        )
        assert r.status_code == 422

    def test_resolving_twice_conflicts(self, client, staff_user, reported_post):
        report_id = reported_post["report"]["report_id"]
        first = client.post(
            f"/api/reports/{report_id}/resolve",
            headers=staff_user["headers"],
            json={"status": "dismissed", "resolution": "no_action"},
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/reports/{report_id}/resolve",
            headers=staff_user["headers"],
            json={"status": "actioned", "resolution": "hidden"},
        )
        assert second.status_code == 409
