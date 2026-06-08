from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Shared secret guarding the internal /api/admin/* write endpoints.
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # startup
    await run_migrations_and_seed()
    yield
    # shutdown
    client.close()


app = FastAPI(lifespan=lifespan)
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


# ---------- Models ----------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SessionRequest(BaseModel):
    session_token: str


class Creator(BaseModel):
    creator_id: str
    handle: str
    name: str
    bio: str
    avatar: str
    cover: Optional[str] = None
    city: str = "Houston"
    categories: List[str] = []
    followers: int = 0


class Post(BaseModel):
    post_id: str
    creator_id: str
    image: str
    caption: str
    category: str
    neighborhood: str
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    likes: int = 0
    media_type: str = "image"  # "image" | "video"
    video_url: Optional[str] = None
    hashtags: List[str] = []
    source: Optional[str] = None  # e.g. "Instagram"
    original_url: Optional[str] = None
    is_sponsored: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PostCreate(BaseModel):
    creator_id: str
    image: str
    caption: str
    category: str
    neighborhood: str
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    media_type: str = "image"
    video_url: Optional[str] = None
    hashtags: List[str] = []
    source: Optional[str] = None
    original_url: Optional[str] = None
    is_sponsored: bool = False


class CreatorCreate(BaseModel):
    handle: str
    name: str
    bio: str
    avatar: str
    cover: Optional[str] = None
    categories: List[str] = []


class PostUpdate(BaseModel):
    creator_id: Optional[str] = None
    image: Optional[str] = None
    caption: Optional[str] = None
    category: Optional[str] = None
    neighborhood: Optional[str] = None
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    media_type: Optional[str] = None
    video_url: Optional[str] = None
    hashtags: Optional[List[str]] = None
    source: Optional[str] = None
    original_url: Optional[str] = None
    is_sponsored: Optional[bool] = None


class CreatorUpdate(BaseModel):
    handle: Optional[str] = None
    name: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None
    cover: Optional[str] = None
    categories: Optional[List[str]] = None


# ---------- Auth helpers ----------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization:
        return None
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


# ---------- Auth routes ----------
@api_router.post("/auth/session")
async def create_session(req: SessionRequest):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": req.session_token})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session token")
    data = r.json()
    email = data["email"]
    name = data.get("name", email.split("@")[0])
    picture = data.get("picture")
    persistent_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = User(user_id=user_id, email=email, name=name, picture=picture).dict()
        await db.users.insert_one(user_doc)

    await db.user_sessions.update_one(
        {"session_token": persistent_token},
        {
            "$set": {
                "session_token": persistent_token,
                "user_id": user_id,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user, "session_token": persistent_token}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Creators / Posts ----------
@api_router.get("/creators")
async def list_creators():
    creators = await db.creators.find({}, {"_id": 0}).to_list(200)
    return creators


@api_router.get("/creators/{creator_id}")
async def get_creator(creator_id: str):
    creator = await db.creators.find_one({"creator_id": creator_id}, {"_id": 0})
    if not creator:
        raise HTTPException(status_code=404, detail="Creator not found")
    posts = await db.posts.find({"creator_id": creator_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"creator": creator, "posts": posts}


@api_router.get("/posts")
async def list_posts(category: Optional[str] = None, limit: int = 100):
    query = {}
    if category and category.lower() != "all":
        query["category"] = category
    posts = await db.posts.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    creator_ids = list({p["creator_id"] for p in posts})
    creators = await db.creators.find({"creator_id": {"$in": creator_ids}}, {"_id": 0}).to_list(200)
    cmap = {c["creator_id"]: c for c in creators}
    for p in posts:
        p["creator"] = cmap.get(p["creator_id"])
    return posts


@api_router.get("/posts/{post_id}")
async def get_post(post_id: str):
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    creator = await db.creators.find_one({"creator_id": post["creator_id"]}, {"_id": 0})
    related = await db.posts.find(
        {"post_id": {"$ne": post_id}, "category": post["category"]}, {"_id": 0}
    ).limit(6).to_list(6)
    return {"post": post, "creator": creator, "related": related}


@api_router.get("/categories")
async def categories():
    return [
        {"key": "All", "icon": "compass"},
        {"key": "Food", "icon": "utensils"},
        {"key": "Events", "icon": "calendar"},
        {"key": "Real Estate", "icon": "home"},
        {"key": "Hidden Gems", "icon": "gem"},
        {"key": "Nightlife", "icon": "moon"},
        {"key": "Outdoor", "icon": "tree"},
        {"key": "Culture", "icon": "palette"},
    ]


# ---------- Bookmarks ----------
@api_router.get("/bookmarks")
async def my_bookmarks(user: dict = Depends(get_current_user)):
    rows = await db.bookmarks.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    post_ids = [r["post_id"] for r in rows]
    posts = await db.posts.find({"post_id": {"$in": post_ids}}, {"_id": 0}).to_list(500)
    creators = await db.creators.find({}, {"_id": 0}).to_list(500)
    cmap = {c["creator_id"]: c for c in creators}
    for p in posts:
        p["creator"] = cmap.get(p["creator_id"])
    return {"post_ids": post_ids, "posts": posts}


@api_router.post("/bookmarks/{post_id}")
async def add_bookmark(post_id: str, user: dict = Depends(get_current_user)):
    await db.bookmarks.update_one(
        {"user_id": user["user_id"], "post_id": post_id},
        {"$set": {"user_id": user["user_id"], "post_id": post_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/bookmarks/{post_id}")
async def remove_bookmark(post_id: str, user: dict = Depends(get_current_user)):
    await db.bookmarks.delete_one({"user_id": user["user_id"], "post_id": post_id})
    return {"ok": True}


# ---------- Follows ----------
@api_router.get("/follows")
async def my_follows(user: dict = Depends(get_current_user)):
    rows = await db.follows.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    ids = [r["creator_id"] for r in rows]
    creators = await db.creators.find({"creator_id": {"$in": ids}}, {"_id": 0}).to_list(500)
    return {"creator_ids": ids, "creators": creators}


@api_router.post("/follows/{creator_id}")
async def follow(creator_id: str, user: dict = Depends(get_current_user)):
    await db.follows.update_one(
        {"user_id": user["user_id"], "creator_id": creator_id},
        {"$set": {"user_id": user["user_id"], "creator_id": creator_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/follows/{creator_id}")
async def unfollow(creator_id: str, user: dict = Depends(get_current_user)):
    await db.follows.delete_one({"user_id": user["user_id"], "creator_id": creator_id})
    return {"ok": True}


# ---------- Admin (protected by X-Admin-Secret header) ----------
async def require_admin(x_admin_secret: Optional[str] = Header(None)):
    if not ADMIN_API_KEY:
        # fail closed: never leave admin endpoints open if the key is unset
        raise HTTPException(status_code=503, detail="Admin API not configured")
    if not x_admin_secret or x_admin_secret != ADMIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing admin credentials")
    return True


@api_router.post("/admin/creators", dependencies=[Depends(require_admin)])
async def admin_add_creator(c: CreatorCreate):
    creator = Creator(creator_id=f"cr_{uuid.uuid4().hex[:8]}", **c.dict()).dict()
    await db.creators.insert_one(creator)
    return await db.creators.find_one({"creator_id": creator["creator_id"]}, {"_id": 0})


@api_router.post("/admin/posts", dependencies=[Depends(require_admin)])
async def admin_add_post(p: PostCreate):
    post = Post(post_id=f"po_{uuid.uuid4().hex[:8]}", **p.dict()).dict()
    await db.posts.insert_one(post)
    return await db.posts.find_one({"post_id": post["post_id"]}, {"_id": 0})


@api_router.patch("/admin/posts/{post_id}", dependencies=[Depends(require_admin)])
async def admin_update_post(post_id: str, p: PostUpdate):
    updates = {k: v for k, v in p.dict(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.posts.update_one({"post_id": post_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return await db.posts.find_one({"post_id": post_id}, {"_id": 0})


@api_router.patch("/admin/creators/{creator_id}", dependencies=[Depends(require_admin)])
async def admin_update_creator(creator_id: str, c: CreatorUpdate):
    updates = {k: v for k, v in c.dict(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.creators.update_one({"creator_id": creator_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Creator not found")
    return await db.creators.find_one({"creator_id": creator_id}, {"_id": 0})


@api_router.get("/admin/stats", dependencies=[Depends(require_admin)])
async def admin_stats():
    total_posts = await db.posts.count_documents({})
    total_creators = await db.creators.count_documents({})
    video_count = await db.posts.count_documents({"media_type": "video"})
    sponsored_count = await db.posts.count_documents({"is_sponsored": True})

    by_category = await db.posts.aggregate([
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(100)
    by_creator_raw = await db.posts.aggregate([
        {"$group": {"_id": "$creator_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(100)

    creators = {c["creator_id"]: c for c in await db.creators.find({}, {"_id": 0}).to_list(200)}
    by_creator = [
        {
            "creator_id": r["_id"],
            "name": creators.get(r["_id"], {}).get("name", r["_id"]),
            "count": r["count"],
        }
        for r in by_creator_raw
    ]

    return {
        "total_posts": total_posts,
        "total_creators": total_creators,
        "video_count": video_count,
        "sponsored_count": sponsored_count,
        "by_category": [{"category": r["_id"], "count": r["count"]} for r in by_category],
        "by_creator": by_creator,
    }


@api_router.delete("/admin/posts/{post_id}", dependencies=[Depends(require_admin)])
async def admin_delete_post(post_id: str):
    res = await db.posts.delete_one({"post_id": post_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"deleted": res.deleted_count}


@api_router.delete("/admin/creators/{creator_id}", dependencies=[Depends(require_admin)])
async def admin_delete_creator(creator_id: str):
    res = await db.creators.delete_one({"creator_id": creator_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Creator not found")
    # also remove that creator's posts to avoid orphans
    posts_res = await db.posts.delete_many({"creator_id": creator_id})
    return {"deleted_creator": res.deleted_count, "deleted_posts": posts_res.deleted_count}


@api_router.post("/admin/cleanup", dependencies=[Depends(require_admin)])
async def admin_cleanup():
    """Remove non-seed (admin/test created) creators & posts. Seed docs use the
    po_seed_* / cr_<known> ids and are preserved."""
    seed_creator_ids = [c["creator_id"] for c in SEED_CREATORS]
    posts_res = await db.posts.delete_many({"post_id": {"$not": {"$regex": "^po_seed_"}}})
    creators_res = await db.creators.delete_many({"creator_id": {"$nin": seed_creator_ids}})
    return {"deleted_posts": posts_res.deleted_count, "deleted_creators": creators_res.deleted_count}


# ---------- Seed ----------
SEED_CREATORS = [
    {
        "creator_id": "cr_morteza",
        "handle": "@morteza.safataj",
        "name": "Morteza Safataj",
        "bio": "Houston realtor sharing the city's untold stories, hidden gems & real estate moves.",
        "avatar": "https://images.unsplash.com/photo-1581841064838-a470c740e8ee?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwxfHxjYW5kaWQlMjBwb3J0cmFpdCUyMGNyZWF0b3IlMjBmYXNoaW9ufGVufDB8fHx8MTc4MDg5MDQyOXww&ixlib=rb-4.1.0&q=85",
        "cover": "https://images.unsplash.com/photo-1622007151631-25aa98ab394b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxob3VzdG9uJTIwc2t5bGluZSUyMGRheXRpbWV8ZW58MHx8fHwxNzgwODkwMjY4fDA&ixlib=rb-4.1.0&q=85",
        "city": "Houston",
        "categories": ["Real Estate", "Hidden Gems"],
        "followers": 18420,
    },
    {
        "creator_id": "cr_houstonfoodie",
        "handle": "@houston.foodie",
        "name": "Houston Foodie",
        "bio": "Chasing the city's best bites — from Heights cafés to Bellaire dumpling shops.",
        "avatar": "https://images.unsplash.com/photo-1617690032703-f991ed0e0ee6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwzfHxjYW5kaWQlMjBwb3J0cmFpdCUyMGNyZWF0b3IlMjBmYXNoaW9ufGVufDB8fHx8MTc4MDg5MDQyOXww&ixlib=rb-4.1.0&q=85",
        "cover": "https://images.unsplash.com/photo-1542372147193-a7aca54189cd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwxfHxhZXN0aGV0aWMlMjBjYWZlJTIwcGFzdHJ5JTIwY29mZmVlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
        "city": "Houston",
        "categories": ["Food", "Hidden Gems"],
        "followers": 32100,
    },
    {
        "creator_id": "cr_aroundhtx",
        "handle": "@around.htx",
        "name": "Around HTX",
        "bio": "Pop-ups, block parties, gallery nights — the things that don't make the news.",
        "avatar": "https://images.unsplash.com/photo-1631002724711-d1ae3cf651b0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwyfHxjYW5kaWQlMjBwb3J0cmFpdCUyMGNyZWF0b3IlMjBmYXNoaW9ufGVufDB8fHx8MTc4MDg5MDQyOXww&ixlib=rb-4.1.0&q=85",
        "cover": "https://images.pexels.com/photos/33089291/pexels-photo-33089291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "city": "Houston",
        "categories": ["Events", "Culture", "Nightlife"],
        "followers": 24560,
    },
    {
        "creator_id": "cr_bayouwalks",
        "handle": "@bayou.walks",
        "name": "Bayou Walks",
        "bio": "Sunrise trails, secret parks & quiet corners of Houston worth slowing down for.",
        "avatar": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
        "cover": "https://images.unsplash.com/photo-1542862127-9a4f7fcd1d96?w=900&q=80",
        "city": "Houston",
        "categories": ["Outdoor", "Hidden Gems"],
        "followers": 9870,
    },
]


# Stable, reliable sample videos (autoplay-friendly mp4 streams).
# IG source URLs expire, so we pair real captions with stable media.
SAMPLE_VIDEO_WORLDCUP = "https://media.w3.org/2010/05/sintel/trailer.mp4"
SAMPLE_VIDEO_MOTORCADE = "https://media.w3.org/2010/05/bunny/movie.mp4"

# Real Morteza Safataj captions ingested from the Instagram scrape (media swapped
# to stable Unsplash/sample-video URLs because the original IG URLs expire).
SEED_POSTS = [
    # ---------- Morteza Safataj (real captions) ----------
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=900&q=80",
        "caption": "Houston is hosting 7 matches and you don't need a ticket to experience it. Here's where to be.\n\n\U0001F3DF\uFE0F FIFA Fan Festival — Free. 34 days. No excuse.\n\U0001F3AA The Ranch Presents Pitch Live\n\U0001F4FA Tom's Watch Bar\n\u26BD Pitch 25\n\U0001F37A Social Beer Garden\n\U0001F33F Little Woodrow's\n\U0001F981 Velvet Oak Tavern\n\u2615 Toros HTX\n\nNo ticket? No problem. Send this to someone who needs a plan.\n\n— Morteza | Houston Realtor & Storyteller",
        "category": "Events",
        "neighborhood": "EaDo",
        "location_name": "FIFA Fan Festival",
        "lat": 29.7494, "lng": -95.3502,
        "media_type": "video",
        "video_url": SAMPLE_VIDEO_WORLDCUP,
        "hashtags": ["WorldCup2026", "Houston", "HoustonWorldCup", "FIFA2026", "HoustonSoccer"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZIKhogxLhG/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1622007151631-25aa98ab394b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxob3VzdG9uJTIwc2t5bGluZSUyMGRheXRpbWV8ZW58MHx8fHwxNzgwODkwMjY4fDA&ixlib=rb-4.1.0&q=85",
        "caption": "Houston is being rebuilt in real time — and most people have no idea. \U0001F440\n\n\u2192 The I-45 Rebuild — $13B, largest road project in Texas history\n\u2192 TMC Helix Park — $1.8B expansion of the world's largest medical center\n\u2192 Central Park at Post Oak — 150K+ sq ft on Houston's most elite corridor\n\u2192 George R. Brown Expansion — $2.3B, largest ballroom in Texas\n\u2192 Houston Ship Channel Project 11 — biggest upgrade in 100 years\n\u2192 Toro District — 83 acres, Texans HQ, $34B economic impact\n\u2192 The RO River Oaks — Houston's first Auberge hotel\n\nSave this. Which one are you going to first? \U0001F920",
        "category": "Real Estate",
        "neighborhood": "Citywide",
        "location_name": "Houston",
        "lat": 29.7604, "lng": -95.3698,
        "hashtags": ["HoustonRealEstate", "HoustonLife", "MoveToHouston", "HoustonDevelopment"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DXzfiUcxPWZ/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1459865264687-595d652de67e?w=900&q=80",
        "caption": "Houston is hosting the world's biggest soccer party — and it's completely free. The official FIFA Fan Festival is taking over EaDo for 34 days.\n\n\U0001F4CD 2301 Dallas St., East Downtown\n\U0001F4C5 June 11 – July 19 · 34 Match Days\n\u26BD Every match live on giant outdoor LED screens\n\U0001F3B5 Tejano and hip-hop on the main stage\n\U0001F356 Texas BBQ, Tex-Mex, Vietnamese pho and more\n\U0001F680 NASA Space City Zone · Kids Zone\n\U0001F39F Free entry · Legends Loft VIP available\n\nSave this and send it to your Houston crew. \u26BD",
        "category": "Events",
        "neighborhood": "East Downtown",
        "location_name": "FIFA Fan Festival · 2301 Dallas St",
        "lat": 29.7515, "lng": -95.3500,
        "hashtags": ["WorldCup2026", "Houston", "HoustonWorldCup", "FIFA2026", "HoustonSoccer"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DYKmARBkW3g/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=80",
        "caption": "200 rides. One city. One story.\n\nHouston's car cultures are uniting this Sunday — supercars, lowriders, motorcycles, slingshots, classics and more — all in memory of Killian and in honor of every child who has fought pediatric cancer. \U0001F49B\n\nProudly supporting @dreamrydes \U0001F91D\n\nComment \u201CMOTORCADE\u201D and I'll send you everything you need to be there.",
        "category": "Events",
        "neighborhood": "Citywide",
        "location_name": "Houston Charity Motorcade",
        "lat": 29.7604, "lng": -95.3698,
        "media_type": "video",
        "video_url": SAMPLE_VIDEO_MOTORCADE,
        "hashtags": ["Motorcade", "Houston", "DreamRydes"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZJEONzRxTl/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=900&q=80",
        "caption": "\U0001F30A Blue Lagoon in Huntsville TX is carved from two old limestone quarries — and the water is so vivid and clear it looks like something out of the Bahamas. Swimming, snorkeling, scuba — just an hour north of Houston. This one's going on the summer list.\n\n— Morteza | Houston Realtor & Storyteller",
        "category": "Outdoor",
        "neighborhood": "Huntsville, TX",
        "location_name": "Blue Lagoon Huntsville",
        "lat": 30.6630, "lng": -95.5688,
        "hashtags": ["Houston", "ThingsToDo", "BlueLagoon"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZP77erx3Wc/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900&q=80",
        "caption": "Houston is packed this weekend — Pride, supercars rolling through POST Houston, a free movie night at Discovery Green, live music on the bayou and more. Here's where to be June 5–7.\n\n\U0001F3F3\uFE0F\u200D\U0001F308 Pride Houston — Sat · City Hall · 11 AM–10 PM\n\U0001F697 Gumball 3000 — Sun · POST Houston · Free\n\U0001F3AC Screen on the Green — Fri · Discovery Green · Free\n\U0001F3B6 R&B Lovers Tour — Sat · Toyota Center · 8 PM\n\U0001F30A Beats on the Bayou — Fri · East River · Free\n\nSave this and send it to your Houston crew. \U0001F4F2",
        "category": "Events",
        "neighborhood": "Downtown",
        "location_name": "Around Houston · June 5–7",
        "lat": 29.7589, "lng": -95.3677,
        "hashtags": ["HoustonThingsToDo", "HoustonEvents", "HTown"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZK51HeORbm/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=900&q=80",
        "caption": "Houston has 8 spots that will make you feel like you've been living in the wrong neighborhood this whole time — hidden, historic, and mostly free. This city has been holding out on you.\n\nSave this for your next free weekend. Which one are you going to first? \U0001F447",
        "category": "Hidden Gems",
        "neighborhood": "Citywide",
        "location_name": "Houston Hidden Gems",
        "lat": 29.7604, "lng": -95.3698,
        "hashtags": ["HoustonThingsToDo", "HoustonLife", "HoustonLocal", "VisitHouston", "HTown"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DXzfiUcxPWZ/",
    },

    # ---------- Houston Foodie ----------
    {"creator_id": "cr_houstonfoodie", "image": "https://images.unsplash.com/photo-1542372147193-a7aca54189cd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwxfHxhZXN0aGV0aWMlMjBjYWZlJTIwcGFzdHJ5JTIwY29mZmVlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
     "caption": "Tout Suite's almond croissant is the most underrated pastry in EaDo. Get there before 10am or weep.",
     "category": "Food", "neighborhood": "EaDo", "location_name": "Tout Suite", "lat": 29.7505, "lng": -95.3491},
    {"creator_id": "cr_houstonfoodie", "image": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80",
     "caption": "A 12-table Sichuan spot in Chinatown opened last Tuesday. The mapo tofu numbed my lips for an hour. Worth it.",
     "category": "Food", "neighborhood": "Chinatown", "location_name": "Mala House", "lat": 29.7028, "lng": -95.5832},
    {"creator_id": "cr_houstonfoodie", "image": "https://images.pexels.com/photos/35508418/pexels-photo-35508418.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "caption": "The taco truck behind the laundromat on Wayside. No sign. Cash only. Best al pastor in the city — fight me.",
     "category": "Hidden Gems", "neighborhood": "East End", "location_name": "Tacos La Esquina", "lat": 29.7510, "lng": -95.3260},
    {"creator_id": "cr_houstonfoodie", "image": "https://images.unsplash.com/photo-1559054663-e8d23213f55c?w=800&q=80",
     "caption": "New natural wine bar in Montrose — Italian small plates, low lighting, no pretension. They poured me a Frappato I'm still thinking about.",
     "category": "Nightlife", "neighborhood": "Montrose", "location_name": "Vinea", "lat": 29.7430, "lng": -95.3905},
    {"creator_id": "cr_houstonfoodie", "image": "https://images.unsplash.com/photo-1481833761820-0509d3217039?w=800&q=80",
     "caption": "Saturday farmer's market at Rice Village. Get there at 8 for the kolaches before they vanish.",
     "category": "Food", "neighborhood": "Rice Village", "location_name": "Rice Village Farmer's Market", "lat": 29.7174, "lng": -95.4180},

    # ---------- Around HTX ----------
    {"creator_id": "cr_aroundhtx", "image": "https://images.pexels.com/photos/33089291/pexels-photo-33089291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "caption": "Friday night block party in the Heights — three bands, a hundred string lights, and the kind of crowd that still says hi to strangers.",
     "category": "Events", "neighborhood": "The Heights", "location_name": "19th Street", "lat": 29.7983, "lng": -95.3992},
    {"creator_id": "cr_aroundhtx", "image": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80",
     "caption": "Free outdoor jazz at Discovery Green every Thursday in October. Bring a blanket, leave the headphones.",
     "category": "Events", "neighborhood": "Downtown", "location_name": "Discovery Green", "lat": 29.7531, "lng": -95.3597},
    {"creator_id": "cr_aroundhtx", "image": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80",
     "caption": "Underground warehouse show this Saturday in the East End. DM for the address. Yes, that kind of night.",
     "category": "Nightlife", "neighborhood": "East End", "location_name": "Warehouse District", "lat": 29.7470, "lng": -95.3360},
    {"creator_id": "cr_aroundhtx", "image": "https://images.unsplash.com/photo-1604933834413-4cd1c2c98ad0?w=800&q=80",
     "caption": "Gallery openings, all in walking distance: three new shows in the Museum District this First Saturday.",
     "category": "Culture", "neighborhood": "Museum District", "location_name": "Museum District", "lat": 29.7257, "lng": -95.3884},
    {"creator_id": "cr_aroundhtx", "image": "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80",
     "caption": "Pop-up flower market on Saturday morning at White Oak Music Hall. Free coffee from the truck out back.",
     "category": "Events", "neighborhood": "Near Northside", "location_name": "White Oak Music Hall", "lat": 29.7891, "lng": -95.3641},

    # ---------- Bayou Walks ----------
    {"creator_id": "cr_bayouwalks", "image": "https://images.unsplash.com/photo-1542862127-9a4f7fcd1d96?w=900&q=80",
     "caption": "Sunrise on Buffalo Bayou — the cyclists, the herons, the slow gold light. Worth the 6am alarm.",
     "category": "Outdoor", "neighborhood": "Buffalo Bayou", "location_name": "Buffalo Bayou Park", "lat": 29.7600, "lng": -95.3950},
    {"creator_id": "cr_bayouwalks", "image": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80",
     "caption": "Hermann Park's secret reflecting pool side — most people miss it. Quiet, shaded, full of turtles.",
     "category": "Hidden Gems", "neighborhood": "Hermann Park", "location_name": "Hermann Park", "lat": 29.7196, "lng": -95.3902},
    {"creator_id": "cr_bayouwalks", "image": "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&q=80",
     "caption": "Memorial Park's Eastern Glades just opened a new trail loop — 2.3 miles, mostly shaded, runners' dream.",
     "category": "Outdoor", "neighborhood": "Memorial", "location_name": "Memorial Park", "lat": 29.7641, "lng": -95.4347},
    {"creator_id": "cr_bayouwalks", "image": "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800&q=80",
     "caption": "Bike rental kiosk just opened at Sabine St — $5 an hour, electric option, perfect for the bayou trail.",
     "category": "Outdoor", "neighborhood": "Sabine", "location_name": "Sabine Promenade", "lat": 29.7635, "lng": -95.3825},
]

SEED_VERSION = 3  # bump to force a reseed of creators + posts


async def run_migrations_and_seed():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.creators.create_index("creator_id", unique=True)
    await db.posts.create_index("post_id", unique=True)
    await db.posts.create_index("creator_id")
    await db.posts.create_index("category")

    meta = await db.app_meta.find_one({"_id": "seed"})
    current_version = meta["seed_version"] if meta else 0

    if current_version < SEED_VERSION:
        logger.info("Reseeding content: v%s -> v%s", current_version, SEED_VERSION)
        await db.creators.delete_many({})
        await db.posts.delete_many({})

        for c in SEED_CREATORS:
            await db.creators.insert_one(c)
        logger.info("Seeded %d creators", len(SEED_CREATORS))

        now = datetime.now(timezone.utc)
        for i, p in enumerate(SEED_POSTS):
            doc = Post(
                post_id=f"po_seed_{i:03d}",
                likes=100 + (i * 37) % 900,
                created_at=now - timedelta(hours=i * 5),
                **p,
            ).dict()
            await db.posts.insert_one(doc)
        logger.info("Seeded %d posts", len(SEED_POSTS))

        await db.app_meta.update_one(
            {"_id": "seed"}, {"$set": {"seed_version": SEED_VERSION}}, upsert=True
        )


@api_router.get("/")
async def root():
    return {"message": "Around You API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
