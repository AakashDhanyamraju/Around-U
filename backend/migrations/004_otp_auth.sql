-- Around You — passwordless authentication.
--
-- Passwords are removed as a sign-in method. The two remaining paths both prove
-- ownership of the address as a side effect, which is what makes
-- "every account has a verified email" true by construction rather than by
-- a follow-up email nobody clicks:
--
--   * Google via Supabase — the provider asserts email_verified
--   * Email OTP          — entering the code IS the proof of ownership
--
-- `users.password_hash` is intentionally left in place and populated. No code
-- path reads it any more, so it is inert, and keeping it means a temporary
-- re-enable is possible if an account ever locks itself out of both new paths.


-- ---------- auth_codes ----------
-- One-time login codes.
--
-- Keyed by email rather than user_id, because the same flow serves sign-up: at
-- request time the account may not exist yet.
--
-- The code is stored HASHED. A read of this table must not hand over working
-- login codes, and it is exactly the sort of table that ends up in a backup or
-- a support screenshot.
--
-- `attempts` lives on the row rather than in Redis on purpose: the Redis rate
-- limiter fails open, and a 6-digit code with unlimited guesses is ~10^6 tries.
-- Postgres is the only hard dependency, so the guess limit belongs here.
CREATE TABLE IF NOT EXISTS auth_codes (
  code_id      TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'login',   -- 'login' | 'signup'
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  -- Carried through sign-up so the display name survives the request→verify hop.
  name_hint    TEXT,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verification looks up the newest live code for an address.
CREATE INDEX IF NOT EXISTS idx_auth_codes_email_live
  ON auth_codes (LOWER(email), created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at
  ON auth_codes (expires_at);
-- Backs the per-address request throttle, which counts recent rows.
CREATE INDEX IF NOT EXISTS idx_auth_codes_email_created
  ON auth_codes (LOWER(email), created_at DESC);


-- ---------- auth_identities ----------
-- Links a local account to an external provider identity.
--
-- Matching on email alone would be fragile: a person who changes their Google
-- address would be orphaned from their account, and any future provider that
-- does not assert email_verified could be used to claim someone else's row.
-- The provider's stable subject id is the real key; email is kept only for
-- display and debugging.
CREATE TABLE IF NOT EXISTS auth_identities (
  provider     TEXT NOT NULL,            -- 'google'
  provider_uid TEXT NOT NULL,            -- provider's immutable subject id
  user_id      TEXT NOT NULL,
  email        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  PRIMARY KEY (provider, provider_uid)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities (user_id);


-- ---------- maintenance ----------
-- Expired and consumed codes have no purpose and are the most sensitive rows in
-- the schema; sweep them with the other auth cleanup on startup.
CREATE OR REPLACE FUNCTION cleanup_expired_auth_rows()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW();
  DELETE FROM email_tokens
    WHERE expires_at < NOW() OR used_at IS NOT NULL;
  DELETE FROM auth_codes
    WHERE expires_at < NOW() OR consumed_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
