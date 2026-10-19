"""Communities, membership and the community half of RBAC.

The allow/deny matrix in TestRolePermissions is the point of this file: a
permission model is only meaningful if the denials are tested as hard as the
grants. TestPrivacy covers the leak that separating `posts` from
`community_posts` exists to prevent.
"""

import pytest

from tests.conftest import (
    DEFAULT_REGION,
    db_fetchval,
    purge_community,
    set_platform_role,
    sign_in,
)


class TestAuthRequired:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("post", "/api/communities"),
            ("get", "/api/communities/mine"),
            ("post", "/api/communities/com_nope/join"),
            ("post", "/api/communities/com_nope/leave"),
            ("patch", "/api/communities/com_nope"),
            ("delete", "/api/communities/com_nope"),
            ("post", "/api/communities/com_nope/posts"),
            ("post", "/api/reports"),
            ("get", "/api/blocks"),
        ],
    )
    def test_requires_auth(self, client, method, path):
        assert getattr(client, method)(path).status_code == 401


class TestCreation:
    def test_unverified_user_cannot_create(self, client, make_user):
        """`require_verified` still has to hold.

        No real sign-in path produces an unverified session any more — entering a
        one-time code proves ownership, and Google asserts it — so the state has
        to be forced. The gate is kept because a future provider might not
        verify, and this asserts it still bites.
        """
        unverified = make_user("Unverified", verified=False)
        r = client.post(
            "/api/communities",
            headers=unverified["headers"],
            json={"region_id": DEFAULT_REGION, "name": "Unverified Attempt"},
        )
        assert r.status_code == 403
        assert "verify" in r.json()["detail"].lower()

    def test_verified_user_becomes_head(self, client, verified_user, make_community):
        community = make_community(verified_user)
        assert community["viewer_role"] == "head"
        assert community["created_by"] == verified_user["user_id"]
        # The creator is seated as a member in the same transaction.
        assert community["member_count"] == 1

    def test_unknown_region_is_rejected(self, client, verified_user):
        r = client.post(
            "/api/communities",
            headers=verified_user["headers"],
            json={"region_id": "reg_atlantis", "name": "Sunken City Club"},
        )
        assert r.status_code == 400

    def test_creation_is_capped(self, client, verified_user, make_community):
        make_community(verified_user)
        make_community(verified_user)

        r = client.post(
            "/api/communities",
            headers=verified_user["headers"],
            json={"region_id": DEFAULT_REGION, "name": "One Too Many"},
        )
        assert r.status_code == 409
        assert "archive" in r.json()["detail"].lower()

    def test_duplicate_name_in_region_is_rejected(
        self, client, verified_user, make_user, make_community
    ):
        first = make_community(verified_user, name="Houston Climbers")

        other = make_user("Other Owner", verified=True)
        r = client.post(
            "/api/communities",
            headers=other["headers"],
            json={"region_id": DEFAULT_REGION, "name": "Houston Climbers"},
        )
        assert r.status_code == 409
        assert first["slug"] == "houston-climbers"


class TestMembership:
    def test_join_open_community(self, client, verified_user, make_user, make_community):
        community = make_community(verified_user)
        joiner = make_user("Joiner")

        r = client.post(
            f"/api/communities/{community['community_id']}/join",
            headers=joiner["headers"],
        )
        assert r.status_code == 200
        assert r.json() == {"status": "active", "role": "member"}

    def test_join_is_idempotent(self, client, verified_user, make_user, make_community):
        community = make_community(verified_user)
        joiner = make_user("Joiner")
        path = f"/api/communities/{community['community_id']}/join"

        client.post(path, headers=joiner["headers"])
        client.post(path, headers=joiner["headers"])

        count = db_fetchval(
            "SELECT member_count FROM communities WHERE community_id = $1",
            community["community_id"],
        )
        assert count == 2

    def test_request_policy_creates_pending_without_counting(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, join_policy="request")
        joiner = make_user("Hopeful")

        r = client.post(
            f"/api/communities/{community['community_id']}/join",
            headers=joiner["headers"],
        )
        assert r.json()["status"] == "pending"

        # A pending request is not yet a member and must not inflate the counter.
        count = db_fetchval(
            "SELECT member_count FROM communities WHERE community_id = $1",
            community["community_id"],
        )
        assert count == 1

    def test_approve_promotes_and_counts(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, join_policy="request")
        joiner = make_user("Hopeful")
        cid = community["community_id"]

        client.post(f"/api/communities/{cid}/join", headers=joiner["headers"])
        r = client.post(
            f"/api/communities/{cid}/members/{joiner['user_id']}/approve",
            headers=verified_user["headers"],
        )
        assert r.status_code == 200
        assert db_fetchval(
            "SELECT member_count FROM communities WHERE community_id = $1", cid
        ) == 2

    def test_invite_only_rejects_join(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, join_policy="invite")
        joiner = make_user("Uninvited")

        r = client.post(
            f"/api/communities/{community['community_id']}/join",
            headers=joiner["headers"],
        )
        assert r.status_code == 403

    def test_head_cannot_leave_without_transferring(
        self, client, verified_user, make_community
    ):
        community = make_community(verified_user)
        r = client.post(
            f"/api/communities/{community['community_id']}/leave",
            headers=verified_user["headers"],
        )
        assert r.status_code == 409
        assert "transfer" in r.json()["detail"].lower()

    def test_banned_member_cannot_rejoin(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user)
        member = make_user("Troublemaker")
        cid = community["community_id"]

        client.post(f"/api/communities/{cid}/join", headers=member["headers"])
        client.post(
            f"/api/communities/{cid}/members/{member['user_id']}/ban",
            headers=verified_user["headers"],
            json={"reason": "spam"},
        )

        r = client.post(f"/api/communities/{cid}/join", headers=member["headers"])
        assert r.status_code == 403


