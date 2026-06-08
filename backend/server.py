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


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
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


class CreatorCreate(BaseModel):
    handle: str
    name: str
    bio: str
    avatar: str
    cover: Optional[str] = None
    categories: List[str] = []


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


# ---------- Admin (open for MVP) ----------
@api_router.post("/admin/creators")
async def admin_add_creator(c: CreatorCreate):
    creator = Creator(creator_id=f"cr_{uuid.uuid4().hex[:8]}", **c.dict()).dict()
    await db.creators.insert_one(creator)
    return await db.creators.find_one({"creator_id": creator["creator_id"]}, {"_id": 0})


@api_router.post("/admin/posts")
async def admin_add_post(p: PostCreate):
    post = Post(post_id=f"po_{uuid.uuid4().hex[:8]}", **p.dict()).dict()
    await db.posts.insert_one(post)
    return await db.posts.find_one({"post_id": post["post_id"]}, {"_id": 0})


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


SEED_POSTS = [
    # Morteza
    ("cr_morteza", "https://images.unsplash.com/photo-1628745277862-bc0b2d68c50c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwyfHxtb2Rlcm4lMjBob21lJTIwaW50ZXJpb3IlMjByZWFsJTIwZXN0YXRlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
     "A quiet $1.4M new build just listed off West University. Tucked behind an oak canopy, with a chef kitchen and a back garden made for slow Sundays.",
     "Real Estate", "West University", "West University Place", 29.7180, -95.4319),
    ("cr_morteza", "https://images.unsplash.com/photo-1613545325278-f24b0cae1224?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBob21lJTIwaW50ZXJpb3IlMjByZWFsJTIwZXN0YXRlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
     "Heights bungalow restoration — original 1923 floors, brand new soul. Open house Sunday 2-4pm if you want to feel it.",
     "Real Estate", "The Heights", "Heights Boulevard", 29.7977, -95.3984),
    ("cr_morteza", "https://images.unsplash.com/photo-1622007151631-25aa98ab394b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxob3VzdG9uJTIwc2t5bGluZSUyMGRheXRpbWV8ZW58MHx8fHwxNzgwODkwMjY4fDA&ixlib=rb-4.1.0&q=85",
     "Why Midtown is quietly becoming Houston's best long-term bet — three new mixed-use projects breaking ground this quarter.",
     "Real Estate", "Midtown", "Midtown Houston", 29.7383, -95.3768),
    ("cr_morteza", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80",
     "Found a 1950s ranch in Bellaire with the original terrazzo floors still intact. The owner's grandkids learned to walk on them.",
     "Hidden Gems", "Bellaire", "Bellaire", 29.7058, -95.4588),

    # Houston Foodie
    ("cr_houstonfoodie", "https://images.unsplash.com/photo-1542372147193-a7aca54189cd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwxfHxhZXN0aGV0aWMlMjBjYWZlJTIwcGFzdHJ5JTIwY29mZmVlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
     "Tout Suite's almond croissant is the most underrated pastry in EaDo. Get there before 10am or weep.",
     "Food", "EaDo", "Tout Suite", 29.7505, -95.3491),
    ("cr_houstonfoodie", "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80",
     "A 12-table Sichuan spot in Chinatown opened last Tuesday. The mapo tofu numbed my lips for an hour. Worth it.",
     "Food", "Chinatown", "Mala House", 29.7028, -95.5832),
    ("cr_houstonfoodie", "https://images.pexels.com/photos/35508418/pexels-photo-35508418.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "The taco truck behind the laundromat on Wayside. No sign. Cash only. Best al pastor in the city — fight me.",
     "Hidden Gems", "East End", "Tacos La Esquina", 29.7510, -95.3260),
    ("cr_houstonfoodie", "https://images.unsplash.com/photo-1559054663-e8d23213f55c?w=800&q=80",
     "New natural wine bar in Montrose — Italian small plates, low lighting, no pretension. They poured me a Frappato I'm still thinking about.",
     "Nightlife", "Montrose", "Vinea", 29.7430, -95.3905),
    ("cr_houstonfoodie", "https://images.unsplash.com/photo-1481833761820-0509d3217039?w=800&q=80",
     "Saturday farmer's market at Rice Village. Get there at 8 for the kolaches before they vanish.",
     "Food", "Rice Village", "Rice Village Farmer's Market", 29.7174, -95.4180),

    # Around HTX
    ("cr_aroundhtx", "https://images.pexels.com/photos/33089291/pexels-photo-33089291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "Friday night block party in the Heights — three bands, a hundred string lights, and the kind of crowd that still says hi to strangers.",
     "Events", "The Heights", "19th Street", 29.7983, -95.3992),
    ("cr_aroundhtx", "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80",
     "Free outdoor jazz at Discovery Green every Thursday in October. Bring a blanket, leave the headphones.",
     "Events", "Downtown", "Discovery Green", 29.7531, -95.3597),
    ("cr_aroundhtx", "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80",
     "Underground warehouse show this Saturday in the East End. DM for the address. Yes, that kind of night.",
     "Nightlife", "East End", "Warehouse District", 29.7470, -95.3360),
    ("cr_aroundhtx", "https://images.unsplash.com/photo-1604933834413-4cd1c2c98ad0?w=800&q=80",
     "Gallery openings, all in walking distance: three new shows in the Museum District this First Saturday.",
     "Culture", "Museum District", "Museum District", 29.7257, -95.3884),
    ("cr_aroundhtx", "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80",
     "Pop-up flower market on Saturday morning at White Oak Music Hall. Free coffee from the truck out back.",
     "Events", "Near Northside", "White Oak Music Hall", 29.7891, -95.3641),

    # Bayou Walks
    ("cr_bayouwalks", "https://images.unsplash.com/photo-1542862127-9a4f7fcd1d96?w=900&q=80",
     "Sunrise on Buffalo Bayou — the cyclists, the herons, the slow gold light. Worth the 6am alarm.",
     "Outdoor", "Buffalo Bayou", "Buffalo Bayou Park", 29.7600, -95.3950),
    ("cr_bayouwalks", "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80",
     "Hermann Park's secret reflecting pool side — most people miss it. Quiet, shaded, full of turtles.",
     "Hidden Gems", "Hermann Park", "Hermann Park", 29.7196, -95.3902),
    ("cr_bayouwalks", "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&q=80",
     "Memorial Park's Eastern Glades just opened a new trail loop — 2.3 miles, mostly shaded, runners' dream.",
     "Outdoor", "Memorial", "Memorial Park", 29.7641, -95.4347),
    ("cr_bayouwalks", "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800&q=80",
     "Bike rental kiosk just opened at Sabine St — $5 an hour, electric option, perfect for the bayou trail.",
     "Outdoor", "Sabine", "Sabine Promenade", 29.7635, -95.3825),
]


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.creators.create_index("creator_id", unique=True)
    await db.posts.create_index("post_id", unique=True)
    await db.posts.create_index("creator_id")
    await db.posts.create_index("category")

    if await db.creators.count_documents({}) == 0:
        for c in SEED_CREATORS:
            await db.creators.insert_one(c)
        logger.info("Seeded %d creators", len(SEED_CREATORS))

    if await db.posts.count_documents({}) == 0:
        now = datetime.now(timezone.utc)
        for i, (creator_id, image, caption, category, neighborhood, loc, lat, lng) in enumerate(SEED_POSTS):
            doc = Post(
                post_id=f"po_seed_{i:03d}",
                creator_id=creator_id,
                image=image,
                caption=caption,
                category=category,
                neighborhood=neighborhood,
                location_name=loc,
                lat=lat,
                lng=lng,
                likes=100 + (i * 37) % 900,
                created_at=now - timedelta(hours=i * 5),
            ).dict()
            await db.posts.insert_one(doc)
        logger.info("Seeded %d posts", len(SEED_POSTS))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


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
