"""Spots, appreciation and per-region rank.

Most of what is worth testing here is a *rule*, not a CRUD path: the 60-second
attribution delay, the 7-day trust gate, the per-region weekly budget, and the
promise that a moderator hiding a spot never costs the finder a tier. Those all
need rows in the past, which is what the `backdate_*` helpers in conftest exist
for.
"""

import pytest

from tests.conftest import (
    DEFAULT_REGION,
    backdate_appreciation,
    backdate_spot,
    backdate_visit,
    db_execute,
    db_fetchval,
    set_account_age,
    set_platform_role,
)


@pytest.fixture
def finder(make_user):
    """A settled account — old enough that its own visits clear the trust gate."""
    user = make_user("Ana Finder")
    set_account_age(user["user_id"], 30)
    return user


@pytest.fixture
def visitor(make_user):
    user = make_user("Bo Visitor")
    set_account_age(user["user_id"], 30)
    return user


@pytest.fixture
def staff_user(make_user):
    user = make_user("Staff Member")
    set_platform_role(user["user_id"], "staff")
    return user


def _went(client, spot, user, *, age_seconds: int = 120):
    """Record a visit that actually counts.

    A visit inside the first minute of a spot's life is treated as the finder
    testing their own button, so the spot is aged first.
    """
    backdate_spot(spot["spot_id"], age_seconds)
    r = client.post(f"/api/spots/{spot['spot_id']}/visit", headers=user["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def _get(client, spot_id, user=None):
    headers = user["headers"] if user else {}
    r = client.get(f"/api/spots/{spot_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestSpotCreation:
    def test_requires_auth(self, client):
        assert client.post("/api/spots", json={}).status_code == 401

    def test_creates_with_caller_as_finder(self, client, finder, make_spot):
        spot = make_spot(finder, name="Rothko Chapel Bench")
        assert spot["finder_user_id"] == finder["user_id"]
        assert spot["name"] == "Rothko Chapel Bench"
        assert spot["status"] == "active"
        assert spot["is_quiet"] is False

    def test_unknown_region_is_rejected(self, client, finder):
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": "reg_nowhere",
                "name": "Nowhere Bench",
                "lat": 1.0,
                "lng": 1.0,
                "confirm_duplicate": True,
            },
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "Unknown region"

    def test_photos_arrive_with_the_spot(self, client, finder, make_spot):
        spot = make_spot(finder, photos=["https://example.com/a.jpg"])
        assert spot["photo_count"] == 1
        assert spot["hero_photo_url"] == "https://example.com/a.jpg"

    def test_daily_cap(self, client, finder, make_spot):
        for _ in range(5):
            make_spot(finder)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "One Too Many",
                "lat": 30.9,
                "lng": -96.9,
                "confirm_duplicate": True,
            },
        )
        assert r.status_code == 429

    def test_deleting_does_not_refund_the_daily_quota(self, client, finder, make_spot):
        # Otherwise delete-and-recreate is an unlimited allowance.
        spots = [make_spot(finder) for _ in range(5)]
        db_execute(
            "UPDATE spots SET deleted_at = NOW() WHERE spot_id = $1",
            spots[0]["spot_id"],
        )
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Still Too Many",
                "lat": 30.8,
                "lng": -96.8,
                "confirm_duplicate": True,
            },
        )
        assert r.status_code == 429