class TestCounterIntegrity:
    """member_count is denormalised, so it is only as good as its transactions.

    `creators.followers` already drifted for exactly this reason; these assertions
    are what stop the same thing happening here.
    """

    def test_member_count_matches_reality_through_churn(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user)
        cid = community["community_id"]

        a = make_user("A")
        b = make_user("B")
        c = make_user("C")
        for u in (a, b, c):
            client.post(f"/api/communities/{cid}/join", headers=u["headers"])

        client.post(f"/api/communities/{cid}/leave", headers=a["headers"])
        client.post(
            f"/api/communities/{cid}/members/{b['user_id']}/ban",
            headers=verified_user["headers"],
            json={"reason": "spam"},
        )
        # Banning twice must not double-decrement.
        client.post(
            f"/api/communities/{cid}/members/{b['user_id']}/ban",
            headers=verified_user["headers"],
            json={"reason": "spam"},
        )

        stored = db_fetchval(
            "SELECT member_count FROM communities WHERE community_id = $1", cid
        )
        actual = db_fetchval(
            "SELECT COUNT(*) FROM community_members "
            "WHERE community_id = $1 AND status = 'active'",
            cid,
        )
        # head + c remain active.
        assert stored == actual == 2

    def test_post_count_matches_reality(
        self, client, verified_user, make_community
    ):
        community = make_community(verified_user)
        cid = community["community_id"]

        ids = []
        for i in range(3):
            r = client.post(
                f"/api/communities/{cid}/posts",
                headers=verified_user["headers"],
                json={"body": f"post {i}"},
            )
            assert r.status_code == 201, r.text
            ids.append(r.json()["community_post_id"])

        client.delete(
            f"/api/community-posts/{ids[0]}", headers=verified_user["headers"]
        )

        stored = db_fetchval(
            "SELECT post_count FROM communities WHERE community_id = $1", cid
        )
        actual = db_fetchval(
            "SELECT COUNT(*) FROM community_posts "
            "WHERE community_id = $1 AND deleted_at IS NULL",
            cid,
        )
        assert stored == actual == 2


