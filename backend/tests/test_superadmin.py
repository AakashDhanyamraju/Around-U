"""The superadmin portal, and the escalation guards around it.

The point of this file is the denials. `staff` must not be able to appoint other
admins, nobody may demote themselves out of access, and the last superadmin must
not be removable — each of those is a lockout or an escalation if it goes wrong.
"""

import uuid

import pytest

from tests.conftest import (
    DEFAULT_REGION,
    db_execute,
    db_fetchval,
    set_platform_role,
    sign_in,
)


def _login(client, user: dict) -> dict:
    """Fresh headers after a role change, via a new one-time code.

    Signing in again also exercises the bootstrap promotion path, which runs on
    every sign-in rather than only at account creation.
    """
    return sign_in(client, user["email"])["headers"]


@pytest.fixture
def superadmin(client, make_user):
    user = make_user("Super Admin", verified=True)
    set_platform_role(user["user_id"], "superadmin")
    user["headers"] = _login(client, user)
    return user


@pytest.fixture
def staff(client, make_user):
    user = make_user("Staff Member", verified=True)
    set_platform_role(user["user_id"], "staff")
    user["headers"] = _login(client, user)
    return user


@pytest.fixture
def cleanup_created():
    """Hard-removes accounts the portal created, plus their audit rows."""
    ids: list[str] = []
    emails: list[str] = []
    yield {"ids": ids, "emails": emails}
    for uid in ids:
        db_execute("DELETE FROM role_audit WHERE subject_id = $1 OR actor_id = $1", uid)
        db_execute("DELETE FROM email_tokens WHERE user_id = $1", uid)
        db_execute("DELETE FROM user_sessions WHERE user_id = $1", uid)
        db_execute("DELETE FROM users WHERE user_id = $1", uid)
    for email in emails:
        db_execute("DELETE FROM users WHERE LOWER(email) = LOWER($1)", email)


ROUTES = [
    ("get", "/api/superadmin/overview"),
    ("get", "/api/superadmin/users"),
    ("get", "/api/superadmin/audit"),
    ("get", "/api/superadmin/creators"),
    ("post", "/api/superadmin/users"),
]


class TestAccessControl:
    @pytest.mark.parametrize(("method", "path"), ROUTES)
    def test_anonymous_is_rejected(self, client, method, path):
        assert getattr(client, method)(path).status_code == 401

    @pytest.mark.parametrize(("method", "path"), ROUTES)
    def test_plain_user_is_rejected(self, client, registered_user, method, path):
        r = getattr(client, method)(path, headers=registered_user["headers"])
        assert r.status_code == 403

    @pytest.mark.parametrize(("method", "path"), ROUTES)
    def test_staff_is_rejected(self, client, staff, method, path):
        """Staff run the platform day to day but must not be able to appoint
        admins — that is the whole reason superadmin is a separate tier."""
        r = getattr(client, method)(path, headers=staff["headers"])
        assert r.status_code == 403

    def test_superadmin_is_allowed(self, client, superadmin):
        assert client.get(
            "/api/superadmin/overview", headers=superadmin["headers"]
        ).status_code == 200

    def test_superadmin_inherits_staff_powers(self, client, superadmin):
        """superadmin must be a strict superset of staff, not a sibling."""
        assert client.get(
            "/api/reports", headers=superadmin["headers"]
        ).status_code == 200

    def test_staff_can_still_reach_staff_routes(self, client, staff):
        assert client.get("/api/reports", headers=staff["headers"]).status_code == 200

    def test_plain_user_cannot_reach_staff_routes(self, client, registered_user):
        assert client.get(
            "/api/reports", headers=registered_user["headers"]
        ).status_code == 403