class TestDuplicateGuard:
    def test_same_name_nearby_is_offered_not_blocked(self, client, finder, make_spot):
        existing = make_spot(finder, name="Blue Bottle Coffee", lat=29.75, lng=-95.36)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Blue Bottle Coffee",
                "lat": 29.75002,
                "lng": -95.36002,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["created"] is False and body["duplicate"] is True
        assert body["candidates"][0]["spot_id"] == existing["spot_id"]
        # Nothing was written.
        assert db_fetchval(
            "SELECT COUNT(*) FROM spots WHERE name = 'Blue Bottle Coffee'"
        ) == 1

    def test_containment_counts_as_the_same_place(self, client, finder, make_spot):
        # "Blue Bottle" and "Blue Bottle Coffee Downtown" are one place.
        make_spot(finder, name="Blue Bottle Coffee Downtown", lat=29.71, lng=-95.31)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Blue Bottle",
                "lat": 29.71001,
                "lng": -95.31001,
            },
        )
        assert r.json()["duplicate"] is True

    def test_unrelated_name_at_the_same_spot_is_fine(self, client, finder, make_spot):
        make_spot(finder, name="Menil Collection", lat=29.72, lng=-95.32)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Rothko Chapel",
                "lat": 29.72001,
                "lng": -95.32001,
            },
        )
        assert r.status_code == 201

    def test_same_name_far_away_is_fine(self, client, finder, make_spot):
        make_spot(finder, name="Taco Truck", lat=29.73, lng=-95.33)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Taco Truck",
                "lat": 29.79,
                "lng": -95.39,
            },
        )
        assert r.status_code == 201

    def test_confirm_duplicate_forces_creation(self, client, finder, make_spot):
        make_spot(finder, name="Sabine Ledge", lat=29.74, lng=-95.34)
        r = client.post(
            "/api/spots",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "name": "Sabine Ledge",
                "lat": 29.74001,
                "lng": -95.34001,
                "confirm_duplicate": True,
            },
        )
        assert r.status_code == 201
        db_execute("DELETE FROM spots WHERE spot_id = $1", r.json()["spot_id"])

    def test_a_quiet_spot_is_still_offered_as_a_candidate(
        self, client, finder, make_spot
    ):
        # Adding your photo to someone's quiet spot is exactly right.
        quiet = make_spot(finder, name="Secret Ledge", lat=29.78, lng=-95.38)
        client.post(
            f"/api/spots/{quiet['spot_id']}/quiet",
            headers=finder["headers"],
            json={"is_quiet": True},
        )
        r = client.post(
            "/api/spots/duplicates",
            headers=finder["headers"],
            json={
                "region_id": DEFAULT_REGION,
                "lat": 29.78001,
                "lng": -95.38001,
                "name": "Secret Ledge",
            },
        )
        assert [c["spot_id"] for c in r.json()["candidates"]] == [quiet["spot_id"]]


