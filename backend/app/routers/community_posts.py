"""Posts, comments and reactions inside a community.

Read access follows community visibility; writing requires active membership and
not being muted. Moderation actions require manager or above, except that an
author may always edit or delete their own content.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import permissions
from app.dependencies import get_current_user, optional_user
from app.models import (
    CommentCreate,
    CommunityPostCreate,
    CommunityPostUpdate,
    ReactionRequest,
)
from app.permissions import CommunityContext
from app.repositories import community_posts

router = APIRouter(tags=["community-posts"])

TARGET = community_posts.TARGET_COMMUNITY_POST


async def _resolve(community_post_id: str, user) -> tuple[dict, CommunityContext]:
    """Resolves a post to its community and applies that community's read rules.

    A post in a private community must 404 for outsiders exactly as the
    community itself does — otherwise a guessable id leaks its contents.
    """
    post = await community_posts.by_id(community_post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    community = await permissions.community_for_update(post["community_id"])
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    if not await permissions.can_view_community(community, user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    member = (
        await permissions.membership(community["community_id"], user["user_id"])
        if user
        else None
    )
    return post, CommunityContext(community, user, member)


async def _post_context(
    community_post_id: str,
    user=Depends(optional_user),
) -> tuple[dict, CommunityContext]:
    """Read path: guests are allowed, subject to community visibility."""
    return await _resolve(community_post_id, user)


async def _authed_post_context(
    community_post_id: str,
    user: dict = Depends(get_current_user),
) -> tuple[dict, CommunityContext]:
    """Write path: resolves auth first so anonymous callers get 401, not the
    404 that looking the post up first would produce."""
    return await _resolve(community_post_id, user)


# ---------- posts ----------
@router.get("/communities/{community_id}/posts")
async def list_posts(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    ctx: CommunityContext = Depends(permissions.community_context),
):
    posts = await community_posts.list_posts(
        ctx.community_id,
        viewer_id=ctx.user["user_id"] if ctx.user else None,
        limit=limit,
        offset=offset,
    )
    return {"posts": posts}


@router.post("/communities/{community_id}/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: CommunityPostCreate,
    ctx: CommunityContext = Depends(permissions.require_member),
):
    permissions.require_not_muted(ctx)
    return await community_posts.create(
        ctx.community_id, ctx.user["user_id"], payload.model_dump()
    )


@router.get("/community-posts/{community_post_id}")
async def get_post(resolved=Depends(_post_context)):
    post, ctx = resolved
    post["reactions"] = await community_posts.reaction_summary(
        TARGET, post["community_post_id"], ctx.user["user_id"] if ctx.user else None
    )
    return post


@router.patch("/community-posts/{community_post_id}")
async def update_post(
    community_post_id: str,
    payload: CommunityPostUpdate,
    resolved=Depends(_authed_post_context),
):
    post, ctx = resolved
    user = ctx.user
    if not permissions.can_edit_content(ctx, post["author_user_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    return await community_posts.update(community_post_id, updates)


@router.delete("/community-posts/{community_post_id}")
async def delete_post(
    community_post_id: str,
    resolved=Depends(_authed_post_context),
):
    post, ctx = resolved
    user = ctx.user
    if not permissions.can_edit_content(ctx, post["author_user_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )
    await community_posts.soft_delete(community_post_id)
    return {"ok": True}


@router.post("/community-posts/{community_post_id}/pin")
async def pin_post(
    community_post_id: str,
    pinned: bool = Query(True),
    resolved=Depends(_authed_post_context),
):
    """Pinning is a curation act, so it is manager-and-above even for your own post."""
    _post, ctx = resolved
    user = ctx.user
    if not ctx.at_least(permissions.COMMUNITY_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )
    return await community_posts.set_pinned(community_post_id, pinned)


# ---------- comments ----------
@router.get("/community-posts/{community_post_id}/comments")
async def list_comments(
    community_post_id: str,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    resolved=Depends(_post_context),
):
    comments = await community_posts.list_comments(
        TARGET, community_post_id, limit=limit, offset=offset
    )
    return {"comments": comments}


@router.post(
    "/community-posts/{community_post_id}/comments",
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    community_post_id: str,
    payload: CommentCreate,
    resolved=Depends(_authed_post_context),
):
    _post, ctx = resolved
    user = ctx.user
    if not ctx.is_active_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Join this community to join the conversation.",
        )
    permissions.require_not_muted(ctx)
    return await community_posts.add_comment(
        TARGET, community_post_id, user["user_id"], payload.model_dump()
    )


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, user: dict = Depends(get_current_user)):
    comment = await community_posts.comment_by_id(comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found"
        )

    is_author = comment["author_user_id"] == user["user_id"]
    if not is_author:
        # Not the author, so this has to be a moderation action — which means
        # resolving the comment's community and checking rank there.
        community_id = await community_posts.community_id_for_post(comment["target_id"])
        allowed = False
        if community_id:
            member = await permissions.membership(community_id, user["user_id"])
            allowed = permissions.community_rank(
                member["role"] if member and member["status"] == "active" else None
            ) >= permissions.community_rank(permissions.COMMUNITY_MANAGER)
        if not allowed and not permissions.is_staff(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to do that.",
            )

    await community_posts.soft_delete_comment(comment_id)
    return {"ok": True}


# ---------- reactions ----------
@router.get("/community-posts/{community_post_id}/reactions")
async def get_reactions(community_post_id: str, resolved=Depends(_post_context)):
    _post, ctx = resolved
    return {
        "reactions": await community_posts.reaction_summary(
            TARGET, community_post_id, ctx.user["user_id"] if ctx.user else None
        )
    }


@router.post("/community-posts/{community_post_id}/reactions")
async def add_reaction(
    community_post_id: str,
    payload: ReactionRequest,
    resolved=Depends(_authed_post_context),
):
    _post, ctx = resolved
    user = ctx.user
    if not ctx.is_active_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Join this community to react.",
        )
    permissions.require_not_muted(ctx)
    await community_posts.add_reaction(
        TARGET, community_post_id, user["user_id"], payload.emoji
    )
    return {
        "reactions": await community_posts.reaction_summary(
            TARGET, community_post_id, user["user_id"]
        )
    }


@router.delete("/community-posts/{community_post_id}/reactions")
async def remove_reaction(
    community_post_id: str,
    emoji: str = Query(..., min_length=1, max_length=16),
    resolved=Depends(_authed_post_context),
):
    _post, ctx = resolved
    user = ctx.user
    await community_posts.remove_reaction(
        TARGET, community_post_id, user["user_id"], emoji
    )
    return {
        "reactions": await community_posts.reaction_summary(
            TARGET, community_post_id, user["user_id"]
        )
    }
