"""Creator self-publishing.

Replaces the shared-secret admin screen as the way regional content gets in.
The creator identity comes from the authenticated account, never from the
request body, so nobody can publish under someone else's name — and the target
region is checked against creator_regions.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app import cache, permissions
from app.dependencies import get_current_user
from app.models import CreatorPostCreate, PostUpdate
from app.repositories import content

router = APIRouter(prefix="/creator", tags=["creator"])


async def _creator_profile(user: dict) -> dict:
    """Resolves the caller's linked creator profile.

    `users.creator_id` is the bridge added in migration 002; a creator-role
    account without one is a provisioning mistake worth reporting clearly rather
    than failing with a null further down.
    """
    creator_id = user.get("creator_id")
    if not creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not linked to a creator profile.",
        )
    creator = await content.creator_by_id(creator_id)
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Creator profile not found"
        )
    return creator


@router.get("/me")
async def my_creator_profile(user: dict = Depends(permissions.require_creator)):
    creator = await _creator_profile(user)
    regions = await content.regions_for_creator(creator["creator_id"])
    return {"creator": creator, "regions": regions}


@router.get("/posts")
async def my_posts(
    user: dict = Depends(permissions.require_creator),
    limit: int = 100,
):
    creator = await _creator_profile(user)
    return {"posts": await content.posts_by_creator(creator["creator_id"], limit)}


@router.post("/posts", status_code=status.HTTP_201_CREATED)
async def publish_post(
    payload: CreatorPostCreate,
    user: dict = Depends(permissions.require_creator),
):
    creator = await _creator_profile(user)
    await permissions.require_region_grant(creator["creator_id"], payload.region_id)

    data = payload.model_dump()
    data["creator_id"] = creator["creator_id"]
    post = await content.insert_post(data)
    await cache.invalidate_content()
    return post


@router.patch("/posts/{post_id}")
async def edit_post(
    post_id: str,
    payload: PostUpdate,
    user: dict = Depends(permissions.require_creator),
):
    creator = await _creator_profile(user)
    existing = await content.post_by_id(post_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    if existing["creator_id"] != creator["creator_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own posts.",
        )

    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    # Reassigning authorship is an admin concern, not a creator one.
    updates.pop("creator_id", None)
    updates.pop("is_sponsored", None)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )

    updated = await content.update_post(post_id, updates)
    await cache.invalidate_content()
    return updated


@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: str,
    user: dict = Depends(permissions.require_creator),
):
    creator = await _creator_profile(user)
    existing = await content.post_by_id(post_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    if existing["creator_id"] != creator["creator_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own posts.",
        )
    await content.soft_delete_post(post_id)
    await cache.invalidate_content()
    return {"ok": True}
