"""Spots, appreciation and rank.

Two conventions carry most of the weight here.

Literal subpaths (`/spots/mine`, `/spots/saved`, `/spots/map`) are declared
before `/spots/{spot_id}`, or the path parameter swallows them.

Write paths depend on `get_current_user` rather than `optional_user`, so an
anonymous caller gets 401 instead of the 404 that resolving the spot first would
produce. Same reasoning as `permissions.authed_community_context`.
"""

from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status

from app import cache, permissions
from app.dependencies import get_current_user, optional_user
from app.models import (
    COLD_START_BELOW,
    PHOTOS_PER_DAY,
    SPOTS_PER_DAY,
    SpotCreate,
    SpotHideRequest,
    SpotPhotoCreate,
    SpotQuietUpdate,
    SpotStatusUpdate,
    SpotUpdate,
    next_tier_for,
    tier_for,
)
from app.repositories import regions, spots

router = APIRouter(tags=["spots"])

_RANK_CACHE_DEPTH = 200
_RANK_CACHE_TTL = 300


def _require_finder(spot: dict, user: dict, *, allow_staff: bool = True) -> None:
    """Spot authority is a two-way check, so it needs no dependency factory.

    `allow_staff=False` is what makes the quiet toggle finder-only. The
    permissions matrix gives staff no say over whether a place is kept quiet —
    that judgement belongs to the person who found it, and it is the easiest
    rule in this feature to get wrong.
    """
    if spot["finder_user_id"] == user["user_id"]:
        return
    if allow_staff and permissions.is_staff(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only the person who found this spot can do that.",
    )


async def _load_spot(spot_id: str, user: Optional[dict]) -> dict:
    """Resolve a spot, 404ing hidden ones for everybody but staff."""
    row = await spots.raw_by_id(spot_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Spot not found"
        )
    if row.get("hidden_at") is not None and not permissions.is_staff(user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Spot not found"
        )
    return row


async def _decorate(
    rows: list[dict], user: Optional[dict], region_id: Optional[str] = None
) -> list[dict]:
    """Attach the finder's tier and the viewer's own state to a batch of spots.

    Tiers are resolved for the distinct finder set in one query rather than a
    lateral per row: a ranked page of 30 usually has far fewer than 30 finders,
    and the tier aggregate is the most expensive thing in the payload.
    """
    if not rows:
        return rows

    scope = region_id or rows[0]["region_id"]
    finder_ids = list({r["finder_user_id"] for r in rows})
    credited = await spots.credited_spots_for(finder_ids, scope)

    flags: dict[str, dict] = {}
    if user is not None:
        flags = await spots.viewer_flags([r["spot_id"] for r in rows], user["user_id"])

    for row in rows:
        tier = tier_for(credited.get(row["finder_user_id"], 0))
        row["finder_tier"] = tier["tier"] if tier else None
        row["finder_tier_label"] = tier["tier_label"] if tier else None

        if user is None:
            # Null rather than false, so the client can tell "not signed in"
            # from "signed in and hasn't".
            row["viewer_visited"] = None
            row["viewer_appreciated"] = None
            row["viewer_saved"] = None
            row["viewer_confirmed"] = None
            row["viewer_is_finder"] = None
        else:
            f = flags.get(row["spot_id"], {})
            row["viewer_visited"] = bool(f.get("viewer_visited"))
            row["viewer_appreciated"] = bool(f.get("viewer_appreciated"))
            row["viewer_saved"] = bool(f.get("viewer_saved"))
            row["viewer_confirmed"] = bool(f.get("viewer_confirmed"))
            row["viewer_is_finder"] = row["finder_user_id"] == user["user_id"]
    return rows


async def _budget_or_none(user: Optional[dict], region_id: str) -> Optional[dict]:
    if user is None:
        return None
    return await spots.budget_for(user["user_id"], region_id)