class TestRolePermissions:
    """The allow/deny matrix. Each capability is asserted from both sides."""

    @pytest.fixture
    def staffed(self, client, verified_user, make_user, make_community):
        """A community with a head, a manager, a plain member and an outsider."""
        community = make_community(verified_user)
        cid = community["community_id"]

        manager = make_user("Manager")
        member = make_user("Member")
        outsider = make_user("Outsider")

        for u in (manager, member):
            client.post(f"/api/communities/{cid}/join", headers=u["headers"])
        r = client.post(
            f"/api/communities/{cid}/members/{manager['user_id']}/role",
            headers=verified_user["headers"],
            json={"role": "manager"},
        )
        assert r.status_code == 200, r.text

        return {
            "community_id": cid,
            "head": verified_user,
            "manager": manager,
            "member": member,
            "outsider": outsider,
        }

    def test_only_head_can_appoint_managers(self, client, staffed, make_user):
        cid = staffed["community_id"]
        newcomer = make_user("Newcomer")
        client.post(f"/api/communities/{cid}/join", headers=newcomer["headers"])
        path = f"/api/communities/{cid}/members/{newcomer['user_id']}/role"

        assert client.post(
            path, headers=staffed["manager"]["headers"], json={"role": "manager"}
        ).status_code == 403
        assert client.post(
            path, headers=staffed["member"]["headers"], json={"role": "manager"}
        ).status_code == 403
        assert client.post(
            path, headers=staffed["head"]["headers"], json={"role": "manager"}
        ).status_code == 200

    def test_manager_cannot_delete_community_but_head_can(self, client, staffed):
        cid = staffed["community_id"]
        assert client.delete(
            f"/api/communities/{cid}", headers=staffed["manager"]["headers"]
        ).status_code == 403
        assert client.delete(
            f"/api/communities/{cid}", headers=staffed["member"]["headers"]
        ).status_code == 403
        assert client.delete(
            f"/api/communities/{cid}", headers=staffed["head"]["headers"]
        ).status_code == 200

    def test_manager_cannot_ban_the_head(self, client, staffed):
        cid = staffed["community_id"]
        r = client.post(
            f"/api/communities/{cid}/members/{staffed['head']['user_id']}/ban",
            headers=staffed["manager"]["headers"],
            json={"reason": "harassment"},
        )
        assert r.status_code == 403
        assert "above your own role" in r.json()["detail"]

    def test_manager_cannot_ban_another_manager(self, client, staffed, make_user):
        cid = staffed["community_id"]
        peer = make_user("Peer Manager")
        client.post(f"/api/communities/{cid}/join", headers=peer["headers"])
        client.post(
            f"/api/communities/{cid}/members/{peer['user_id']}/role",
            headers=staffed["head"]["headers"],
            json={"role": "manager"},
        )

        r = client.post(
            f"/api/communities/{cid}/members/{peer['user_id']}/ban",
            headers=staffed["manager"]["headers"],
            json={"reason": "spam"},
        )
        assert r.status_code == 403

    def test_manager_can_ban_a_member(self, client, staffed):
        cid = staffed["community_id"]
        r = client.post(
            f"/api/communities/{cid}/members/{staffed['member']['user_id']}/ban",
            headers=staffed["manager"]["headers"],
            json={"reason": "spam"},
        )
        assert r.status_code == 200

    def test_only_manager_and_above_can_pin(self, client, staffed):
        cid = staffed["community_id"]
        post = client.post(
            f"/api/communities/{cid}/posts",
            headers=staffed["member"]["headers"],
            json={"body": "pin me"},
        ).json()
        path = f"/api/community-posts/{post['community_post_id']}/pin"

        # Authors do not get to pin their own post — pinning is curation.
        assert client.post(
            path, headers=staffed["member"]["headers"]
        ).status_code == 403
        assert client.post(
            path, headers=staffed["manager"]["headers"]
        ).status_code == 200

    def test_member_can_delete_own_post_but_not_others(self, client, staffed):
        cid = staffed["community_id"]
        managers_post = client.post(
            f"/api/communities/{cid}/posts",
            headers=staffed["manager"]["headers"],
            json={"body": "manager's post"},
        ).json()
        own_post = client.post(
            f"/api/communities/{cid}/posts",
            headers=staffed["member"]["headers"],
            json={"body": "member's post"},
        ).json()

        assert client.delete(
            f"/api/community-posts/{managers_post['community_post_id']}",
            headers=staffed["member"]["headers"],
        ).status_code == 403
        assert client.delete(
            f"/api/community-posts/{own_post['community_post_id']}",
            headers=staffed["member"]["headers"],
        ).status_code == 200

    def test_manager_can_delete_any_post(self, client, staffed):
        cid = staffed["community_id"]
        post = client.post(
            f"/api/communities/{cid}/posts",
            headers=staffed["member"]["headers"],
            json={"body": "moderate me"},
        ).json()

        assert client.delete(
            f"/api/community-posts/{post['community_post_id']}",
            headers=staffed["manager"]["headers"],
        ).status_code == 200

    def test_outsider_cannot_post(self, client, staffed):
        r = client.post(
            f"/api/communities/{staffed['community_id']}/posts",
            headers=staffed["outsider"]["headers"],
            json={"body": "let me in"},
        )
        assert r.status_code == 403

    def test_outsider_cannot_see_pending_members(self, client, staffed):
        r = client.get(
            f"/api/communities/{staffed['community_id']}/members?member_status=pending",
            headers=staffed["member"]["headers"],
        )
        assert r.status_code == 403

    def test_transfer_ownership_swaps_roles(self, client, staffed):
        cid = staffed["community_id"]
        r = client.post(
            f"/api/communities/{cid}/members/{staffed['manager']['user_id']}"
            "/transfer-ownership",
            headers=staffed["head"]["headers"],
        )
        assert r.status_code == 200

        # The old head steps down to manager; exactly one head remains.
        heads = db_fetchval(
            "SELECT COUNT(*) FROM community_members "
            "WHERE community_id = $1 AND role = 'head'",
            cid,
        )
        assert heads == 1
        new_head = db_fetchval(
            "SELECT user_id FROM community_members "
            "WHERE community_id = $1 AND role = 'head'",
            cid,
        )
        assert new_head == staffed["manager"]["user_id"]


