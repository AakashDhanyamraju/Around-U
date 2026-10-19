"""Admin writes, guarded by the X-Admin-Secret shared secret.

Every mutation invalidates the content cache so the feed never serves a stale
copy of something that was just edited.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app import cache
from app.dependencies import require_admin
from app.models import CreatorCreate, CreatorUpdate, PostCreate, PostUpdate
from app.repositories import content

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------- creators ----------
@router.post("/creators", status_code=status.HTTP_201_CREATED)
async def add_creator(payload: CreatorCreate):
    creator = await content.insert_creator(payload.model_dump())
    await cache.invalidate_content()
    return creator


@router.patch("/creators/{creator_id}")
async def update_creator(creator_id: str, payload: CreatorUpdate):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    creator = await content.update_creator(creator_id, updates)
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Creator not found"
        )
    await cache.invalidate_content()
    return creator


@router.delete("/creators/{creator_id}")
async def delete_creator(creator_id: str):
    creators, posts = await content.soft_delete_creator(creator_id)
    if creators == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Creator not found"
        )
    await cache.invalidate_content()
    return {"deleted_creator": creators, "deleted_posts": posts}


# ---------- posts ----------
@router.post("/posts", status_code=status.HTTP_201_CREATED)
async def add_post(payload: PostCreate):
    if not await content.creator_by_id(payload.creator_id):
        # There are no FK constraints, so the relationship is checked here.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown creator_id '{payload.creator_id}'",
        )
    post = await content.insert_post(payload.model_dump())
    await cache.invalidate_content()
    return post


@router.patch("/posts/{post_id}")
async def update_post(post_id: str, payload: PostUpdate):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    if "creator_id" in updates and not await content.creator_by_id(updates["creator_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown creator_id '{updates['creator_id']}'",
        )
    post = await content.update_post(post_id, updates)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    await cache.invalidate_content()
    return post


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str):
    deleted = await content.soft_delete_post(post_id)
    if deleted == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    await cache.invalidate_content()
    return {"deleted": deleted}


# ---------- stats / maintenance ----------
@router.get("/stats")
async def stats():
    return await content.stats()


@router.post("/cleanup")
async def cleanup():
    """Hard-deletes everything not created by the seed, restoring the baseline."""
    posts, creators = await content.purge_non_seed()
    await cache.invalidate_content()
    logger.info("Cleanup removed %d post(s) and %d creator(s)", posts, creators)
    return {"deleted_posts": posts, "deleted_creators": creators}
