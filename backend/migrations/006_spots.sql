-- Around You — spots, appreciation and per-region rank.
--
-- A post is a moment; a spot is a place that accumulates. One person finds it,
-- everyone else adds photos, marks "I went", and confirms it is still good. The
-- reward is attributable discovery ("68 people went because of Ana") plus a
-- scarce appreciation that feeds a five-tier, per-region rank.
--
-- Same conventions as 001/002:
--   * TEXT everywhere, never VARCHAR.
--   * No FOREIGN KEY constraints; relationships are enforced in the application.
--   * Soft deletes via deleted_at; partial indexes cover the active-row queries.
--   * All timestamps are TIMESTAMPTZ (UTC).
--   * Semantic TEXT primary keys (spt_a1b2c3d4, sph_..., ntf_...), generated in
--     Python. uuid_generate_v4() is not used anywhere in this schema.
--   * update_updated_at() is defined in 001_init.sql and reused, never redefined.
--
--
-- DESIGN NOTE — there are no denormalised counters here, on purpose.
--
-- Every ranking input is a rolling time window:
--     score = visits_attributed_90d + 0.5*appreciations_90d + 0.25*confirmations_30d
-- and a stored counter cannot represent a window. A counter holds "ever";
-- yesterday's correct counter is wrong today because rows aged out, with no
-- write having happened anywhere.
--
-- Two of the anti-abuse rules are also retroactive: an appreciation becomes
-- rank-eligible the moment its author's account turns seven days old, and
-- un-hiding a spot restores its credit. No write occurs at either transition,
-- so no counter could observe them.
--
-- The usual answer would be a nightly recompute, but this codebase has no
-- scheduler — expire_stale_events() and archive_idle_communities() are defined
-- in 002 and never called from Python. So everything below is a raw event log,
-- aggregated live behind a five-minute cache. Nothing can drift because nothing
-- is stored twice.


-- ---------- spots ----------
CREATE TABLE IF NOT EXISTS spots (
  spot_id           TEXT PRIMARY KEY,
  region_id         TEXT NOT NULL,
  -- The attribution subject. Deliberately not called created_by: the per-spot
  -- Finder role and the platform-wide Creator role are different things, and
  -- reusing communities.created_by's name would blur them.
  finder_user_id    TEXT NOT NULL,

  name              TEXT NOT NULL,
  -- Lower-cased, accent-folded, punctuation-stripped, leading article dropped.
  -- Written by Python at create/rename time so the duplicate guard and name
  -- search both compare one canonical form.
  name_normalised   TEXT NOT NULL DEFAULT '',
  blurb             TEXT NOT NULL DEFAULT '',
  best_time         TEXT,
  category          TEXT,
  address           TEXT,
  -- NOT NULL: a spot is a place. The map and the 60m duplicate guard both
  -- require coordinates, and unlike events there is no "approximate" mode.
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,

  -- Fragile places. Excluded from ranking, Explore and every trending surface,
  -- but still findable by name and still on the map. Only the finder toggles it.
  is_quiet          BOOLEAN NOT NULL DEFAULT FALSE,
  -- Anti-farming: turning quiet OFF is allowed once, ever, so nobody can go
  -- quiet, gather visits unseen, then flip public. A counter rather than a
  -- boolean so "how many times" stays answerable.
  quiet_unset_count INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'closed'
  -- Drives "Reported closed in June". status alone cannot render that string.
  status_changed_at TIMESTAMPTZ,
  status_changed_by TEXT,

  -- Moderation, kept strictly separate from deleted_at. "Removal hides, never
  -- deletes" is a product promise; and the tier query needs the *moment* of
  -- hiding to honour "tiers never decrease from moderation" — visits recorded
  -- before hidden_at keep their credit, visits after it earn nothing.
  hidden_at         TIMESTAMPTZ,
  hidden_by         TEXT,
  hidden_reason     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);

-- The ranked-list candidate set, and the cold-start region count.
CREATE INDEX IF NOT EXISTS idx_spots_region_ranked
  ON spots (region_id, category)
  WHERE deleted_at IS NULL AND hidden_at IS NULL
    AND status = 'active' AND is_quiet = FALSE;

-- Map viewport and the duplicate-guard bounding box. Quiet and closed spots are
-- deliberately inside this index: both stay visible on the map. No PostGIS —
-- bbox prefilter here plus haversine in SQL, exactly as idx_events_coords does.
CREATE INDEX IF NOT EXISTS idx_spots_coords
  ON spots (lat, lng) WHERE deleted_at IS NULL AND hidden_at IS NULL;

-- Name search, which unlike Explore does surface quiet spots.
CREATE INDEX IF NOT EXISTS idx_spots_region_name
  ON spots (region_id, name_normalised)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;

