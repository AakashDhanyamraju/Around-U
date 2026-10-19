"""Bookmarks and follows for the signed-in user."""

from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.repositories import content, social

router = APIRouter(tags=["social"])


@router.get("/bookmarks")
async def my_bookmarks(user: dict = Depends(get_current_user)):
    post_ids = await social.bookmarked_post_ids(user["user_id"])
    posts = await content.posts_by_ids(post_ids)
    return {"post_ids": post_ids, "posts": posts}


@router.post("/bookmarks/{post_id}")
async def add_bookmark(post_id: str, user: dict = Depends(get_current_user)):
    await social.add_bookmark(user["user_id"], post_id)
    return {"ok": True}


@router.delete("/bookmarks/{post_id}")
async def remove_bookmark(post_id: str, user: dict = Depends(get_current_user)):
    await social.remove_bookmark(user["user_id"], post_id)
    return {"ok": True}


@router.get("/follows")
async def my_follows(user: dict = Depends(get_current_user)):
    creator_ids = await social.followed_creator_ids(user["user_id"])
    creators = await content.creators_by_ids(creator_ids)
    return {"creator_ids": creator_ids, "creators": creators}


@router.post("/follows/{creator_id}")
async def follow(creator_id: str, user: dict = Depends(get_current_user)):
    await social.add_follow(user["user_id"], creator_id)
    return {"ok": True}


@router.delete("/follows/{creator_id}")
async def unfollow(creator_id: str, user: dict = Depends(get_current_user)):
    await social.remove_follow(user["user_id"], creator_id)
    return {"ok": True}
