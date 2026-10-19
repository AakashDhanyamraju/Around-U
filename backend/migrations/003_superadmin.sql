-- Around You — the superadmin platform role.
--
-- `staff` already short-circuits every community permission check, so "universal
-- access" was not the gap. The gap was **privilege escalation**: nothing stopped
-- one staff member appointing another. Role assignment and user administration
-- now sit one tier higher.
--
--   user < creator < staff < superadmin
--
--   staff      — platform moderation, content, reports
--   superadmin — the above, plus assigning roles and managing user accounts
--
-- Bootstrapping is config-driven (`SUPER_ADMIN_EMAILS`) rather than hardcoded
-- here, because only a superadmin can grant the role and somebody has to be
-- first. The application promotes matching accounts on register and on login, so
-- the account does not need to exist when this migration runs. The statement
-- below only covers the case where it already does.

UPDATE users
   SET platform_role = 'superadmin'
 WHERE LOWER(email) = 'aakashdhanyamraju425@gmail.com'
   AND deleted_at IS NULL
   AND platform_role <> 'superadmin';


-- Audit trail for role changes. Privilege escalation is exactly the kind of
-- action that needs to be answerable after the fact, and no existing table
-- records who changed what — the admin secret is not tied to an identity at all.
CREATE TABLE IF NOT EXISTS role_audit (
  audit_id     TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,          -- 'platform' | 'community'
  target_id    TEXT NOT NULL,          -- user_id, or community_id for community roles
  subject_id   TEXT NOT NULL,          -- the user whose role changed
  from_role    TEXT,
  to_role      TEXT NOT NULL,
  actor_id     TEXT NOT NULL,          -- who made the change
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_audit_subject
  ON role_audit (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_actor
  ON role_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_recent
  ON role_audit (created_at DESC);