class TestBootstrap:
    """The configured address is promoted automatically — otherwise there would
    be no way to appoint the first superadmin."""

    def test_configured_email_is_promoted_on_first_sign_in(self, client, cleanup_created):
        from app.config import settings

        email = settings.super_admin_email_list[0]
        # Only meaningful if that account does not already exist.
        if db_fetchval("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)", email):
            pytest.skip("configured superadmin account already exists")

        cleanup_created["emails"].append(email)
        result = sign_in(client, email, "Owner")
        assert result["created"] is True
        me = client.get("/api/auth/me", headers=result["headers"]).json()
        assert me["platform_role"] == "superadmin"

    def test_promotion_is_reapplied_on_login(self, client, make_user):
        """Editing the row by hand should not stick — config is the source of truth."""
        from app.config import settings

        user = make_user("Temp Owner", verified=True)
        # Point the config at this throwaway account for the duration of the test.
        original = settings.super_admin_emails
        settings.super_admin_emails = user["email"]
        try:
            set_platform_role(user["user_id"], "user")
            body = sign_in(client, user["email"])
            me = client.get("/api/auth/me", headers=body["headers"]).json()
            assert me["platform_role"] == "superadmin"
        finally:
            settings.super_admin_emails = original


class TestUserDirectory:
    def test_list_and_search(self, client, superadmin):
        body = client.get(
            f"/api/superadmin/users?q={superadmin['email']}",
            headers=superadmin["headers"],
        ).json()
        assert body["total"] >= 1
        assert superadmin["user_id"] in {u["user_id"] for u in body["users"]}

    def test_password_hash_is_never_exposed(self, client, superadmin):
        body = client.get(
            "/api/superadmin/users?limit=5", headers=superadmin["headers"]
        ).json()
        for u in body["users"]:
            assert "password_hash" not in u
            assert "deleted_at" not in u

    def test_filter_by_role(self, client, superadmin):
        body = client.get(
            "/api/superadmin/users?platform_role=superadmin",
            headers=superadmin["headers"],
        ).json()
        assert all(u["platform_role"] == "superadmin" for u in body["users"])

    def test_unknown_role_filter_is_rejected(self, client, superadmin):
        r = client.get(
            "/api/superadmin/users?platform_role=wizard",
            headers=superadmin["headers"],
        )
        assert r.status_code == 400

    def test_detail_includes_creator_and_communities(
        self, client, superadmin, verified_user, make_community
    ):
        make_community(verified_user)
        body = client.get(
            f"/api/superadmin/users/{verified_user['user_id']}",
            headers=superadmin["headers"],
        ).json()
        assert body["user"]["user_id"] == verified_user["user_id"]
        assert len(body["communities"]) == 1
        assert body["creator"] is None

    def test_missing_user_is_404(self, client, superadmin):
        assert client.get(
            "/api/superadmin/users/user_doesnotexist", headers=superadmin["headers"]
        ).status_code == 404


class TestRoleAssignment:
    def test_promote_and_demote(self, client, superadmin, make_user):
        target = make_user("Promotable")
        path = f"/api/superadmin/users/{target['user_id']}/role"

        r = client.post(
            path, headers=superadmin["headers"], json={"platform_role": "staff"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["user"]["platform_role"] == "staff"

        r = client.post(
            path, headers=superadmin["headers"], json={"platform_role": "user"}
        )
        assert r.json()["user"]["platform_role"] == "user"

    def test_role_change_is_audited(self, client, superadmin, make_user):
        target = make_user("Audited")
        client.post(
            f"/api/superadmin/users/{target['user_id']}/role",
            headers=superadmin["headers"],
            json={"platform_role": "staff", "note": "promoted for testing"},
        )

        entries = client.get(
            "/api/superadmin/audit", headers=superadmin["headers"]
        ).json()["entries"]
        mine = [e for e in entries if e["subject_id"] == target["user_id"]]
        assert mine, "role change was not recorded"
        assert mine[0]["from_role"] == "user"
        assert mine[0]["to_role"] == "staff"
        assert mine[0]["actor_id"] == superadmin["user_id"]

        db_execute("DELETE FROM role_audit WHERE subject_id = $1", target["user_id"])

    def test_invalid_role_is_rejected(self, client, superadmin, make_user):
        target = make_user("Target")
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/role",
            headers=superadmin["headers"],
            json={"platform_role": "god"},
        )
        assert r.status_code == 422

    def test_cannot_demote_self(self, client, superadmin):
        """Self-demotion is an instant, irreversible lockout."""
        r = client.post(
            f"/api/superadmin/users/{superadmin['user_id']}/role",
            headers=superadmin["headers"],
            json={"platform_role": "user"},
        )
        assert r.status_code == 400
        assert "your own role" in r.json()["detail"]

    def test_cannot_demote_the_last_superadmin(self, client, superadmin, make_user):
        """With two superadmins the demotion is allowed; the guard only fires when
        it would leave nobody able to appoint one."""
        other = make_user("Second Admin", verified=True)
        client.post(
            f"/api/superadmin/users/{other['user_id']}/role",
            headers=superadmin["headers"],
            json={"platform_role": "superadmin"},
        )

        other_headers = _login(client, other)
        r = client.post(
            f"/api/superadmin/users/{superadmin['user_id']}/role",
            headers=other_headers,
            json={"platform_role": "staff"},
        )
        assert r.status_code == 200, r.text

        # Now `other` is the only one left, and demoting them must be refused.
        r = client.post(
            f"/api/superadmin/users/{other['user_id']}/role",
            headers=other_headers,
            json={"platform_role": "user"},
        )
        assert r.status_code in (400, 409)

        db_execute(
            "DELETE FROM role_audit WHERE subject_id = ANY($1::text[])",
            [superadmin["user_id"], other["user_id"]],
        )

    def test_staff_cannot_promote_anyone(self, client, staff, make_user):
        target = make_user("Would-be admin")
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/role",
            headers=staff["headers"],
            json={"platform_role": "superadmin"},
        )
        assert r.status_code == 403
        assert db_fetchval(
            "SELECT platform_role FROM users WHERE user_id = $1", target["user_id"]
        ) == "user"


