"""Public read endpoints: creators, posts, categories.

Response shapes match the pre-migration API exactly. The feed and creator list
are Redis-cached; a cache miss or outage just falls through to Postgres.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import cache
from app.dependencies import get_current_user
from app.repositories import content

router = APIRouter(tags=["content"])

CATEGORIES = [
    {"key": "All", "icon": "compass"},
    {"key": "Food", "icon": "utensils"},
    {"key": "Events", "icon": "calendar"},
    {"key": "Real Estate", "icon": "home"},
    {"key": "Hidden Gems", "icon": "gem"},
    {"key": "Nightlife", "icon": "moon"},
    {"key": "Outdoor", "icon": "tree"},
    {"key": "Culture", "icon": "palette"},
]


@router.get("/creators")
async def list_creators():
    cached = await cache.get_json(cache.CREATORS_KEY)
    if cached is not None:
        return cached

    creators = await content.list_creators()
    await cache.set_json(cache.CREATORS_KEY, creators)
    return creators


@router.get("/creators/{creator_id}")
async def get_creator(creator_id: str):
    creator = await content.creator_by_id(creator_id)
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Creator not found"
        )
    posts = await content.posts_by_creator(creator_id)
    return {"creator": creator, "posts": posts}


@router.get("/posts")
async def list_posts(
    category: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    key = cache.feed_key(category, limit)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    posts = await content.list_posts(category=category, limit=limit)
    await cache.set_json(key, posts)
    return posts


@router.get("/feed")
async def feed(
    category: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    """Posts from the creators you follow.

    Not cached: the result is per-user, so a shared cache key would leak one
    person's follow graph to the next caller.
    """
    return await content.posts_from_followed(
        user["user_id"], category=category, limit=limit
    )


@router.get("/posts/{post_id}")
async def get_post(post_id: str):
    post = await content.post_by_id(post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    related = await content.related_posts(post_id, post["category"])
    # `creator` is nested in `post` by the repository, but the frontend also
    # reads it as a sibling key — both are returned for compatibility.
    return {"post": post, "creator": post.get("creator"), "related": related}


@router.get("/categories")
async def categories():
    return CATEGORIES
