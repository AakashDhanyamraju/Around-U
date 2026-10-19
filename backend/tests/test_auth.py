"""Passwordless authentication: email OTP and the Google entry point.

The security-relevant assertions here are the ones about what the endpoints
*don't* do — leak whether an address has an account, accept a stale or reused
code, or allow unlimited guesses at a 6-digit number.
"""

import pytest

from app.config import settings
from tests.conftest import db_execute, db_fetchval, purge_users, request_code, sign_in


@pytest.fixture
def throwaway(new_email):
    """An address plus cleanup, for tests that sign in mid-body."""
    email = new_email()
    yield email
    user_id = db_fetchval(
        "SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)", email
    )
    if user_id:
        purge_users([user_id])
    db_execute("DELETE FROM auth_codes WHERE LOWER(email) = LOWER($1)", email)


class TestPasswordIsGone:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("post", "/api/auth/register"),
            ("post", "/api/auth/login"),
            ("post", "/api/auth/forgot-password"),
            ("post", "/api/auth/reset-password"),
            ("post", "/api/auth/change-password"),
            ("post", "/api/auth/resend-verification"),
            ("get", "/api/auth/verify-email"),
        ],
    )
    def test_password_endpoints_no_longer_exist(self, client, method, path):
        """Removed, not merely hidden — a dormant password path is a credential
        nobody remembers to rotate."""
        # GET takes no body; only POST needs one to get past request parsing.
        kwargs = {"json": {}} if method == "post" else {}
        assert getattr(client, method)(path, **kwargs).status_code == 404

    def test_providers_reports_password_disabled(self, client):
        body = client.get("/api/auth/providers").json()
        assert body["password"] is False
        assert body["email_otp"] is True


class TestOtpRequest:
    def test_returns_a_code_outside_production(self, client, throwaway):
        r = client.post("/api/auth/otp/request", json={"email": throwaway})
        assert r.status_code == 200
        body = r.json()
        assert len(body["dev_code"]) == settings.otp_length
        assert body["dev_code"].isdigit()
        assert body["expires_in_minutes"] == settings.otp_ttl_minutes

    def test_response_does_not_reveal_whether_the_account_exists(
        self, client, registered_user, new_email
    ):
        """Same shape and wording either way, or this becomes an account oracle."""
        unknown = new_email()
        known = client.post(
            "/api/auth/otp/request", json={"email": registered_user["email"]}
        ).json()
        fresh = client.post("/api/auth/otp/request", json={"email": unknown}).json()

        assert known.keys() == fresh.keys()
        # Normalise the address out; what's left must be identical wording.
        assert known["detail"].replace(registered_user["email"], "X") == fresh[
            "detail"
        ].replace(unknown, "X")

        db_execute("DELETE FROM auth_codes WHERE LOWER(email) = LOWER($1)", unknown)

    def test_the_code_is_never_stored_in_plaintext(self, client, throwaway):
        """This table is the likeliest one to end up in a backup or a screenshot."""
        code = request_code(client, throwaway)
        stored = db_fetchval(
            "SELECT code_hash FROM auth_codes WHERE LOWER(email) = LOWER($1) "
            "ORDER BY created_at DESC LIMIT 1",
            throwaway,
        )
        assert stored != code
        assert code not in stored
        assert stored.startswith("$2")  # bcrypt

    def test_requesting_again_invalidates_the_previous_code(self, client, throwaway):
        """Several live codes at once would multiply an attacker's chances."""
        first = request_code(client, throwaway)
        second = request_code(client, throwaway)
        assert first != second

        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": first}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": second}
            ).status_code
            == 200
        )

    def test_request_is_throttled_per_address(self, client, throwaway):
        """Otherwise the endpoint is a free mail cannon aimed at any address."""
        for _ in range(settings.otp_max_requests_per_window):
            assert (
                client.post(
                    "/api/auth/otp/request", json={"email": throwaway}
                ).status_code
                == 200
            )

        r = client.post("/api/auth/otp/request", json={"email": throwaway})
        assert r.status_code == 429
        assert "too many" in r.json()["detail"].lower()

    def test_malformed_email_is_rejected(self, client):
        assert (
            client.post(
                "/api/auth/otp/request", json={"email": "not-an-email"}
            ).status_code
            == 422
        )


