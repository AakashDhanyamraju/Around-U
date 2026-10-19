-- Around You — initial schema (migrated off MongoDB).
--
-- Conventions:
--   * TEXT everywhere, never VARCHAR.
--   * No FOREIGN KEY constraints; relationships are enforced in the application.
--   * Soft deletes via deleted_at; partial indexes cover the active-row queries.
--   * All timestamps are TIMESTAMPTZ (UTC).
--
-- Primary keys stay TEXT rather than UUID because the ids are semantic and are
-- already referenced by the frontend and the seed dataset (cr_morteza,
-- po_seed_007, user_a1b2c3...). Changing them would be a breaking API change.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shared trigger keeping updated_at honest on every UPDATE.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  picture        TEXT,
  -- NULL for accounts created by a future OAuth provider; email/password users
  -- always have a bcrypt hash here.
  password_hash  TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ
);

-- Case-insensitive uniqueness on live rows only, so a soft-deleted account does
-- not permanently burn its email address.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (LOWER(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted
  ON users (deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- user_sessions ----------
-- Opaque bearer tokens. Replaces the Mongo TTL index; expired rows are swept by
-- cleanup_expired_auth_rows() and rejected on read regardless.
CREATE TABLE IF NOT EXISTS user_sessions (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);


-- ---------- email_tokens ----------
-- Single-use tokens for email verification and password reset.
CREATE TABLE IF NOT EXISTS email_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  purpose    TEXT NOT NULL,          -- 'verify_email' | 'reset_password'
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose
  ON email_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_tokens_expires_at ON email_tokens (expires_at);


-- ---------- creators ----------
CREATE TABLE IF NOT EXISTS creators (
  creator_id TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  name       TEXT NOT NULL,
  bio        TEXT NOT NULL DEFAULT '',
  avatar     TEXT NOT NULL DEFAULT '',
  cover      TEXT,
  city       TEXT NOT NULL DEFAULT 'Houston',
  categories TEXT[] NOT NULL DEFAULT '{}',
  followers  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_handle_unique
  ON creators (LOWER(handle)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_creators_city_active
  ON creators (city) WHERE deleted_at IS NULL;


-- ---------- posts ----------
CREATE TABLE IF NOT EXISTS posts (
  post_id       TEXT PRIMARY KEY,
  creator_id    TEXT NOT NULL,
  image         TEXT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  neighborhood  TEXT NOT NULL,
  location_name TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  likes         INTEGER NOT NULL DEFAULT 0,
  media_type    TEXT NOT NULL DEFAULT 'image',   -- 'image' | 'video'
  video_url     TEXT,
  hashtags      TEXT[] NOT NULL DEFAULT '{}',
  source        TEXT,
  original_url  TEXT,
  is_sponsored  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);

-- Feed queries are "active posts, newest first, optionally by category".
CREATE INDEX IF NOT EXISTS idx_posts_feed
  ON posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_category_feed
  ON posts (category, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_creator_id
  ON posts (creator_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_deleted
  ON posts (deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_creators_updated_at ON creators;
CREATE TRIGGER trg_creators_updated_at BEFORE UPDATE ON creators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------- bookmarks ----------
-- Composite PK gives idempotent "save" without a separate uniqueness index.
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    TEXT NOT NULL,
  post_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
  ON bookmarks (user_id, created_at DESC);


-- ---------- follows ----------
CREATE TABLE IF NOT EXISTS follows (
  user_id    TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_creator_id ON follows (creator_id);


-- ---------- app_meta ----------
-- Small KV table; currently only tracks the seed version.
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------- maintenance ----------
CREATE OR REPLACE FUNCTION cleanup_expired_auth_rows()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW();
  DELETE FROM email_tokens
    WHERE expires_at < NOW() OR used_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
