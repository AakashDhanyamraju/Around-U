"""Communities and membership.

Thin handlers: parse input, delegate to the repository, shape the response.
Every authorisation decision lives in app/permissions.py.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import permissions
from app.dependencies import get_current_user, optional_user
from app.models import (
    CommunityCreate,
    CommunityUpdate,
    MemberModerationRequest,
    MemberRoleUpdate,
    slugify,
)
from app.permissions import (
    COMMUNITY_HEAD,
    COMMUNITY_MANAGER,
    CommunityContext,
    require_verified,
)
from app.repositories import communities, moderation, regions

router = APIRouter(tags=["communities"])


def _with_viewer(community: dict, ctx: Optional[CommunityContext]) -> dict:
    """Attaches the caller's own standing so the client can pick the right CTA."""
    out = dict(community)
    out["viewer_role"] = ctx.role if ctx else None
    out["viewer_status"] = (
        ctx.member["status"] if ctx and ctx.member else None
    )
    return out


# ---------- discovery ----------
@router.get("/communities")
async def list_communities(
    region_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: Optional[dict] = Depends(optional_user),
):
    """Public communities, plus any private ones the caller belongs to."""
    items = await communities.list_communities(
        region_id=region_id,
        category=category,
        search=search,
        viewer_id=user["user_id"] if user else None,
        limit=limit,
        offset=offset,
    )
    return {"communities": items}


@router.get("/communities/mine")
async def my_communities(user: dict = Depends(get_current_user)):
    """The caller's memberships. Declared before /communities/{community_id} so
    "mine" is not swallowed by the path parameter."""
    return {"communities": await communities.communities_for_user(user["user_id"])}


@router.post("/communities", status_code=status.HTTP_201_CREATED)
async def create_community(
    payload: CommunityCreate,
    user: dict = Depends(require_verified),
):
    if not await regions.exists(payload.region_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )

    active = await communities.active_count_for_creator(user["user_id"])
    if active >= communities.MAX_ACTIVE_COMMUNITIES_PER_USER and not permissions.is_staff(user):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"You can run up to {communities.MAX_ACTIVE_COMMUNITIES_PER_USER} "
                "communities at a time. Archive one before creating another."
            ),
        )

    data = payload.model_dump()
    data["slug"] = data.get("slug") or slugify(payload.name)
    if await communities.by_slug(payload.region_id, data["slug"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A community with that name already exists in this region.",
        )

    community = await communities.create(data, head_user_id=user["user_id"])
    community["viewer_role"] = COMMUNITY_HEAD
    community["viewer_status"] = "active"
    return community


@router.get("/communities/{community_id}")
async def get_community(
    ctx: CommunityContext = Depends(permissions.community_context),
):
    full = await communities.by_id(ctx.community_id)
    return _with_viewer(full, ctx)


@router.patch("/communities/{community_id}")
async def update_community(
    payload: CommunityUpdate,
    ctx: CommunityContext = Depends(permissions.require_manager),
):
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    # Flipping public/private reshapes who can see everything inside, so it is
    # the head's call alone.
    if "visibility" in updates and not ctx.at_least(COMMUNITY_HEAD):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community head can change visibility.",
        )
    updated = await communities.update(ctx.community_id, updates)
    return _with_viewer(updated, ctx)


@router.delete("/communities/{community_id}")
async def delete_community(
    ctx: CommunityContext = Depends(permissions.require_head),
):
    await communities.soft_delete(ctx.community_id)
    return {"ok": True}


# ---------- membership ----------
@router.post("/communities/{community_id}/join")
async def join_community(
    ctx: CommunityContext = Depends(permissions.authed_community_context),
):
    user = ctx.user
    existing = await communities.member(ctx.community_id, user["user_id"])
    if existing and existing["status"] == permissions.STATUS_BANNED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have been removed from this community.",
        )
    if existing and existing["status"] == permissions.STATUS_ACTIVE:
        return {"status": "active", "role": existing["role"]}

    policy = ctx.community["join_policy"]
    if policy == "invite":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This community is invite only.",
        )

    target = permissions.STATUS_PENDING if policy == "request" else permissions.STATUS_ACTIVE
    result = await communities.join(ctx.community_id, user["user_id"], status=target)
    return {"status": result["status"], "role": result["role"]}


