-- Around You — communities, events and role-based access control.
--
-- Same conventions as 001_init.sql:
--   * TEXT everywhere, never VARCHAR.
--   * No FOREIGN KEY constraints; relationships are enforced in the application.
--   * Soft deletes via deleted_at; partial indexes cover the active-row queries.
--   * All timestamps are TIMESTAMPTZ (UTC).
--   * Semantic TEXT primary keys (reg_houston, com_a1b2c3d4, cp_..., ev_...).
--
-- The update_updated_at() trigger function is defined in 001_init.sql and is
-- reused here rather than redefined.
--
-- This migration turns a read-only single-city feed into a participatory app:
--   1. regions become first-class (also unblocks the multi-city roadmap item)
--   2. users gain a platform role and an optional link to a creator profile
--   3. communities, memberships, posts and comments
--   4. events and RSVPs (schema now, endpoints in a later milestone)
--   5. reports and blocks


-- ---------- regions ----------
-- "Houston" was previously a hardcoded default on creators.city and a free-text
-- posts.neighborhood. Promoting it to an entity is what lets communities,
-- creators and events be scoped to a place.
CREATE TABLE IF NOT EXISTS regions (
  region_id  TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  state      TEXT,
  country    TEXT NOT NULL DEFAULT 'US',
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_slug_unique
  ON regions (LOWER(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_regions_active
  ON regions (name) WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_regions_updated_at ON regions;
CREATE TRIGGER trg_regions_updated_at BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- The one region that exists today. Everything below backfills against it.
INSERT INTO regions (region_id, slug, name, state, country, timezone,
                     center_lat, center_lng)
VALUES ('reg_houston', 'houston', 'Houston', 'TX', 'US', 'America/Chicago',
        29.7604, -95.3698)
ON CONFLICT (region_id) DO NOTHING;


-- ---------- users: platform role ----------
-- platform_role is global and orthogonal to community_members.role, which is
-- per-community. A person can be a creator for Houston, head of one community
-- and a plain member of three others at the same time; one column cannot say
-- that, so the two layers are kept separate.
--   'user'    — browse, follow, join, RSVP
--   'creator' — publish regional editorial posts (see creator_regions)
--   'staff'   — platform admin; supersedes the is_admin boolean
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role  TEXT NOT NULL DEFAULT 'user';
-- Links a login to an editorial creator profile. Until now creators had no
-- connection to users at all — content was typed in through the admin screen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_region_id TEXT;

UPDATE users SET platform_role = 'staff'
  WHERE is_admin = TRUE AND platform_role = 'user';

UPDATE users SET home_region_id = 'reg_houston' WHERE home_region_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_platform_role
  ON users (platform_role) WHERE deleted_at IS NULL;
-- Partial unique: one login per creator profile, ignoring soft-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_creator_id_unique
  ON users (creator_id) WHERE creator_id IS NOT NULL AND deleted_at IS NULL;


-- ---------- creators / posts: region scoping ----------
ALTER TABLE creators ADD COLUMN IF NOT EXISTS region_id TEXT;
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS region_id TEXT;

UPDATE creators SET region_id = 'reg_houston' WHERE region_id IS NULL;
UPDATE posts    SET region_id = 'reg_houston' WHERE region_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_creators_region_active
  ON creators (region_id) WHERE deleted_at IS NULL;
-- Mirrors idx_posts_feed but scoped to a region, for the per-region feed.
CREATE INDEX IF NOT EXISTS idx_posts_region_feed
  ON posts (region_id, created_at DESC) WHERE deleted_at IS NULL;


-- ---------- creator_regions ----------
-- Which regions a creator is authorised to publish into. A creator covering
-- both Houston and Austin simply has two rows.
CREATE TABLE IF NOT EXISTS creator_regions (
  creator_id TEXT NOT NULL,
  region_id  TEXT NOT NULL,
  granted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (creator_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_regions_region ON creator_regions (region_id);

-- Every existing creator keeps publishing rights where they already publish.
INSERT INTO creator_regions (creator_id, region_id)
SELECT creator_id, 'reg_houston' FROM creators WHERE deleted_at IS NULL
ON CONFLICT (creator_id, region_id) DO NOTHING;


-- ---------- communities ----------
-- A community is an interest group that lives inside a region
-- ("Houston Climbers"), not the region itself.
CREATE TABLE IF NOT EXISTS communities (
  community_id     TEXT PRIMARY KEY,
  region_id        TEXT NOT NULL,
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  avatar           TEXT,
  cover            TEXT,
  category         TEXT,
  visibility       TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'private'
  join_policy      TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'request' | 'invite'
  member_count     INTEGER NOT NULL DEFAULT 0,
  post_count       INTEGER NOT NULL DEFAULT 0,
  -- Drives the auto-archive sweep for communities that never got going.
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

-- Slugs are unique per region, so Houston and Austin can both have "climbers".
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_region_slug_unique
  ON communities (region_id, LOWER(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_communities_region_active
  ON communities (region_id, last_activity_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_communities_category
  ON communities (region_id, category) WHERE deleted_at IS NULL;
-- Backs the "max 2 active communities per creator" cap.
CREATE INDEX IF NOT EXISTS idx_communities_created_by
  ON communities (created_by) WHERE deleted_at IS NULL AND archived_at IS NULL;

DROP TRIGGER IF EXISTS trg_communities_updated_at ON communities;
CREATE TRIGGER trg_communities_updated_at BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- community_members ----------
-- This table IS the per-community half of RBAC.
--   'head'    — owns the community; exactly one, enforced by the partial unique
--               index below rather than in application code
--   'manager' — moderates and programmes events; cannot delete the community
--               or touch the head
--   'member'  — post, comment, react, RSVP
CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'manager' | 'head'
  status       TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'pending' | 'banned'
  -- Set by a manager to mute someone without banning them outright.
  muted_until  TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_user
  ON community_members (user_id, status);
CREATE INDEX IF NOT EXISTS idx_community_members_role
  ON community_members (community_id, role) WHERE status = 'active';
-- One head per community, at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_members_single_head
  ON community_members (community_id) WHERE role = 'head';
-- Pending join requests, for the manager approval queue.
CREATE INDEX IF NOT EXISTS idx_community_members_pending
  ON community_members (community_id, created_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_community_members_updated_at ON community_members;
CREATE TRIGGER trg_community_members_updated_at BEFORE UPDATE ON community_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- community_posts ----------
-- Deliberately NOT folded into `posts`. That table's creator_id is NOT NULL and
-- its indexes are tuned for the public discover feed; overloading it would mean
-- adding "WHERE community_id IS NULL" to every existing feed query, and a single
-- missed filter would leak private community content into the public feed.
-- Separate tables make that class of bug impossible rather than merely unlikely.
CREATE TABLE IF NOT EXISTS community_posts (
  community_post_id TEXT PRIMARY KEY,
  community_id      TEXT NOT NULL,
  author_user_id    TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  media             TEXT[] NOT NULL DEFAULT '{}',
  media_type        TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'image' | 'video'
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  reaction_count    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);

-- Pinned first, then newest — the community timeline in one index.
CREATE INDEX IF NOT EXISTS idx_community_posts_feed
  ON community_posts (community_id, is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_author
  ON community_posts (author_user_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_community_posts_updated_at ON community_posts;
CREATE TRIGGER trg_community_posts_updated_at BEFORE UPDATE ON community_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- comments ----------
-- Polymorphic via (target_type, target_id). Safe here because the project
-- already forbids foreign keys, so there is no constraint being given up.
-- target_type: 'community_post' | 'post' | 'event'
CREATE TABLE IF NOT EXISTS comments (
  comment_id        TEXT PRIMARY KEY,
  target_type       TEXT NOT NULL,
  target_id         TEXT NOT NULL,
  parent_comment_id TEXT,
  author_user_id    TEXT NOT NULL,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_target
  ON comments (target_type, target_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_author
  ON comments (author_user_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_comments_updated_at ON comments;
CREATE TRIGGER trg_comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- reactions ----------
-- Emoji reactions, replacing the decorative posts.likes counter (which has no
-- write endpoint at all today). Composite PK gives idempotent toggling and lets
-- one user apply several distinct emoji to the same target.
CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user   ON reactions (user_id, created_at DESC);


-- ---------- events ----------
-- Tables land now so the migration count stays low; the endpoints come in the
-- events milestone.
--   community_id IS NULL     -> a public regional event
--   kind = 'adhoc'           -> spontaneous, fuzzy location, auto-expiring
CREATE TABLE IF NOT EXISTS events (
  event_id           TEXT PRIMARY KEY,
  region_id          TEXT NOT NULL,
  community_id       TEXT,
  host_user_id       TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'planned',  -- 'planned' | 'adhoc'
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  cover              TEXT,
  category           TEXT,
  venue_name         TEXT,
  address            TEXT,
  -- Exact coordinates are always stored; whether they are *served* depends on
  -- location_precision and the viewer's RSVP state.
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  -- Deterministically jittered (~0.5mi) so the blob does not shimmer between
  -- refreshes. Computed once at write time, never re-rolled on read.
  approx_lat         DOUBLE PRECISION,
  approx_lng         DOUBLE PRECISION,
  location_precision TEXT NOT NULL DEFAULT 'exact',    -- 'exact' | 'approx'
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  capacity           INTEGER,
  rsvp_count         INTEGER NOT NULL DEFAULT 0,
  visibility         TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'community'
  status             TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'cancelled' | 'ended'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_events_region_upcoming
  ON events (region_id, starts_at) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_events_community
  ON events (community_id, starts_at)
  WHERE community_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_host
  ON events (host_user_id, created_at DESC) WHERE deleted_at IS NULL;
-- "Who's out right now" and the adhoc expiry sweep both read this.
CREATE INDEX IF NOT EXISTS idx_events_adhoc_live
  ON events (region_id, expires_at)
  WHERE kind = 'adhoc' AND status = 'active' AND deleted_at IS NULL;
-- No PostGIS: a bounding-box prefilter on this index plus haversine ordering in
-- SQL is enough at city scale.
CREATE INDEX IF NOT EXISTS idx_events_coords
  ON events (lat, lng) WHERE deleted_at IS NULL AND status = 'active';

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- event_rsvps ----------
-- 'requested' is the adhoc gate: the host approves before exact coordinates are
-- released to that viewer.
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'going',
  -- 'going' | 'interested' | 'requested' | 'declined' | 'checked_in'
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_user   ON event_rsvps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_status ON event_rsvps (event_id, status);

DROP TRIGGER IF EXISTS trg_event_rsvps_updated_at ON event_rsvps;
CREATE TRIGGER trg_event_rsvps_updated_at BEFORE UPDATE ON event_rsvps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- reports ----------
CREATE TABLE IF NOT EXISTS reports (
  report_id        TEXT PRIMARY KEY,
  target_type      TEXT NOT NULL,
  -- 'community_post' | 'comment' | 'event' | 'user' | 'community'
  target_id        TEXT NOT NULL,
  -- Denormalised so a community manager can see their own queue without
  -- resolving each target's parent first.
  community_id     TEXT,
  reporter_user_id TEXT NOT NULL,
  reason           TEXT NOT NULL,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'actioned' | 'dismissed'
  handled_by       TEXT,
  handled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_open
  ON reports (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reports_community
  ON reports (community_id, status) WHERE community_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);
-- One open report per person per target; re-reporting is a no-op rather than
-- a way to flood the queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_no_duplicates
  ON reports (target_type, target_id, reporter_user_id) WHERE status = 'open';


-- ---------- blocks ----------
CREATE TABLE IF NOT EXISTS blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_user_id);


-- ---------- maintenance ----------
-- Adhoc events are short-lived by design; nothing should surface one whose
-- window has passed.
CREATE OR REPLACE FUNCTION expire_stale_events()
RETURNS void AS $$
BEGIN
  UPDATE events
     SET status = 'ended'
   WHERE status = 'active'
     AND deleted_at IS NULL
     AND expires_at IS NOT NULL
     AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- A community with no posts and no events for 30 days is a ghost town; archiving
-- keeps it out of discovery without destroying it. Reversible by clearing
-- archived_at.
CREATE OR REPLACE FUNCTION archive_idle_communities(idle_days INTEGER DEFAULT 30)
RETURNS void AS $$
BEGIN
  UPDATE communities
     SET archived_at = NOW()
   WHERE archived_at IS NULL
     AND deleted_at IS NULL
     AND last_activity_at < NOW() - (idle_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;