# ---------- collections (declared before /spots/{spot_id}) ----------
@router.get("/spots")
async def list_spots(
    region_id: str = Query(..., min_length=1),
    category: Optional[str] = Query(None, max_length=60),
    sort: str = Query("rank", pattern="^(rank|new|near)$"),
    q: Optional[str] = Query(None, max_length=100),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=500),
    user: Optional[dict] = Depends(optional_user),
):
    """The ranked spot layer. Fully browsable signed out.

    Only the default ranked view is cached. Search and proximity are keyed by
    free-form input, so caching them would mint an unbounded number of keys for
    no hit rate.
    """
    near = (lat, lng) if sort == "near" and lat is not None and lng is not None else None
    cacheable = sort == "rank" and not q and offset + limit <= _RANK_CACHE_DEPTH

    rows: Optional[list[dict]] = None
    if cacheable:
        key = cache.spots_rank_key(region_id, category)
        cached = await cache.get_spots_json(key)
        if cached is None:
            page = await spots.list_spots(
                region_id=region_id,
                category=category,
                sort="rank",
                limit=_RANK_CACHE_DEPTH,
                offset=0,
            )
            cached = spots.json_safe(page)
            await cache.set_spots_json(key, cached, ttl=_RANK_CACHE_TTL)
        rows = [dict(r) for r in cached[offset : offset + limit]]

    if rows is None:
        rows = await spots.list_spots(
            region_id=region_id,
            category=category,
            sort=sort,
            search=q,
            near=near,
            # Search deliberately surfaces quiet and closed spots: they stay
            # findable by name, they are only kept out of the ranked list.
            include_quiet=bool(q),
            include_closed=bool(q),
            limit=limit,
            offset=offset,
        )

    await _decorate(rows, user, region_id)
    total = await spots.region_spot_count(region_id)
    return {
        "spots": rows,
        # The client must key cold start off this, not len(spots) — otherwise
        # typing in the search box flips the screen in and out of cold start.
        "region_spot_count": total,
        "cold_start": total < COLD_START_BELOW,
        "appreciation_budget": await _budget_or_none(user, region_id),
    }


@router.get("/spots/mine")
async def my_spots(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    """Spots I found — including the quiet, closed and hidden ones."""
    rows = await spots.spots_for_finder(user["user_id"], limit, offset)
    await _decorate(rows, user)
    return {"spots": rows}


@router.get("/spots/visited")
async def visited_spots(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    rows = await spots.spots_visited_by(user["user_id"], limit, offset)
    await _decorate(rows, user)
    return {"spots": rows}


@router.get("/spots/saved")
async def saved_spots(user: dict = Depends(get_current_user)):
    ids = await spots.saved_spot_ids(user["user_id"])
    rows = await spots.spots_by_ids(ids)
    await _decorate(rows, user)
    return {"spots": rows}


@router.post("/spots/duplicates")
async def check_duplicates(
    region_id: str = Body(..., embed=True),
    lat: float = Body(..., embed=True),
    lng: float = Body(..., embed=True),
    name: str = Body(..., embed=True),
    _user: dict = Depends(get_current_user),
):
    """What the create screen debounces against while you type."""
    return {"candidates": await spots.find_duplicates(region_id, lat, lng, name)}


@router.post("/spots", status_code=status.HTTP_201_CREATED)
async def create_spot(
    payload: SpotCreate,
    response: Response,
    user: dict = Depends(get_current_user),
):
    if not await regions.exists(payload.region_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )

    # Counted in Postgres over a rolling 24 hours, not Redis: the Redis limiter
    # fails open and hardcodes a 15-minute window, so it cannot express this.
    # `routers/auth.py` made the same call for the OTP throttle.
    if await spots.created_since(user["user_id"]) >= SPOTS_PER_DAY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"You can add up to {SPOTS_PER_DAY} spots a day. Try again tomorrow.",
        )

    if not payload.confirm_duplicate:
        candidates = await spots.find_duplicates(
            payload.region_id, payload.lat, payload.lng, payload.name
        )
        if candidates:
            # 200, not 409: the detail contract is "a readable sentence", and a
            # candidate array does not fit in one. `moderation.create_report`
            # already returns a body for the same "we did nothing, that's fine"
            # case. Nothing is blocked — the client can resend with
            # confirm_duplicate.
            #
            # Set explicitly: the route declares 201, which FastAPI would
            # otherwise stamp on this response too, and "201 Created" for a
            # request that created nothing is a lie the client would act on.
            response.status_code = status.HTTP_200_OK
            return {"created": False, "duplicate": True, "candidates": candidates}

    spot = await spots.create(user["user_id"], payload.model_dump())
    await cache.invalidate_spots(payload.region_id)
    await _decorate([spot], user)
    return spot


# ---------- one spot ----------
@router.get("/spots/{spot_id}")
async def get_spot(spot_id: str, user: Optional[dict] = Depends(optional_user)):
    raw = await _load_spot(spot_id, user)
    spot = await spots.by_id(spot_id, include_hidden=permissions.is_staff(user))
    if spot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Spot not found"
        )
    await _decorate([spot], user)
    return {
        "spot": spot,
        "photos": await spots.list_photos(spot_id),
        "appreciation_budget": await _budget_or_none(user, raw["region_id"]),
    }