@router.post("/communities/{community_id}/leave")
async def leave_community(
    ctx: CommunityContext = Depends(permissions.authed_community_context),
):
    left = await communities.leave(ctx.community_id, ctx.user["user_id"])
    if not left:
        # The only row leave() refuses to delete is the head's.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Transfer ownership to another member before leaving, "
                "or delete the community."
            ),
        )
    return {"ok": True}


@router.get("/communities/{community_id}/members")
async def list_members(
    member_status: str = Query("active", pattern="^(active|pending|banned)$"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ctx: CommunityContext = Depends(permissions.community_context),
):
    # Pending and banned lists are moderation data, not public information.
    if member_status != "active" and not ctx.at_least(COMMUNITY_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )
    members = await communities.list_members(
        ctx.community_id, status=member_status, limit=limit, offset=offset
    )
    return {"members": members}


@router.post("/communities/{community_id}/members/{user_id}/approve")
async def approve_member(
    user_id: str,
    ctx: CommunityContext = Depends(permissions.require_manager),
):
    if not await communities.approve(ctx.community_id, user_id, ctx.user["user_id"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending request from that user.",
        )
    return {"ok": True}


@router.post("/communities/{community_id}/members/{user_id}/role")
async def set_member_role(
    user_id: str,
    payload: MemberRoleUpdate,
    ctx: CommunityContext = Depends(permissions.require_head),
):
    """Appointing and dismissing managers is the head's privilege.

    A manager promoting other managers would let them out-vote the head.
    """
    if user_id == ctx.user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use transfer-ownership to change your own role.",
        )
    updated = await communities.set_role(ctx.community_id, user_id, payload.role)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That person is not an active member.",
        )
    return updated


@router.post("/communities/{community_id}/members/{user_id}/transfer-ownership")
async def transfer_ownership(
    user_id: str,
    ctx: CommunityContext = Depends(permissions.require_head),
):
    if user_id == ctx.user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already the head of this community.",
        )
    ok = await communities.transfer_head(ctx.community_id, ctx.user["user_id"], user_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That person is not an active member.",
        )
    return {"ok": True}


@router.post("/communities/{community_id}/members/{user_id}/ban")
async def ban_member(
    user_id: str,
    payload: MemberModerationRequest,
    ctx: CommunityContext = Depends(permissions.require_manager),
):
    target = await communities.member(ctx.community_id, user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this community."
        )
    # A manager may act on members, never on peers or the head.
    if not permissions.outranks(ctx.role, target["role"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot moderate someone at or above your own role.",
        )
    await communities.ban(ctx.community_id, user_id)
    return {"ok": True}


@router.post("/communities/{community_id}/members/{user_id}/mute")
async def mute_member(
    user_id: str,
    payload: MemberModerationRequest,
    ctx: CommunityContext = Depends(permissions.require_manager),
):
    target = await communities.member(ctx.community_id, user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this community."
        )
    if not permissions.outranks(ctx.role, target["role"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot moderate someone at or above your own role.",
        )
    minutes = payload.mute_minutes or 60
    await communities.mute(ctx.community_id, user_id, minutes)
    return {"ok": True, "muted_minutes": minutes}


# ---------- moderation queue ----------
@router.get("/communities/{community_id}/reports")
async def community_reports(
    report_status: str = Query("open", pattern="^(open|actioned|dismissed)$"),
    ctx: CommunityContext = Depends(permissions.require_manager),
):
    reports = await moderation.list_reports(
        community_id=ctx.community_id, status=report_status
    )
    return {"reports": reports}