class TestSpotPermissions:
    def test_finder_edits_the_three_allowed_fields(self, client, finder, make_spot):
        spot = make_spot(finder)
        r = client.patch(
            f"/api/spots/{spot['spot_id']}",
            headers=finder["headers"],
            json={"name": "Renamed Spot", "blurb": "better", "best_time": "Dusk"},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed Spot"
        assert r.json()["best_time"] == "Dusk"

    def test_renaming_moves_the_search_form_with_it(self, client, finder, make_spot):
        spot = make_spot(finder)
        client.patch(
            f"/api/spots/{spot['spot_id']}",
            headers=finder["headers"],
            json={"name": "Café Brasil Patio"},
        )
        assert (
            db_fetchval(
                "SELECT name_normalised FROM spots WHERE spot_id = $1",
                spot["spot_id"],
            )
            == "cafe brasil patio"
        )

    def test_stranger_cannot_edit(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        r = client.patch(
            f"/api/spots/{spot['spot_id']}",
            headers=visitor["headers"],
            json={"name": "Hijacked Name"},
        )
        assert r.status_code == 403

    def test_staff_can_edit(self, client, finder, staff_user, make_spot):
        spot = make_spot(finder)
        r = client.patch(
            f"/api/spots/{spot['spot_id']}",
            headers=staff_user["headers"],
            json={"blurb": "moderated"},
        )
        assert r.status_code == 200

    def test_quiet_cannot_be_smuggled_through_patch(self, client, finder, make_spot):
        spot = make_spot(finder)
        r = client.patch(
            f"/api/spots/{spot['spot_id']}",
            headers=finder["headers"],
            json={"name": "Renamed", "is_quiet": True},
        )
        assert r.status_code == 200
        assert r.json()["is_quiet"] is False

    def test_empty_patch_is_rejected(self, client, finder, make_spot):
        spot = make_spot(finder)
        r = client.patch(
            f"/api/spots/{spot['spot_id']}", headers=finder["headers"], json={}
        )
        assert r.status_code == 400

    def test_staff_cannot_toggle_quiet(self, client, finder, staff_user, make_spot):
        # The matrix gives staff no say here: keeping a place quiet is the
        # finder's judgement, not a moderation decision.
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/quiet",
            headers=staff_user["headers"],
            json={"is_quiet": True},
        )
        assert r.status_code == 403

    def test_un_quieting_is_allowed_exactly_once(self, client, finder, make_spot):
        spot = make_spot(finder)
        h = finder["headers"]
        sid = spot["spot_id"]
        assert client.post(f"/api/spots/{sid}/quiet", headers=h, json={"is_quiet": True}).status_code == 200
        assert client.post(f"/api/spots/{sid}/quiet", headers=h, json={"is_quiet": False}).status_code == 200
        assert client.post(f"/api/spots/{sid}/quiet", headers=h, json={"is_quiet": True}).status_code == 200
        # Second un-quiet: the anti-farming guard.
        r = client.post(f"/api/spots/{sid}/quiet", headers=h, json={"is_quiet": False})
        assert r.status_code == 409

    def test_finder_and_staff_can_close_a_stranger_cannot(
        self, client, finder, visitor, staff_user, make_spot
    ):
        spot = make_spot(finder)
        sid = spot["spot_id"]
        assert client.post(
            f"/api/spots/{sid}/status", headers=visitor["headers"],
            json={"status": "closed"},
        ).status_code == 403
        assert client.post(
            f"/api/spots/{sid}/status", headers=finder["headers"],
            json={"status": "closed"},
        ).status_code == 200
        assert client.post(
            f"/api/spots/{sid}/status", headers=staff_user["headers"],
            json={"status": "active"},
        ).status_code == 200

    def test_only_staff_can_hide(self, client, finder, staff_user, make_spot):
        spot = make_spot(finder)
        sid = spot["spot_id"]
        assert client.post(
            f"/api/spots/{sid}/hide", headers=finder["headers"], json={}
        ).status_code == 403
        assert client.post(
            f"/api/spots/{sid}/hide", headers=staff_user["headers"],
            json={"reason": "spam"},
        ).status_code == 200
        # Hidden is a 404 for everyone but staff — not a 403, which would
        # confirm it exists.
        assert client.get(f"/api/spots/{sid}").status_code == 404
        assert client.get(
            f"/api/spots/{sid}", headers=staff_user["headers"]
        ).status_code == 200


class TestVisitsAndAttribution:
    def test_requires_auth(self, client, finder, make_spot):
        spot = make_spot(finder)
        assert client.post(f"/api/spots/{spot['spot_id']}/visit").status_code == 401

    def test_visiting_twice_records_one_visit(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        body = _went(client, spot, visitor)
        assert body["visits_attributed_total"] == 1

    def test_the_finders_own_visit_is_not_discovery(self, client, finder, make_spot):
        spot = make_spot(finder)
        body = _went(client, spot, finder)
        assert body["visits_attributed_total"] == 0

    def test_a_visit_inside_the_first_minute_does_not_count(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/visit", headers=visitor["headers"]
        )
        assert r.json()["visits_attributed_total"] == 0

    def test_unmarking_a_visit(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        r = client.delete(
            f"/api/spots/{spot['spot_id']}/visit", headers=visitor["headers"]
        )
        assert r.json()["visits_attributed_total"] == 0

    def test_confirming_twice_counts_one_person(self, client, finder, visitor, make_spot):
        # An append-only log here would be the cheapest farm in the feature.
        spot = make_spot(finder)
        client.post(f"/api/spots/{spot['spot_id']}/confirm", headers=visitor["headers"])
        r = client.post(
            f"/api/spots/{spot['spot_id']}/confirm", headers=visitor["headers"]
        )
        assert r.json()["confirmations_30d"] == 1


class TestAppreciation:
    def test_cannot_appreciate_your_own_spot(self, client, finder, make_spot):
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/appreciate", headers=finder["headers"]
        )
        assert r.status_code == 403

    def test_twice_costs_one_unit(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        r = client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert r.json()["appreciation_count"] == 1
        assert r.json()["appreciation_budget"]["used"] == 1

    def test_budget_runs_out_at_five(self, client, finder, visitor, make_spot, make_user):
        # Spread across two finders: one account may only add five spots a day,
        # and six are needed to push past the weekly appreciation budget.
        second_finder = make_user("Cass Finder")
        spots = [make_spot(finder) for _ in range(5)]
        spots.append(make_spot(second_finder))
        h = visitor["headers"]
        for s in spots[:5]:
            assert client.post(
                f"/api/spots/{s['spot_id']}/appreciate", headers=h
            ).status_code == 200
        r = client.post(f"/api/spots/{spots[5]['spot_id']}/appreciate", headers=h)
        # 409, not 429: a product rule to render, not a throttle to retry.
        assert r.status_code == 409

    def test_the_week_resets_on_a_monday_in_the_regions_own_timezone(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/appreciate", headers=visitor["headers"]
        )
        budget = r.json()["appreciation_budget"]
        week_start = db_fetchval(
            "SELECT to_char(date_trunc('week', NOW() AT TIME ZONE r.timezone), "
            "'Dy') FROM regions r WHERE r.region_id = $1",
            DEFAULT_REGION,
        )
        assert week_start == "Mon"
        assert budget["resets_at"] > budget["week_start"]

    def test_revoking_inside_a_minute_refunds(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        r = client.delete(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert r.json()["refunded"] is True
        assert r.json()["appreciation_budget"]["remaining"] == 5

    def test_revoking_after_a_minute_does_not(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        backdate_appreciation(spot["spot_id"], visitor["user_id"], 120)
        r = client.delete(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert r.json()["refunded"] is False
        assert r.json()["appreciation_budget"]["used"] == 1

    def test_re_appreciating_an_unrefunded_revoke_is_free(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        backdate_appreciation(spot["spot_id"], visitor["user_id"], 120)
        client.delete(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        r = client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert r.json()["appreciation_budget"]["used"] == 1

    def test_budget_is_on_every_spot_fetch_and_null_for_guests(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        assert _get(client, spot["spot_id"])["appreciation_budget"] is None
        signed_in = _get(client, spot["spot_id"], visitor)
        assert signed_in["appreciation_budget"]["remaining"] == 5

    def test_viewer_appreciated_flips_both_ways(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        h = visitor["headers"]
        assert _get(client, spot["spot_id"], visitor)["spot"]["viewer_appreciated"] is False
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert _get(client, spot["spot_id"], visitor)["spot"]["viewer_appreciated"] is True
        client.delete(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        assert _get(client, spot["spot_id"], visitor)["spot"]["viewer_appreciated"] is False


class TestRanking:
    def test_guests_can_browse(self, client, finder, make_spot):
        make_spot(finder)
        r = client.get(f"/api/spots?region_id={DEFAULT_REGION}")
        assert r.status_code == 200
        assert "spots" in r.json()

    def test_quiet_closed_and_hidden_are_excluded(
        self, client, finder, staff_user, make_spot
    ):
        quiet = make_spot(finder, name="Quiet One")
        closed = make_spot(finder, name="Closed One")
        hidden = make_spot(finder, name="Hidden One")
        client.post(
            f"/api/spots/{quiet['spot_id']}/quiet",
            headers=finder["headers"], json={"is_quiet": True},
        )
        client.post(
            f"/api/spots/{closed['spot_id']}/status",
            headers=finder["headers"], json={"status": "closed"},
        )
        client.post(
            f"/api/spots/{hidden['spot_id']}/hide",
            headers=staff_user["headers"], json={},
        )
        listed = {
            s["spot_id"]
            for s in client.get(
                f"/api/spots?region_id={DEFAULT_REGION}&limit=100"
            ).json()["spots"]
        }
        assert quiet["spot_id"] not in listed
        assert closed["spot_id"] not in listed
        assert hidden["spot_id"] not in listed

    def test_search_does_surface_a_quiet_spot(self, client, finder, make_spot):
        quiet = make_spot(finder, name="Hidden Bayou Ledge")
        client.post(
            f"/api/spots/{quiet['spot_id']}/quiet",
            headers=finder["headers"], json={"is_quiet": True},
        )
        r = client.get(
            f"/api/spots?region_id={DEFAULT_REGION}&q=hidden bayou ledge&limit=50"
        )
        assert quiet["spot_id"] in {s["spot_id"] for s in r.json()["spots"]}

    def test_more_visits_ranks_higher(self, client, finder, make_spot, make_user):
        popular = make_spot(finder, name="Popular Ledge")
        quiet = make_spot(finder, name="Unvisited Ledge")
        for _ in range(3):
            u = make_user("Visitor")
            set_account_age(u["user_id"], 30)
            _went(client, popular, u)

        rows = client.get(
            f"/api/spots?region_id={DEFAULT_REGION}&limit=100"
        ).json()["spots"]
        by_id = {s["spot_id"]: s for s in rows}
        assert by_id[popular["spot_id"]]["score"] > by_id[quiet["spot_id"]]["score"]
        assert by_id[popular["spot_id"]]["visits_attributed_total"] == 3

    def test_an_untrusted_appreciation_shows_but_does_not_score(
        self, client, finder, make_spot, make_user
    ):
        spot = make_spot(finder)
        fresh = make_user("Brand New")
        set_account_age(fresh["user_id"], 1)
        client.post(
            f"/api/spots/{spot['spot_id']}/appreciate", headers=fresh["headers"]
        )

        row = next(
            s
            for s in client.get(
                f"/api/spots?region_id={DEFAULT_REGION}&limit=100"
            ).json()["spots"]
            if s["spot_id"] == spot["spot_id"]
        )
        # Counted for display, excluded from rank — the whole point of the split.
        assert row["appreciation_count"] == 1
        assert row["score"] == 0.0

    def test_an_appreciation_from_someone_who_never_visited_does_not_score(
        self, client, finder, make_spot, make_user
    ):
        spot = make_spot(finder)
        old_but_idle = make_user("Old Lurker")
        set_account_age(old_but_idle["user_id"], 60)
        client.post(
            f"/api/spots/{spot['spot_id']}/appreciate",
            headers=old_but_idle["headers"],
        )
        row = next(
            s
            for s in client.get(
                f"/api/spots?region_id={DEFAULT_REGION}&limit=100"
            ).json()["spots"]
            if s["spot_id"] == spot["spot_id"]
        )
        assert row["appreciation_count"] == 1
        assert row["score"] == 0.0

    def test_a_visit_older_than_90_days_leaves_the_score_but_not_the_total(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        # The spot has to predate the visit, or the 60-second attribution rule
        # discards it as a visit that happened before the place existed.
        _went(client, spot, visitor, age_seconds=200 * 86400)
        backdate_visit(spot["spot_id"], visitor["user_id"], 100)
        row = next(
            s
            for s in client.get(
                f"/api/spots?region_id={DEFAULT_REGION}&limit=100"
            ).json()["spots"]
            if s["spot_id"] == spot["spot_id"]
        )
        assert row["visits_attributed_total"] == 1
        assert row["visits_attributed_90d"] == 0
        assert row["score"] == 0.0

    def test_category_filter(self, client, finder, make_spot):
        food = make_spot(finder, category="Food")
        outdoor = make_spot(finder, category="Outdoor")
        rows = client.get(
            f"/api/spots?region_id={DEFAULT_REGION}&category=Food&limit=100"
        ).json()["spots"]
        ids = {s["spot_id"] for s in rows}
        assert food["spot_id"] in ids
        assert outdoor["spot_id"] not in ids

    def test_cold_start_flips_at_five(self, client, finder, make_spot):
        # Whatever the seed left behind, the flag must track the real count.
        made = []
        while True:
            body = client.get(f"/api/spots?region_id={DEFAULT_REGION}").json()
            if body["region_spot_count"] >= 5:
                assert body["cold_start"] is False
                break
            assert body["cold_start"] is True
            made.append(make_spot(finder))
            if len(made) > 8:  # pragma: no cover - safety valve
                pytest.fail("region never reached five spots")


class TestTier:
    def _rank(self, client, user):
        r = client.get(
            f"/api/me/rank?region_id={DEFAULT_REGION}", headers=user["headers"]
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_no_tier_at_zero(self, client, finder, make_spot):
        make_spot(finder)
        rank = self._rank(client, finder)
        # None, not "wanderer" — the client renders nothing rather than a badge.
        assert rank["tier"] is None
        assert rank["credited_spots"] == 0
        assert rank["next_tier"] == "wanderer"
        assert rank["spots_to_next"] == 1

    def test_one_visit_from_someone_else_is_wanderer(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        assert self._rank(client, finder)["tier"] == "wanderer"

    def test_the_finders_own_visit_does_not_count(self, client, finder, make_spot):
        spot = make_spot(finder)
        _went(client, spot, finder)
        assert self._rank(client, finder)["tier"] is None

    def test_a_fresh_accounts_visit_does_not_count(
        self, client, finder, make_spot, make_user
    ):
        spot = make_spot(finder)
        fresh = make_user("Day Old")
        set_account_age(fresh["user_id"], 1)
        _went(client, spot, fresh)
        assert self._rank(client, finder)["tier"] is None

    def test_three_credited_spots_is_scout(
        self, client, finder, make_spot, make_user
    ):
        for _ in range(3):
            spot = make_spot(finder)
            u = make_user("Visitor")
            set_account_age(u["user_id"], 30)
            _went(client, spot, u)
        rank = self._rank(client, finder)
        assert rank["credited_spots"] == 3
        assert rank["tier"] == "scout"

    def test_a_quiet_spot_earns_no_credit(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        assert self._rank(client, finder)["tier"] == "wanderer"
        client.post(
            f"/api/spots/{spot['spot_id']}/quiet",
            headers=finder["headers"], json={"is_quiet": True},
        )
        assert self._rank(client, finder)["tier"] is None

    def test_hiding_does_not_take_a_tier_away(
        self, client, finder, visitor, staff_user, make_spot
    ):
        # The promise: a moderator can stop a spot earning, but never demote
        # someone for what it already earned.
        spot = make_spot(finder)
        _went(client, spot, visitor)
        assert self._rank(client, finder)["tier"] == "wanderer"

        client.post(
            f"/api/spots/{spot['spot_id']}/hide",
            headers=staff_user["headers"], json={"reason": "checking"},
        )
        assert self._rank(client, finder)["tier"] == "wanderer"

    def test_a_hidden_spot_stops_earning_new_credit(
        self, client, finder, staff_user, make_spot, make_user
    ):
        spot = make_spot(finder)
        client.post(
            f"/api/spots/{spot['spot_id']}/hide",
            headers=staff_user["headers"], json={},
        )
        newcomer = make_user("Late Visitor")
        set_account_age(newcomer["user_id"], 30)
        backdate_spot(spot["spot_id"], 120)
        db_execute(
            "INSERT INTO spot_visits (spot_id, user_id) VALUES ($1, $2) "
            "ON CONFLICT DO NOTHING",
            spot["spot_id"],
            newcomer["user_id"],
        )
        assert self._rank(client, finder)["tier"] is None

    def test_un_hiding_restores_credit(
        self, client, finder, visitor, staff_user, make_spot
    ):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        client.post(
            f"/api/spots/{spot['spot_id']}/hide",
            headers=staff_user["headers"], json={},
        )
        client.post(
            f"/api/spots/{spot['spot_id']}/unhide", headers=staff_user["headers"]
        )
        assert self._rank(client, finder)["tier"] == "wanderer"

    def test_rank_is_per_region(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        other = db_fetchval(
            "SELECT region_id FROM regions WHERE region_id <> $1 "
            "AND deleted_at IS NULL LIMIT 1",
            DEFAULT_REGION,
        )
        if other is None:
            pytest.skip("only one region is seeded")
        r = client.get(
            f"/api/me/rank?region_id={other}", headers=finder["headers"]
        ).json()
        assert r["tier"] is None


class TestSavesAndLists:
    def test_save_and_unsave(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/save", headers=h)
        saved = client.get("/api/spots/saved", headers=h).json()["spots"]
        assert spot["spot_id"] in {s["spot_id"] for s in saved}
        assert _get(client, spot["spot_id"], visitor)["spot"]["viewer_saved"] is True

        client.delete(f"/api/spots/{spot['spot_id']}/save", headers=h)
        assert client.get("/api/spots/saved", headers=h).json()["spots"] == []

    def test_mine_includes_quiet_and_closed(self, client, finder, make_spot):
        spot = make_spot(finder)
        client.post(
            f"/api/spots/{spot['spot_id']}/quiet",
            headers=finder["headers"], json={"is_quiet": True},
        )
        mine = client.get("/api/spots/mine", headers=finder["headers"]).json()["spots"]
        assert spot["spot_id"] in {s["spot_id"] for s in mine}

    def test_visited_list(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        _went(client, spot, visitor)
        rows = client.get(
            "/api/spots/visited", headers=visitor["headers"]
        ).json()["spots"]
        assert spot["spot_id"] in {s["spot_id"] for s in rows}

    def test_these_lists_require_auth(self, client):
        for path in ("/api/spots/mine", "/api/spots/saved", "/api/spots/visited"):
            assert client.get(path).status_code == 401


class TestPhotos:
    def test_anyone_signed_in_can_add_one(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/photos",
            headers=visitor["headers"],
            json={"url": "https://example.com/p.jpg", "caption": "nice"},
        )
        assert r.status_code == 201
        assert r.json()["author_name"] == "Bo Visitor"

    def test_guests_cannot(self, client, finder, make_spot):
        spot = make_spot(finder)
        r = client.post(
            f"/api/spots/{spot['spot_id']}/photos",
            json={"url": "https://example.com/p.jpg"},
        )
        assert r.status_code == 401

    def test_hiding_a_photo_promotes_the_next_one_as_hero(
        self, client, finder, staff_user, make_spot
    ):
        spot = make_spot(finder, photos=["https://example.com/1.jpg"])
        second = client.post(
            f"/api/spots/{spot['spot_id']}/photos",
            headers=finder["headers"],
            json={"url": "https://example.com/2.jpg"},
        ).json()
        first_id = db_fetchval(
            "SELECT spot_photo_id FROM spot_photos WHERE spot_id = $1 "
            "ORDER BY created_at LIMIT 1",
            spot["spot_id"],
        )
        client.post(
            f"/api/spot-photos/{first_id}/hide", headers=staff_user["headers"]
        )
        body = _get(client, spot["spot_id"])
        assert body["spot"]["hero_photo_url"] == "https://example.com/2.jpg"
        assert {p["spot_photo_id"] for p in body["photos"]} == {second["spot_photo_id"]}

    def test_only_the_uploader_or_staff_can_remove(
        self, client, finder, visitor, staff_user, make_spot
    ):
        spot = make_spot(finder)
        photo = client.post(
            f"/api/spots/{spot['spot_id']}/photos",
            headers=visitor["headers"],
            json={"url": "https://example.com/p.jpg"},
        ).json()
        pid = photo["spot_photo_id"]
        assert client.delete(
            f"/api/spot-photos/{pid}", headers=finder["headers"]
        ).status_code == 403
        assert client.delete(
            f"/api/spot-photos/{pid}", headers=visitor["headers"]
        ).status_code == 200


class TestNotifications:
    def _inbox(self, client, user):
        r = client.get("/api/notifications", headers=user["headers"])
        assert r.status_code == 200, r.text
        return r.json()

    def test_requires_auth(self, client):
        assert client.get("/api/notifications").status_code == 401

    def test_appreciating_notifies_the_finder_once(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        h = visitor["headers"]
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        client.delete(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)
        client.post(f"/api/spots/{spot['spot_id']}/appreciate", headers=h)

        rows = [
            n
            for n in self._inbox(client, finder)["notifications"]
            if n["target_id"] == spot["spot_id"] and n["type"] == "spot_appreciated"
        ]
        assert len(rows) == 1
        assert rows[0]["actor_name"] == "Bo Visitor"
        assert rows[0]["data"]["spot_name"] == spot["name"]

    def test_two_visits_the_same_day_collapse_into_one_row(
        self, client, finder, make_spot, make_user
    ):
        spot = make_spot(finder)
        for _ in range(2):
            u = make_user("Visitor")
            set_account_age(u["user_id"], 30)
            _went(client, spot, u)

        rows = [
            n
            for n in self._inbox(client, finder)["notifications"]
            if n["target_id"] == spot["spot_id"] and n["type"] == "spot_visited"
        ]
        assert len(rows) == 1
        # Rolling, so the finder sees "2 people went" rather than a stale "1".
        assert rows[0]["data"]["count"] == 2

    def test_nobody_is_notified_about_their_own_action(
        self, client, finder, make_spot
    ):
        spot = make_spot(finder)
        _went(client, spot, finder)
        rows = [
            n
            for n in self._inbox(client, finder)["notifications"]
            if n["target_id"] == spot["spot_id"]
        ]
        assert rows == []

    def test_unread_count_and_mark_all(self, client, finder, visitor, make_spot):
        spot = make_spot(finder)
        client.post(
            f"/api/spots/{spot['spot_id']}/appreciate", headers=visitor["headers"]
        )
        assert client.get(
            "/api/notifications/unread-count", headers=finder["headers"]
        ).json()["unread_count"] >= 1

        client.post("/api/notifications/read-all", headers=finder["headers"])
        assert client.get(
            "/api/notifications/unread-count", headers=finder["headers"]
        ).json()["unread_count"] == 0

    def test_marking_someone_elses_notification_read_is_a_404(
        self, client, finder, visitor, make_spot
    ):
        spot = make_spot(finder)
        client.post(
            f"/api/spots/{spot['spot_id']}/appreciate", headers=visitor["headers"]
        )
        nid = self._inbox(client, finder)["notifications"][0]["notification_id"]
        assert client.post(
            f"/api/notifications/{nid}/read", headers=visitor["headers"]
        ).status_code == 404
        assert client.post(
            f"/api/notifications/{nid}/read", headers=finder["headers"]
        ).status_code == 200


class TestSpotReports:
    def test_a_spot_can_be_reported_and_reaches_the_staff_queue(
        self, client, finder, visitor, staff_user, make_spot
    ):
        spot = make_spot(finder)
        r = client.post(
            "/api/reports",
            headers=visitor["headers"],
            json={
                "target_type": "spot",
                "target_id": spot["spot_id"],
                "reason": "spam",
                "note": "not a real place",
            },
        )
        assert r.status_code == 201, r.text

        queue = client.get("/api/reports", headers=staff_user["headers"]).json()
        assert spot["spot_id"] in {
            row["target_id"] for row in queue["reports"]
        }