class TestOtpVerify:
    def test_signing_in_creates_a_verified_account(self, client, throwaway):
        """Entering the code IS the proof of ownership, so there is no separate
        confirmation step and no unverified window."""
        result = sign_in(client, throwaway, "Fresh Person")
        assert result["created"] is True

        assert (
            db_fetchval(
                "SELECT email_verified FROM users WHERE user_id = $1",
                result["user_id"],
            )
            is True
        )
        # And no password was set anywhere along the way.
        assert (
            db_fetchval(
                "SELECT password_hash FROM users WHERE user_id = $1",
                result["user_id"],
            )
            is None
        )

    def test_second_sign_in_reuses_the_account(self, client, throwaway):
        first = sign_in(client, throwaway, "Returning")
        second = sign_in(client, throwaway)
        assert second["created"] is False
        assert second["user_id"] == first["user_id"]

    def test_name_is_derived_from_the_address_when_absent(self, client, throwaway):
        result = sign_in(client, throwaway)
        assert db_fetchval(
            "SELECT name FROM users WHERE user_id = $1", result["user_id"]
        ) == throwaway.split("@")[0]

    def test_session_works_immediately(self, client, throwaway):
        result = sign_in(client, throwaway)
        me = client.get("/api/auth/me", headers=result["headers"])
        assert me.status_code == 200
        assert me.json()["email"] == throwaway

    def test_wrong_code_is_rejected_and_creates_nothing(self, client, throwaway):
        request_code(client, throwaway)
        r = client.post(
            "/api/auth/otp/verify", json={"email": throwaway, "code": "000000"}
        )
        assert r.status_code == 401
        assert (
            db_fetchval(
                "SELECT COUNT(*) FROM users WHERE LOWER(email) = LOWER($1)", throwaway
            )
            == 0
        )

    def test_code_cannot_be_reused(self, client, throwaway):
        code = request_code(client, throwaway)
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": code}
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": code}
            ).status_code
            == 401
        )

    def test_guesses_are_capped(self, client, throwaway):
        """A 6-digit code with unlimited guesses is only ~10^6 attempts, and the
        Redis limiter fails open — so the counter lives on the row."""
        code = request_code(client, throwaway)

        for _ in range(settings.otp_max_attempts):
            assert (
                client.post(
                    "/api/auth/otp/verify",
                    json={"email": throwaway, "code": "999999"},
                ).status_code
                == 401
            )

        # Budget spent: the code is burned, so even the correct one fails now.
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": code}
            ).status_code
            == 401
        )
        assert (
            db_fetchval(
                "SELECT consumed_at IS NOT NULL FROM auth_codes "
                "WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1",
                throwaway,
            )
            is True
        )

    def test_expired_code_is_rejected(self, client, throwaway):
        code = request_code(client, throwaway)
        db_execute(
            "UPDATE auth_codes SET expires_at = NOW() - INTERVAL '1 minute' "
            "WHERE LOWER(email) = LOWER($1)",
            throwaway,
        )
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": code}
            ).status_code
            == 401
        )

    def test_code_is_bound_to_the_address(self, client, throwaway, new_email):
        """A code issued for one address must not work for another."""
        other = new_email()
        code = request_code(client, throwaway)

        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": other, "code": code}
            ).status_code
            == 401
        )
        db_execute("DELETE FROM auth_codes WHERE LOWER(email) = LOWER($1)", other)

    def test_every_failure_gives_the_same_message(self, client, throwaway, new_email):
        """Wrong, expired and never-issued must be indistinguishable."""
        unknown = new_email()
        never_issued = client.post(
            "/api/auth/otp/verify", json={"email": unknown, "code": "123456"}
        )
        request_code(client, throwaway)
        wrong = client.post(
            "/api/auth/otp/verify", json={"email": throwaway, "code": "000000"}
        )

        assert never_issued.status_code == wrong.status_code == 401
        assert never_issued.json()["detail"] == wrong.json()["detail"]

    def test_formatting_in_the_code_is_tolerated(self, client, throwaway):
        """People paste '123 456' or '123-456' out of their mail client."""
        code = request_code(client, throwaway)
        spaced = f"{code[:3]} {code[3:]}"
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": spaced}
            ).status_code
            == 200
        )

    def test_non_numeric_code_is_rejected(self, client, throwaway):
        assert (
            client.post(
                "/api/auth/otp/verify", json={"email": throwaway, "code": "abcdef"}
            ).status_code
            == 422
        )


class TestGoogleEntryPoint:
    def test_unconfigured_server_says_so(self, client):
        """Supabase credentials are not set in this environment, so the endpoint
        must fail legibly rather than obscurely."""
        r = client.post("/api/auth/google", json={"access_token": "x" * 20})
        assert r.status_code in (401, 503)
        if r.status_code == 503:
            assert "not configured" in r.json()["detail"].lower()

    def test_missing_token_is_rejected(self, client):
        assert client.post("/api/auth/google", json={}).status_code == 422

    def test_providers_advertises_google_state(self, client):
        body = client.get("/api/auth/providers").json()
        assert body["google"] is settings.supabase_auth_configured


class TestSession:
    def test_me_requires_a_token(self, client):
        assert client.get("/api/auth/me").status_code == 401

    def test_me_rejects_a_forged_token(self, client):
        assert (
            client.get(
                "/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
            ).status_code
            == 401
        )

    def test_me_returns_the_role_for_ui_gating(self, client, registered_user):
        body = client.get("/api/auth/me", headers=registered_user["headers"]).json()
        assert body["platform_role"] == "user"
        assert body["email_verified"] is True

    def test_logout_invalidates_the_session(self, client, registered_user):
        assert (
            client.post(
                "/api/auth/logout", headers=registered_user["headers"]
            ).status_code
            == 200
        )
        assert (
            client.get("/api/auth/me", headers=registered_user["headers"]).status_code
            == 401
        )

    def test_logout_without_a_token_is_still_ok(self, client):
        """Never leave the client stuck unable to sign out."""
        assert client.post("/api/auth/logout").status_code == 200

    def test_sign_out_everywhere_drops_every_session(self, client, throwaway):
        """The only self-service remedy for a lost device, now that there is no
        password to change."""
        first = sign_in(client, throwaway)
        second = sign_in(client, throwaway)

        assert (
            client.post(
                "/api/auth/sign-out-everywhere", headers=second["headers"]
            ).status_code
            == 200
        )
        assert client.get("/api/auth/me", headers=first["headers"]).status_code == 401
        assert client.get("/api/auth/me", headers=second["headers"]).status_code == 401