@router.patch("/spots/{spot_id}")
async def update_spot(
    spot_id: str, payload: SpotUpdate, user: dict = Depends(get_current_user)
):
    raw = await _load_spot(spot_id, user)
    _require_finder(raw, user)

    updates: dict[str, Any] = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )

    spot = await spots.update(spot_id, updates)
    if spot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Spot not found"
        )
    await cache.invalidate_spots(raw["region_id"])
    await _decorate([spot], user)
    return spot


@router.post("/spots/{spot_id}/status")
async def set_spot_status(
    spot_id: str, payload: SpotStatusUpdate, user: dict = Depends(get_current_user)
):
    raw = await _load_spot(spot_id, user)
    _require_finder(raw, user)
    await spots.set_status(spot_id, payload.status, user["user_id"])
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True, "status": payload.status}


@router.post("/spots/{spot_id}/quiet")
async def set_spot_quiet(
    spot_id: str, payload: SpotQuietUpdate, user: dict = Depends(get_current_user)
):
    raw = await _load_spot(spot_id, user)
    # Staff deliberately excluded: the matrix gives them no say here.
    _require_finder(raw, user, allow_staff=False)

    if bool(raw["is_quiet"]) == payload.is_quiet:
        return {"ok": True, "is_quiet": payload.is_quiet, "quiet_unset_remaining": max(1 - raw["quiet_unset_count"], 0)}

    if not await spots.set_quiet(spot_id, payload.is_quiet):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A spot can only be taken out of quiet mode once.",
        )
    await cache.invalidate_spots(raw["region_id"])
    updated = await spots.raw_by_id(spot_id)
    return {
        "ok": True,
        "is_quiet": payload.is_quiet,
        "quiet_unset_remaining": max(1 - (updated or raw)["quiet_unset_count"], 0),
    }


@router.post("/spots/{spot_id}/hide")
async def hide_spot(
    spot_id: str,
    payload: SpotHideRequest,
    user: dict = Depends(permissions.require_staff),
):
    raw = await _load_spot(spot_id, user)
    await spots.set_hidden(spot_id, True, user["user_id"], payload.reason)
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True}


@router.post("/spots/{spot_id}/unhide")
async def unhide_spot(spot_id: str, user: dict = Depends(permissions.require_staff)):
    raw = await _load_spot(spot_id, user)
    await spots.set_hidden(spot_id, False, user["user_id"])
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True}


# ---------- photos ----------
@router.get("/spots/{spot_id}/photos")
async def list_spot_photos(
    spot_id: str,
    limit: int = Query(50, ge=1, le=200),
    user: Optional[dict] = Depends(optional_user),
):
    await _load_spot(spot_id, user)
    return {"photos": await spots.list_photos(spot_id, limit)}


@router.post("/spots/{spot_id}/photos", status_code=status.HTTP_201_CREATED)
async def add_spot_photo(
    spot_id: str, payload: SpotPhotoCreate, user: dict = Depends(get_current_user)
):
    raw = await _load_spot(spot_id, user)
    if await spots.photos_since(user["user_id"]) >= PHOTOS_PER_DAY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"You can add up to {PHOTOS_PER_DAY} photos a day. Try again tomorrow.",
        )
    photo = await spots.add_photo(spot_id, user["user_id"], payload.model_dump())
    await cache.invalidate_spots(raw["region_id"])
    return photo


@router.delete("/spot-photos/{spot_photo_id}")
async def delete_spot_photo(
    spot_photo_id: str, user: dict = Depends(get_current_user)
):
    photo = await spots.photo_by_id(spot_photo_id)
    if photo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found"
        )
    if photo["user_id"] != user["user_id"] and not permissions.is_staff(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only remove your own photos.",
        )
    await spots.delete_photo(spot_photo_id)
    return {"ok": True}


@router.post("/spot-photos/{spot_photo_id}/hide")
async def hide_spot_photo(
    spot_photo_id: str, user: dict = Depends(permissions.require_staff)
):
    photo = await spots.photo_by_id(spot_photo_id)
    if photo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found"
        )
    await spots.hide_photo(spot_photo_id, user["user_id"])
    return {"ok": True}