-- "Spots I found", the tier aggregate, and the five-a-day cap. Intentionally
-- NOT partial on deleted_at: the cap must count deleted rows too, or
-- delete-and-recreate becomes an unlimited quota.
CREATE INDEX IF NOT EXISTS idx_spots_finder_created
  ON spots (finder_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spots_hidden
  ON spots (hidden_at) WHERE hidden_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_spots_updated_at ON spots;
CREATE TRIGGER trg_spots_updated_at BEFORE UPDATE ON spots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- spot_photos ----------
-- Anyone signed in may add one. There is no hero_photo_id on spots: the hero is
-- derived as the oldest surviving photo, so hiding a photo silently promotes the
-- next one instead of leaving a dangling pointer.
CREATE TABLE IF NOT EXISTS spot_photos (
  spot_photo_id TEXT PRIMARY KEY,
  spot_id       TEXT NOT NULL,
  -- Every photo is attributable, and this is what the 20-a-day cap counts.
  user_id       TEXT NOT NULL,
  url           TEXT NOT NULL,                  -- Cloudinary secure_url
  caption       TEXT NOT NULL DEFAULT '',
  width         INTEGER,
  height        INTEGER,
  -- Staff may hide one photo without hiding the spot.
  hidden_at     TIMESTAMPTZ,
  hidden_by     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ASC, not DESC: the hero is the OLDEST surviving photo, so this one index
-- serves both the gallery and the LIMIT 1 hero lookup.
CREATE INDEX IF NOT EXISTS idx_spot_photos_spot
  ON spot_photos (spot_id, created_at)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;

-- The 20-a-day cap. Non-partial, for the same reason as idx_spots_finder_created.
CREATE INDEX IF NOT EXISTS idx_spot_photos_user_created
  ON spot_photos (user_id, created_at DESC);


-- ---------- spot_visits ----------
-- "I went." The composite primary key gives idempotency for free, exactly like
-- bookmarks and reactions. One row per person per spot, ever — "41 people went"
-- counts people, not trips, so there is no history worth keeping.
CREATE TABLE IF NOT EXISTS spot_visits (
  spot_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (spot_id, user_id)
);

-- The PK covers spot_id lookups but not the 90-day window as a range scan.
CREATE INDEX IF NOT EXISTS idx_spot_visits_spot_recent
  ON spot_visits (spot_id, created_at DESC);
-- "Spots I have been to", and the "has this account ever recorded a visit?"
-- half of the appreciation trust gate.
CREATE INDEX IF NOT EXISTS idx_spot_visits_user
  ON spot_visits (user_id, created_at DESC);


-- ---------- spot_appreciations ----------
-- The scarce currency: five per user per REGION per week.
CREATE TABLE IF NOT EXISTS spot_appreciations (
  spot_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- Denormalised from spots. The budget question is "how many did I spend in
  -- region R this week", and carrying region_id here makes that one index range
  -- scan with no join. A spot never changes region, so this cannot drift: it is
  -- a copied immutable, not a counter.
  region_id  TEXT NOT NULL,
  -- The week the budget was debited against. NEVER updated — moving it would
  -- silently refund a spent unit.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL means currently appreciated. Whether revoking refunded the budget is
  -- derived rather than stored: (revoked_at - created_at) < 60s.
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (spot_id, user_id)
);

-- The displayed count and the score's 90-day term.
CREATE INDEX IF NOT EXISTS idx_spot_appreciations_spot_live
  ON spot_appreciations (spot_id, created_at DESC) WHERE revoked_at IS NULL;
-- The weekly budget check, in one range scan.
CREATE INDEX IF NOT EXISTS idx_spot_appreciations_budget
  ON spot_appreciations (user_id, region_id, created_at DESC);


-- ---------- spot_confirmations ----------
-- "Still good." Deliberately one row per (spot, user) with a refreshed
-- confirmed_at, NOT an append-only log.
--
-- Append-only would let one account confirm daily and contribute 30 * 0.25 = 7.5
-- to a spot's score in a month, which is the cheapest possible farm. This shape
-- makes confirmations_30d mean "distinct people who vouched for it recently",
-- capping any one account at 0.25.
--
-- It also sidesteps a trap: enforcing one-per-day with a unique index on
-- (spot_id, user_id, created_at::date) is impossible, because casting a
-- TIMESTAMPTZ to date depends on the session TimeZone setting and is therefore
-- not IMMUTABLE. Postgres rejects such an index outright, the migration fails,
-- and startup takes the whole API down with it.
CREATE TABLE IF NOT EXISTS spot_confirmations (
  spot_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- first time they vouched
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- most recent; the 30d window reads this
  PRIMARY KEY (spot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_spot_confirmations_spot_recent
  ON spot_confirmations (spot_id, confirmed_at DESC);


-- ---------- spot_saves ----------
-- Shortlisting a place you have not been to yet. Kept separate from `bookmarks`
-- rather than generalising that table: bookmarks is post-shaped and live, and
-- the Saved tab reads it directly.
CREATE TABLE IF NOT EXISTS spot_saves (
  spot_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (spot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_spot_saves_user
  ON spot_saves (user_id, created_at DESC);


-- ---------- notifications ----------
-- In-app inbox. No email, no push.
--
-- No title/body columns: the sentence is rendered at read time from `type` and
-- `data`, so a copy change applies retroactively to notifications already
-- sitting in someone's inbox and needs no migration.
--
-- dedupe_key is the one piece of durable state this whole feature keeps, and it
-- is an idempotency key rather than a counter. It carries three jobs:
--   'appr:{spot_id}:{actor_user_id}'  — one per appreciator per spot, ever
--   'visit:{spot_id}:{YYYY-MM-DD}'    — "first visit per spot per day is enough"
--   'tier:{region_id}:{tier}'         — "you reached a new tier", exactly once
-- The third is what makes a tier notification possible at all: tier is computed
-- live, and live computation is stateless, so it can report the current tier but
-- never that it just changed. This row is the watermark.
CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,                     -- recipient
  type            TEXT NOT NULL,
  -- 'spot_appreciated' | 'spot_visited' | 'tier_reached'
  region_id       TEXT,
  actor_user_id   TEXT,                              -- NULL for tier_reached
  target_type     TEXT,                              -- 'spot'
  target_id       TEXT,
  -- Structured facts the client renders and deep-links from:
  -- {spot_name, actor_name, tier, tier_label, count}
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (user_id, created_at DESC);
-- The unread badge is read on every app foreground; keep it to a partial index
-- over only the rows that can satisfy it.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;
-- The idempotency guarantee itself.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