class TestStaffOverride:
    def test_staff_can_moderate_without_membership(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user)
        cid = community["community_id"]

        staff = make_user("Staff", verified=True)
        set_platform_role(staff["user_id"], "staff")
        # Sign in again so the new role is on the token's user row.
        staff_headers = sign_in(client, staff["email"])["headers"]

        post = client.post(
            f"/api/communities/{cid}/posts",
            headers=verified_user["headers"],
            json={"body": "staff will remove this"},
        ).json()

        r = client.delete(
            f"/api/community-posts/{post['community_post_id']}",
            headers=staff_headers,
        )
        assert r.status_code == 200


class TestPrivacy:
    """A private community must be invisible, not merely uneditable."""

    def test_private_community_is_hidden_from_outsiders(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, visibility="private")
        cid = community["community_id"]
        outsider = make_user("Outsider")

        # 404 rather than 403: a 403 would confirm the community exists.
        assert client.get(
            f"/api/communities/{cid}", headers=outsider["headers"]
        ).status_code == 404
        assert client.get(f"/api/communities/{cid}").status_code == 404

        listed = client.get(
            "/api/communities", headers=outsider["headers"]
        ).json()["communities"]
        assert cid not in {c["community_id"] for c in listed}

    def test_private_community_is_visible_to_its_members(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, visibility="private")
        assert client.get(
            f"/api/communities/{community['community_id']}",
            headers=verified_user["headers"],
        ).status_code == 200

    def test_private_posts_never_reach_the_public_feed(
        self, client, verified_user, make_user, make_community
    ):
        """The reason community_posts is a separate table from posts."""
        community = make_community(verified_user, visibility="private")
        cid = community["community_id"]
        secret = "pytest-private-community-secret-string"

        client.post(
            f"/api/communities/{cid}/posts",
            headers=verified_user["headers"],
            json={"body": secret},
        )

        public_feed = client.get("/api/posts?limit=500").text
        assert secret not in public_feed

        outsider = client.get("/api/communities").text
        assert secret not in outsider

    def test_private_post_is_404_for_outsiders_by_id(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user, visibility="private")
        outsider = make_user("Outsider")

        post = client.post(
            f"/api/communities/{community['community_id']}/posts",
            headers=verified_user["headers"],
            json={"body": "members only"},
        ).json()

        r = client.get(
            f"/api/community-posts/{post['community_post_id']}",
            headers=outsider["headers"],
        )
        assert r.status_code == 404


class TestCommentsAndReactions:
    def test_member_can_comment_and_count_tracks(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user)
        cid = community["community_id"]
        post = client.post(
            f"/api/communities/{cid}/posts",
            headers=verified_user["headers"],
            json={"body": "discuss"},
        ).json()
        pid = post["community_post_id"]

        r = client.post(
            f"/api/community-posts/{pid}/comments",
            headers=verified_user["headers"],
            json={"body": "first"},
        )
        assert r.status_code == 201

        assert db_fetchval(
            "SELECT comment_count FROM community_posts WHERE community_post_id = $1",
            pid,
        ) == 1

    def test_outsider_cannot_comment(
        self, client, verified_user, make_user, make_community
    ):
        community = make_community(verified_user)
        post = client.post(
            f"/api/communities/{community['community_id']}/posts",
            headers=verified_user["headers"],
            json={"body": "discuss"},
        ).json()
        outsider = make_user("Outsider")

        r = client.post(
            f"/api/community-posts/{post['community_post_id']}/comments",
            headers=outsider["headers"],
            json={"body": "butting in"},
        )
        assert r.status_code == 403

    def test_reactions_toggle_and_dedupe(
        self, client, verified_user, make_community
    ):
        community = make_community(verified_user)
        post = client.post(
            f"/api/communities/{community['community_id']}/posts",
            headers=verified_user["headers"],
            json={"body": "react to me"},
        ).json()
        pid = post["community_post_id"]
        path = f"/api/community-posts/{pid}/reactions"

        client.post(path, headers=verified_user["headers"], json={"emoji": "🔥"})
        # Same emoji twice is idempotent, not a second reaction.
        r = client.post(path, headers=verified_user["headers"], json={"emoji": "🔥"})
        summary = {x["emoji"]: x for x in r.json()["reactions"]}
        assert summary["🔥"]["count"] == 1
        assert summary["🔥"]["reacted"] is True

        r = client.delete(
            f"{path}?emoji=%F0%9F%94%A5", headers=verified_user["headers"]
        )
        assert r.json()["reactions"] == []