# ---------- visits, confirmations, saves ----------
@router.post("/spots/{spot_id}/visit")
async def mark_visited(spot_id: str, user: dict = Depends(get_current_user)):
    raw = await _load_spot(spot_id, user)
    count = await spots.add_visit(raw, user["user_id"], user.get("name") or "Someone")
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True, "visits_attributed_total": count, "viewer_visited": True}


@router.delete("/spots/{spot_id}/visit")
async def unmark_visited(spot_id: str, user: dict = Depends(get_current_user)):
    """Not in the original spec, but a mis-tap with no undo is worse than the
    small amount of rank churn an undo allows."""
    raw = await _load_spot(spot_id, user)
    count = await spots.remove_visit(spot_id, user["user_id"])
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True, "visits_attributed_total": count, "viewer_visited": False}


@router.post("/spots/{spot_id}/confirm")
async def confirm_spot(spot_id: str, user: dict = Depends(get_current_user)):
    raw = await _load_spot(spot_id, user)
    count = await spots.confirm(spot_id, user["user_id"])
    await cache.invalidate_spots(raw["region_id"])
    return {"ok": True, "confirmations_30d": count, "viewer_confirmed": True}


@router.post("/spots/{spot_id}/save")
async def save_spot(spot_id: str, user: dict = Depends(get_current_user)):
    await _load_spot(spot_id, user)
    await spots.set_saved(spot_id, user["user_id"], True)
    return {"ok": True, "viewer_saved": True}


@router.delete("/spots/{spot_id}/save")
async def unsave_spot(spot_id: str, user: dict = Depends(get_current_user)):
    await _load_spot(spot_id, user)
    await spots.set_saved(spot_id, user["user_id"], False)
    return {"ok": True, "viewer_saved": False}


# ---------- appreciation ----------
@router.post("/spots/{spot_id}/appreciate")
async def appreciate_spot(spot_id: str, user: dict = Depends(get_current_user)):
    raw = await _load_spot(spot_id, user)
    if raw["finder_user_id"] == user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot appreciate your own spot.",
        )

    result = await spots.appreciate(raw, user["user_id"], user.get("name") or "Someone")
    if result.get("exhausted"):
        # 409, not 429: this is a product rule the client renders as "you're out
        # until Monday", not a throttle that invites a retry.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "You've used all your appreciations here this week. "
                "They come back on Monday."
            ),
        )
    await cache.invalidate_spots(raw["region_id"])
    return {
        "ok": True,
        "viewer_appreciated": True,
        "appreciation_count": await spots.appreciation_count(spot_id),
        "appreciation_budget": result["budget"],
    }


@router.delete("/spots/{spot_id}/appreciate")
async def unappreciate_spot(spot_id: str, user: dict = Depends(get_current_user)):
    raw = await _load_spot(spot_id, user)
    result = await spots.unappreciate(raw, user["user_id"])
    await cache.invalidate_spots(raw["region_id"])
    return {
        "ok": True,
        "viewer_appreciated": False,
        "refunded": result["refunded"],
        "appreciation_count": await spots.appreciation_count(spot_id),
        "appreciation_budget": result["budget"],
    }


# ---------- rank ----------
async def _rank_for(user_id: str, region_id: str) -> dict:
    credited = (await spots.credited_spots_for([user_id], region_id)).get(user_id, 0)
    totals = await spots.rank_totals(user_id, region_id)
    region = await regions.by_id(region_id)

    payload = {
        "region_id": region_id,
        "region_name": region["name"] if region else None,
        "credited_spots": credited,
        **totals,
        "tier": None,
        "tier_label": None,
        "next_tier": None,
        "next_tier_label": None,
        "next_tier_threshold": None,
        "spots_to_next": None,
    }
    tier = tier_for(credited)
    if tier:
        payload["tier"] = tier["tier"]
        payload["tier_label"] = tier["tier_label"]
    nxt = next_tier_for(credited)
    if nxt:
        payload.update(nxt)
    return payload


@router.get("/me/rank")
async def my_rank(
    region_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    target = region_id or user.get("home_region_id")
    if not target:
        active = await regions.list_regions()
        target = active[0]["region_id"] if active else None
    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )
    return await _rank_for(user["user_id"], target)


@router.get("/users/{user_id}/rank")
async def user_rank(
    user_id: str,
    region_id: str = Query(..., min_length=1),
    _user: Optional[dict] = Depends(optional_user),
):
    """Public: the credit block on a spot links to the finder's standing."""
    return await _rank_for(user_id, region_id)