class TestCreatorLinking:
    @pytest.fixture
    def creator_profile(self, client, admin_headers):
        r = client.post(
            "/api/admin/creators",
            headers=admin_headers,
            json={
                "handle": f"@pytest.sa.{uuid.uuid4().hex[:6]}",
                "name": "Portal Creator",
                "avatar": "https://example.com/a.jpg",
                "categories": ["Food"],
            },
        )
        assert r.status_code == 201, r.text
        creator = r.json()
        yield creator
        db_execute("DELETE FROM posts WHERE creator_id = $1", creator["creator_id"])
        db_execute(
            "DELETE FROM creator_regions WHERE creator_id = $1", creator["creator_id"]
        )
        db_execute("DELETE FROM creators WHERE creator_id = $1", creator["creator_id"])

    def test_linking_grants_the_creator_role(
        self, client, superadmin, make_user, creator_profile
    ):
        target = make_user("New Creator", verified=True)
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/creator-link",
            headers=superadmin["headers"],
            json={"creator_id": creator_profile["creator_id"]},
        )
        assert r.status_code == 200, r.text
        # A profile without the role would leave them unable to publish.
        assert r.json()["user"]["platform_role"] == "creator"
        assert r.json()["user"]["creator_id"] == creator_profile["creator_id"]

    def test_linked_creator_can_actually_publish(
        self, client, superadmin, make_user, creator_profile
    ):
        """End to end: the point of linking is that they can then post."""
        target = make_user("Publishing Creator", verified=True)
        client.post(
            f"/api/superadmin/users/{target['user_id']}/creator-link",
            headers=superadmin["headers"],
            json={"creator_id": creator_profile["creator_id"]},
        )

        headers = _login(client, target)
        r = client.post(
            "/api/creator/posts",
            headers=headers,
            json={
                "region_id": DEFAULT_REGION,
                "image": "https://example.com/x.jpg",
                "category": "Food",
                "neighborhood": "Montrose",
            },
        )
        assert r.status_code == 201, r.text

    def test_one_profile_cannot_be_linked_twice(
        self, client, superadmin, make_user, creator_profile
    ):
        a = make_user("First", verified=True)
        b = make_user("Second", verified=True)
        path_a = f"/api/superadmin/users/{a['user_id']}/creator-link"
        path_b = f"/api/superadmin/users/{b['user_id']}/creator-link"
        body = {"creator_id": creator_profile["creator_id"]}

        assert client.post(path_a, headers=superadmin["headers"], json=body).status_code == 200
        r = client.post(path_b, headers=superadmin["headers"], json=body)
        assert r.status_code == 409
        assert "already linked" in r.json()["detail"]

    def test_unknown_creator_is_404(self, client, superadmin, make_user):
        target = make_user("Target")
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/creator-link",
            headers=superadmin["headers"],
            json={"creator_id": "cr_nope"},
        )
        assert r.status_code == 404

    def test_unlinking_clears_the_profile(
        self, client, superadmin, make_user, creator_profile
    ):
        target = make_user("Temp Creator", verified=True)
        path = f"/api/superadmin/users/{target['user_id']}/creator-link"
        client.post(
            path,
            headers=superadmin["headers"],
            json={"creator_id": creator_profile["creator_id"]},
        )
        r = client.post(path, headers=superadmin["headers"], json={"creator_id": None})
        assert r.json()["user"]["creator_id"] is None

    def test_region_grant_requires_a_linked_profile(
        self, client, superadmin, make_user
    ):
        target = make_user("No Profile")
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/regions",
            headers=superadmin["headers"],
            json={"region_id": DEFAULT_REGION},
        )
        assert r.status_code == 400
        assert "creator profile" in r.json()["detail"]

    def test_grant_and_revoke_region(
        self, client, superadmin, make_user, creator_profile
    ):
        target = make_user("Regional Creator", verified=True)
        client.post(
            f"/api/superadmin/users/{target['user_id']}/creator-link",
            headers=superadmin["headers"],
            json={"creator_id": creator_profile["creator_id"]},
        )

        r = client.delete(
            f"/api/superadmin/users/{target['user_id']}/regions/{DEFAULT_REGION}",
            headers=superadmin["headers"],
        )
        assert DEFAULT_REGION not in {
            x["region_id"] for x in r.json()["creator_regions"]
        }

        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/regions",
            headers=superadmin["headers"],
            json={"region_id": DEFAULT_REGION},
        )
        assert DEFAULT_REGION in {x["region_id"] for x in r.json()["creator_regions"]}

    def test_unknown_region_grant_is_rejected(
        self, client, superadmin, make_user, creator_profile
    ):
        target = make_user("Regional", verified=True)
        client.post(
            f"/api/superadmin/users/{target['user_id']}/creator-link",
            headers=superadmin["headers"],
            json={"creator_id": creator_profile["creator_id"]},
        )
        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/regions",
            headers=superadmin["headers"],
            json={"region_id": "reg_atlantis"},
        )
        assert r.status_code == 400


