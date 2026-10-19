"""Demo dataset for a fresh database.

Two important differences from the MongoDB version this replaces:

  * Startup seeding is never destructive. It only runs when creators and posts
    are both empty, so booting a populated environment can no longer wipe real
    content. The old code deleted every creator and post whenever SEED_VERSION
    was bumped.
  * A destructive reseed is still available, but it takes an explicit human
    action: `python -m app.seed --force`.

Run standalone with:
    python -m app.seed            # seed only if empty
    python -m app.seed --force    # wipe demo content and reseed
"""

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone

from app import db
from app.repositories import content

logger = logging.getLogger(__name__)

SEED_VERSION = 3

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

# Instagram media URLs expire, so real captions are paired with stable media.
SAMPLE_VIDEO_WORLDCUP = "https://media.w3.org/2010/05/sintel/trailer.mp4"
SAMPLE_VIDEO_MOTORCADE = "https://media.w3.org/2010/05/bunny/movie.mp4"

SEED_POSTS = [
    # ---------- Morteza Safataj (real captions) ----------
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=900&q=80",
        "caption": "Houston is hosting 7 matches and you don't need a ticket to experience it. Here's where to be.\n\n\U0001F3DF️ FIFA Fan Festival — Free. 34 days. No excuse.\n\U0001F3AA The Ranch Presents Pitch Live\n\U0001F4FA Tom's Watch Bar\n⚽ Pitch 25\n\U0001F37A Social Beer Garden\n\U0001F33F Little Woodrow's\n\U0001F981 Velvet Oak Tavern\n☕ Toros HTX\n\nNo ticket? No problem. Send this to someone who needs a plan.\n\n— Morteza | Houston Realtor & Storyteller",
        "category": "Events",
        "neighborhood": "EaDo",
        "location_name": "FIFA Fan Festival",
        "lat": 29.7494,
        "lng": -95.3502,
        "media_type": "video",
        "video_url": SAMPLE_VIDEO_WORLDCUP,
        "hashtags": ["WorldCup2026", "Houston", "HoustonWorldCup", "FIFA2026", "HoustonSoccer"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZIKhogxLhG/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1622007151631-25aa98ab394b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxob3VzdG9uJTIwc2t5bGluZSUyMGRheXRpbWV8ZW58MHx8fHwxNzgwODkwMjY4fDA&ixlib=rb-4.1.0&q=85",
        "caption": "Houston is being rebuilt in real time — and most people have no idea. \U0001F440\n\n→ The I-45 Rebuild — $13B, largest road project in Texas history\n→ TMC Helix Park — $1.8B expansion of the world's largest medical center\n→ Central Park at Post Oak — 150K+ sq ft on Houston's most elite corridor\n→ George R. Brown Expansion — $2.3B, largest ballroom in Texas\n→ Houston Ship Channel Project 11 — biggest upgrade in 100 years\n→ Toro District — 83 acres, Texans HQ, $34B economic impact\n→ The RO River Oaks — Houston's first Auberge hotel\n\nSave this. Which one are you going to first? \U0001F920",
        "category": "Real Estate",
        "neighborhood": "Citywide",
        "location_name": "Houston",
        "lat": 29.7604,
        "lng": -95.3698,
        "hashtags": ["HoustonRealEstate", "HoustonLife", "MoveToHouston", "HoustonDevelopment"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DXzfiUcxPWZ/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1459865264687-595d652de67e?w=900&q=80",
        "caption": "Houston is hosting the world's biggest soccer party — and it's completely free. The official FIFA Fan Festival is taking over EaDo for 34 days.\n\n\U0001F4CD 2301 Dallas St., East Downtown\n\U0001F4C5 June 11 – July 19 · 34 Match Days\n⚽ Every match live on giant outdoor LED screens\n\U0001F3B5 Tejano and hip-hop on the main stage\n\U0001F356 Texas BBQ, Tex-Mex, Vietnamese pho and more\n\U0001F680 NASA Space City Zone · Kids Zone\n\U0001F39F Free entry · Legends Loft VIP available\n\nSave this and send it to your Houston crew. ⚽",
        "category": "Events",
        "neighborhood": "East Downtown",
        "location_name": "FIFA Fan Festival · 2301 Dallas St",
        "lat": 29.7515,
        "lng": -95.3500,
        "hashtags": ["WorldCup2026", "Houston", "HoustonWorldCup", "FIFA2026", "HoustonSoccer"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DYKmARBkW3g/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=80",
        "caption": "200 rides. One city. One story.\n\nHouston's car cultures are uniting this Sunday — supercars, lowriders, motorcycles, slingshots, classics and more — all in memory of Killian and in honor of every child who has fought pediatric cancer. \U0001F49B\n\nProudly supporting @dreamrydes \U0001F91D\n\nComment “MOTORCADE” and I'll send you everything you need to be there.",
        "category": "Events",
        "neighborhood": "Citywide",
        "location_name": "Houston Charity Motorcade",
        "lat": 29.7604,
        "lng": -95.3698,
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
        "lat": 30.6630,
        "lng": -95.5688,
        "hashtags": ["Houston", "ThingsToDo", "BlueLagoon"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DZP77erx3Wc/",
    },
    {
        "creator_id": "cr_morteza",
        "image": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900&q=80",
        "caption": "Houston is packed this weekend — Pride, supercars rolling through POST Houston, a free movie night at Discovery Green, live music on the bayou and more. Here's where to be June 5–7.\n\n\U0001F3F3️‍\U0001F308 Pride Houston — Sat · City Hall · 11 AM–10 PM\n\U0001F697 Gumball 3000 — Sun · POST Houston · Free\n\U0001F3AC Screen on the Green — Fri · Discovery Green · Free\n\U0001F3B6 R&B Lovers Tour — Sat · Toyota Center · 8 PM\n\U0001F30A Beats on the Bayou — Fri · East River · Free\n\nSave this and send it to your Houston crew. \U0001F4F2",
        "category": "Events",
        "neighborhood": "Downtown",
        "location_name": "Around Houston · June 5–7",
        "lat": 29.7589,
        "lng": -95.3677,
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
        "lat": 29.7604,
        "lng": -95.3698,
        "hashtags": ["HoustonThingsToDo", "HoustonLife", "HoustonLocal", "VisitHouston", "HTown"],
        "source": "Instagram",
        "original_url": "https://www.instagram.com/p/DXzfiUcxPWZ/",
    },
    # ---------- Houston Foodie ----------
    {
        "creator_id": "cr_houstonfoodie",
        "image": "https://images.unsplash.com/photo-1542372147193-a7aca54189cd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwxfHxhZXN0aGV0aWMlMjBjYWZlJTIwcGFzdHJ5JTIwY29mZmVlfGVufDB8fHx8MTc4MDg5MDI2OHww&ixlib=rb-4.1.0&q=85",
        "caption": "Tout Suite's almond croissant is the most underrated pastry in EaDo. Get there before 10am or weep.",
        "category": "Food",
        "neighborhood": "EaDo",
        "location_name": "Tout Suite",
        "lat": 29.7505,
        "lng": -95.3491,
    },
    {
        "creator_id": "cr_houstonfoodie",
        "image": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80",
        "caption": "A 12-table Sichuan spot in Chinatown opened last Tuesday. The mapo tofu numbed my lips for an hour. Worth it.",
        "category": "Food",
        "neighborhood": "Chinatown",
        "location_name": "Mala House",
        "lat": 29.7028,
        "lng": -95.5832,
    },
    {
        "creator_id": "cr_houstonfoodie",
        "image": "https://images.pexels.com/photos/35508418/pexels-photo-35508418.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "caption": "The taco truck behind the laundromat on Wayside. No sign. Cash only. Best al pastor in the city — fight me.",
        "category": "Hidden Gems",
        "neighborhood": "East End",
        "location_name": "Tacos La Esquina",
        "lat": 29.7510,
        "lng": -95.3260,
    },
    {
        "creator_id": "cr_houstonfoodie",
        "image": "https://images.unsplash.com/photo-1559054663-e8d23213f55c?w=800&q=80",
        "caption": "New natural wine bar in Montrose — Italian small plates, low lighting, no pretension. They poured me a Frappato I'm still thinking about.",
        "category": "Nightlife",
        "neighborhood": "Montrose",
        "location_name": "Vinea",
        "lat": 29.7430,
        "lng": -95.3905,
    },
    {
        "creator_id": "cr_houstonfoodie",
        "image": "https://images.unsplash.com/photo-1481833761820-0509d3217039?w=800&q=80",
        "caption": "Saturday farmer's market at Rice Village. Get there at 8 for the kolaches before they vanish.",
        "category": "Food",
        "neighborhood": "Rice Village",
        "location_name": "Rice Village Farmer's Market",
        "lat": 29.7174,
        "lng": -95.4180,
    },
    # ---------- Around HTX ----------
    {
        "creator_id": "cr_aroundhtx",
        "image": "https://images.pexels.com/photos/33089291/pexels-photo-33089291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "caption": "Friday night block party in the Heights — three bands, a hundred string lights, and the kind of crowd that still says hi to strangers.",
        "category": "Events",
        "neighborhood": "The Heights",
        "location_name": "19th Street",
        "lat": 29.7983,
        "lng": -95.3992,
    },
    {
        "creator_id": "cr_aroundhtx",
        "image": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80",
        "caption": "Free outdoor jazz at Discovery Green every Thursday in October. Bring a blanket, leave the headphones.",
        "category": "Events",
        "neighborhood": "Downtown",
        "location_name": "Discovery Green",
        "lat": 29.7531,
        "lng": -95.3597,
    },
    {
        "creator_id": "cr_aroundhtx",
        "image": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80",
        "caption": "Underground warehouse show this Saturday in the East End. DM for the address. Yes, that kind of night.",
        "category": "Nightlife",
        "neighborhood": "East End",
        "location_name": "Warehouse District",
        "lat": 29.7470,
        "lng": -95.3360,
    },
    {
        "creator_id": "cr_aroundhtx",
        "image": "https://images.unsplash.com/photo-1604933834413-4cd1c2c98ad0?w=800&q=80",
        "caption": "Gallery openings, all in walking distance: three new shows in the Museum District this First Saturday.",
        "category": "Culture",
        "neighborhood": "Museum District",
        "location_name": "Museum District",
        "lat": 29.7257,
        "lng": -95.3884,
    },
    {
        "creator_id": "cr_aroundhtx",
        "image": "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80",
        "caption": "Pop-up flower market on Saturday morning at White Oak Music Hall. Free coffee from the truck out back.",
        "category": "Events",
        "neighborhood": "Near Northside",
        "location_name": "White Oak Music Hall",
        "lat": 29.7891,
        "lng": -95.3641,
    },
    # ---------- Bayou Walks ----------
    {
        "creator_id": "cr_bayouwalks",
        "image": "https://images.unsplash.com/photo-1542862127-9a4f7fcd1d96?w=900&q=80",
        "caption": "Sunrise on Buffalo Bayou — the cyclists, the herons, the slow gold light. Worth the 6am alarm.",
        "category": "Outdoor",
        "neighborhood": "Buffalo Bayou",
        "location_name": "Buffalo Bayou Park",
        "lat": 29.7600,
        "lng": -95.3950,
    },
    {
        "creator_id": "cr_bayouwalks",
        "image": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80",
        "caption": "Hermann Park's secret reflecting pool side — most people miss it. Quiet, shaded, full of turtles.",
        "category": "Hidden Gems",
        "neighborhood": "Hermann Park",
        "location_name": "Hermann Park",
        "lat": 29.7196,
        "lng": -95.3902,
    },
    {
        "creator_id": "cr_bayouwalks",
        "image": "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&q=80",
        "caption": "Memorial Park's Eastern Glades just opened a new trail loop — 2.3 miles, mostly shaded, runners' dream.",
        "category": "Outdoor",
        "neighborhood": "Memorial",
        "location_name": "Memorial Park",
        "lat": 29.7641,
        "lng": -95.4347,
    },
    {
        "creator_id": "cr_bayouwalks",
        "image": "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800&q=80",
        "caption": "Bike rental kiosk just opened at Sabine St — $5 an hour, electric option, perfect for the bayou trail.",
        "category": "Outdoor",
        "neighborhood": "Sabine",
        "location_name": "Sabine Promenade",
        "lat": 29.7635,
        "lng": -95.3825,
    },
]


async def _is_empty() -> bool:
    count = await db.fetchval(
        """
        SELECT (SELECT count(*) FROM creators WHERE deleted_at IS NULL)
             + (SELECT count(*) FROM posts WHERE deleted_at IS NULL)
        """
    )
    return count == 0


async def _insert_dataset() -> tuple[int, int]:
    for creator in SEED_CREATORS:
        await content.insert_creator(creator)

    now = datetime.now(timezone.utc)
    for i, post in enumerate(SEED_POSTS):
        await content.insert_post(
            {
                **post,
                "post_id": f"po_seed_{i:03d}",
                # Deterministic spread so the feed has a believable timeline.
                "likes": 100 + (i * 37) % 900,
                "created_at": now - timedelta(hours=i * 5),
            }
        )

    await db.execute(
        """
        INSERT INTO app_meta (key, value)
        VALUES ('seed', jsonb_build_object('seed_version', $1::int))
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW()
        """,
        SEED_VERSION,
    )
    return len(SEED_CREATORS), len(SEED_POSTS)


async def seed_if_empty() -> bool:
    """Safe path used at startup. Never deletes anything."""
    if not await _is_empty():
        logger.info("Content already present — skipping seed")
        return False
    creators, posts = await _insert_dataset()
    logger.info("Seeded %d creators and %d posts", creators, posts)
    return True


async def reseed_force() -> tuple[int, int]:
    """Destructive. Only reachable from the CLI, never from startup or HTTP."""
    logger.warning("Force reseed: deleting all creators and posts")
    await db.execute("DELETE FROM posts")
    await db.execute("DELETE FROM creators")
    return await _insert_dataset()


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    force = "--force" in sys.argv
    await db.connect()
    await db.run_migrations()
    try:
        if force:
            creators, posts = await reseed_force()
            print(f"Reseeded {creators} creators and {posts} posts.")
        elif await seed_if_empty():
            print(f"Seeded {len(SEED_CREATORS)} creators and {len(SEED_POSTS)} posts.")
        else:
            print("Database already has content. Use --force to wipe and reseed.")
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(_main())