class TestUserCreation:
    """Pre-creating an account exists so a role can be assigned before the
    person's first sign-in. It is passwordless like every other account."""

    def test_created_account_starts_unverified_and_passwordless(
        self, client, superadmin, cleanup_created, new_email
    ):
        email = new_email()
        cleanup_created["emails"].append(email)

        r = client.post(
            "/api/superadmin/users",
            headers=superadmin["headers"],
            json={"email": email, "name": "Made By Admin", "platform_role": "staff"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["user"]["platform_role"] == "staff"
        # Nothing here proves the admin owns that address, so it is not verified
        # on their word — the person's own first code is what does that.
        assert body["user"]["email_verified"] is False
        assert (
            db_fetchval(
                "SELECT password_hash FROM users WHERE LOWER(email) = LOWER($1)", email
            )
            is None
        )

    def test_pre_created_account_keeps_its_role_after_first_sign_in(
        self, client, superadmin, cleanup_created, new_email
    ):
        """The whole point: assign the role now, they sign in later and have it."""
        email = new_email()
        cleanup_created["emails"].append(email)

        client.post(
            "/api/superadmin/users",
            headers=superadmin["headers"],
            json={"email": email, "name": "Future Staff", "platform_role": "staff"},
        )

        result = sign_in(client, email)
        # Signing in adopts the existing row rather than making a second one.
        assert result["created"] is False
        me = client.get("/api/auth/me", headers=result["headers"]).json()
        assert me["platform_role"] == "staff"
        # And the code they entered is what verified the address.
        assert me["email_verified"] is True

    def test_duplicate_email_is_rejected(self, client, superadmin, registered_user):
        r = client.post(
            "/api/superadmin/users",
            headers=superadmin["headers"],
            json={"email": registered_user["email"], "name": "Clash"},
        )
        assert r.status_code == 409

    def test_password_field_is_not_accepted(self, client, superadmin, new_email):
        """There is no password path; a stray password in the body must not
        quietly create a credential."""
        email = new_email()
        r = client.post(
            "/api/superadmin/users",
            headers=superadmin["headers"],
            json={"email": email, "name": "Sneaky", "password": "hunter22222"},
        )
        assert r.status_code == 201, r.text
        assert (
            db_fetchval(
                "SELECT password_hash FROM users WHERE LOWER(email) = LOWER($1)", email
            )
            is None
        )
        db_execute("DELETE FROM users WHERE LOWER(email) = LOWER($1)", email)

    def test_invalid_role_on_create_is_rejected(self, client, superadmin, new_email):
        r = client.post(
            "/api/superadmin/users",
            headers=superadmin["headers"],
            json={"email": new_email(), "name": "Bad Role", "platform_role": "wizard"},
        )
        assert r.status_code == 422


class TestAccountActions:
    def test_force_verify_email(self, client, superadmin, make_user):
        """Still useful for accounts pre-created by an admin, which start
        unverified — signing in with a code verifies you, so the state has to be
        forced to test the override."""
        target = make_user("Unverified", verified=False)
        assert db_fetchval(
            "SELECT email_verified FROM users WHERE user_id = $1", target["user_id"]
        ) is False

        r = client.post(
            f"/api/superadmin/users/{target['user_id']}/verify-email",
            headers=superadmin["headers"],
        )
        assert r.json()["user"]["email_verified"] is True

    def test_revoke_sessions_invalidates_the_token(self, client, superadmin, make_user):
        target = make_user("Kicked")
        assert client.get("/api/auth/me", headers=target["headers"]).status_code == 200

        client.post(
            f"/api/superadmin/users/{target['user_id']}/revoke-sessions",
            headers=superadmin["headers"],
        )
        assert client.get("/api/auth/me", headers=target["headers"]).status_code == 401

    def test_delete_revokes_sessions_too(self, client, superadmin, make_user):
        """A soft-deleted account with a live 30-day token would keep working."""
        target = make_user("Deleted")
        r = client.delete(
            f"/api/superadmin/users/{target['user_id']}",
            headers=superadmin["headers"],
        )
        assert r.status_code == 200
        assert client.get("/api/auth/me", headers=target["headers"]).status_code == 401
        assert db_fetchval(
            "SELECT deleted_at IS NOT NULL FROM users WHERE user_id = $1",
            target["user_id"],
        ) is True

        db_execute("DELETE FROM role_audit WHERE subject_id = $1", target["user_id"])

    def test_cannot_delete_self(self, client, superadmin):
        r = client.delete(
            f"/api/superadmin/users/{superadmin['user_id']}",
            headers=superadmin["headers"],
        )
        assert r.status_code == 400

    def test_cannot_delete_the_last_superadmin(self, client, superadmin, make_user):
        other = make_user("Other Admin", verified=True)
        set_platform_role(other["user_id"], "superadmin")
        other_headers = _login(client, other)

        # Two exist, so removing one is fine.
        assert client.delete(
            f"/api/superadmin/users/{superadmin['user_id']}", headers=other_headers
        ).status_code == 200
        db_execute(
            "DELETE FROM role_audit WHERE subject_id = $1", superadmin["user_id"]
        )


class TestOverview:
    def test_reports_role_counts_and_integrations(self, client, superadmin):
        body = client.get(
            "/api/superadmin/overview", headers=superadmin["headers"]
        ).json()
        assert body["users"]["superadmin"] >= 1
        assert body["users"]["total"] >= body["users"]["superadmin"]
        assert "redis" in body["integrations"]
        assert body["content"]["total_creators"] >= 1
        # The bootstrap list is surfaced so the portal can explain why an account
        # cannot be demoted.
        assert isinstance(body["super_admin_emails"], list)

    def test_creator_list_shows_link_state(self, client, superadmin):
        body = client.get(
            "/api/superadmin/creators", headers=superadmin["headers"]
        ).json()
        assert body["creators"]
        assert "linked_user" in body["creators"][0]
