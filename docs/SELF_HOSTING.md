# Self-hosting: migration notes

What changed when this project moved off the Emergent platform, and what you
still need to do before real users arrive.

---

## What was removed

| Emergent dependency | Replacement |
|---|---|
| `auth.emergentagent.com` hosted OAuth page | Own email + password screens |
| `demobackend.emergentagent.com/auth/v1/env/oauth/session-data` (called from **both** the app and the API) | `POST /api/auth/login` issuing our own session token |
| `emergentintegrations==0.2.0` (private package index, never imported) | deleted — it made `pip install` fail on any machine outside Emergent |
| MongoDB (Motor) inside Emergent's container image | Postgres on Supabase |
| `.emergent/` markers, `emergent.yml` | deleted |
| `.gitconfig` committed with `github@emergent.sh` | deleted |
| `frontend/scripts/install-guard.sh` referencing `/app/...` and `/opt/install-guard/bin` | deleted |
| Emergent preview URL + admin key hardcoded in tests | in-process pytest suite reading config from `.env` |

Also dropped from `requirements.txt` as unused template weight: `pandas`,
`numpy`, `jq`, `typer`, `python-jose`, `requests-oauthlib`, `requests`, plus
`passlib` (its bcrypt version detection breaks on bcrypt ≥ 4.1 — the app calls
`bcrypt` directly).

---

## Auth model

Google OAuth is deliberately **not** wired up yet; the app uses email +
password. The schema already accommodates adding a provider later:
`users.password_hash` is nullable, so an OAuth-created account simply has none.

- Passwords: bcrypt, 72-byte input cap enforced (bcrypt silently truncates
  beyond that, which would let two different passwords match one hash).
- Sessions: opaque 64-char random tokens in `user_sessions`, 30-day expiry,
  validated on every request. Same shape the app already stored, so
  `expo-secure-store` handling did not change.
- Email verification and password reset use single-use tokens in `email_tokens`.
  Consuming one is a single atomic `UPDATE ... WHERE used_at IS NULL RETURNING`,
  so a double-clicked link cannot be replayed.
- A password reset or change revokes **every** session for that user.
- Login, registration, forgot-password and resend-verification are all written
  to avoid revealing whether an address has an account. Login runs a bcrypt
  comparison even for unknown emails so response timing does not leak either.

---

## Data model

The MongoDB collections became tables in `backend/migrations/001_init.sql`:

| Collection | Table | Notes |
|---|---|---|
| `users` | `users` | gained `password_hash`, `email_verified`, `is_admin`, `last_login_at` |
| `user_sessions` | `user_sessions` | Mongo TTL index → expiry checked in-query + `cleanup_expired_auth_rows()` |
| — | `email_tokens` | new: verification and reset tokens |
| `creators` | `creators` | `categories` is `TEXT[]` |
| `posts` | `posts` | `hashtags` is `TEXT[]` |
| `bookmarks` | `bookmarks` | composite PK makes saving idempotent |
| `follows` | `follows` | composite PK |
| `app_meta` | `app_meta` | JSONB value |
| — | `schema_migrations` | tracks applied migration files |

Conventions: `TEXT` not `VARCHAR`, no foreign-key constraints, soft deletes via
`deleted_at` with partial indexes covering the active-row queries, all timestamps
`TIMESTAMPTZ`.

**IDs stayed `TEXT`** (`cr_morteza`, `po_seed_007`, `user_a1b2c3…`) rather than
becoming `UUID`. They are semantic, and the frontend and seed dataset reference
them directly — switching would have been a breaking API change for no gain.

### Supabase pooler caveat

`DATABASE_URL` points at port **6543**, the transaction-mode PgBouncer pooler, so
the asyncpg pool runs with `statement_cache_size=0`. Without that you get
intermittent `prepared statement "_pg_N" already exists` errors under
concurrency. Port 5432 (direct) needs Supabase's IPv4 add-on.

---

## Two bugs fixed along the way

**Startup seeding destroyed data.** The old `run_migrations_and_seed()` ran
`delete_many({})` on creators *and* posts whenever `SEED_VERSION` was bumped —
on every boot, on every replica. On Emergent's single ephemeral instance that
was invisible; self-hosted with real content it is data loss. Now startup
seeding only fills a genuinely empty database, and a destructive reseed requires
`python -m app.seed --force`.

**CORS was invalid.** `allow_origins=["*"]` together with
`allow_credentials=True` is rejected by browsers per the CORS spec. Origins now
come from the `CORS_ORIGINS` env var.

---

## Before you launch

### 1. Rotate every credential
The values currently in `backend/.env` were shared over chat, and the previous
admin key (`2CqEcj2Jl…`) is still in git history. Rotate:

- Supabase database password
- AWS SES access key
- Cloudinary API secret
- Redis password
- `ADMIN_API_KEY` (already regenerated once; rotate again for production)

### 2. Get SES out of the sandbox
The account is sandboxed: 200 sends/day, and it can **only send to verified
addresses**. Verification and reset emails to real users will be rejected until
you request production access in the SES console. Confirmed working:
`aakash@pick-a-pad.com`. Note `pick-a-pad.com` domain verification is currently
in **Failed** state — fix the DKIM/TXT records or keep using the single verified
address as the sender.

While SES is unconfigured or rejecting, the API logs the verification/reset link
at WARNING/ERROR level instead of failing the request, so signup still works.

### 3. Fix the Redis password
`REDIS_URL` currently fails with `invalid username-password pair`. The host and
port are correct; the password looks like a Redis Cloud *account API key* rather
than the database password. Get it from Databases → `au-cache` → Configuration →
Security → Default user password.

Nothing breaks without it — the cache and login rate limiting degrade to no-ops
and `/api/health` reports `"cache": "disabled"`. But **login rate limiting is
part of that degradation**, so fix it before opening signup to the public.

### 4. Production settings
```bash
ENVIRONMENT=production          # hides /docs and /openapi.json
CORS_ORIGINS=https://your-real-domain.com
PUBLIC_API_URL=https://api.your-domain.com
PUBLIC_APP_URL=https://your-real-domain.com
SEED_ON_STARTUP=false
```
`PUBLIC_API_URL` and `PUBLIC_APP_URL` are baked into email links — wrong values
mean dead buttons in real inboxes.

### 5. Run behind TLS
Session tokens are bearer credentials. The Dockerfile starts uvicorn with
`--proxy-headers`, so terminate TLS at your load balancer or reverse proxy.

---

## Deploying

**API** — `backend/Dockerfile` builds a non-root image with a `/api/health`
healthcheck. Runs anywhere that takes a container: Fly, Railway, Render, ECS,
Cloud Run.

**Frontend** — `npm run build:web` emits a static SPA to `frontend/dist`, which
any static host will serve. `EXPO_PUBLIC_BACKEND_URL` is inlined at build time,
so it must be set in the build environment, not at runtime.

**Native** — needs an EAS project (`eas build:configure`). `app.json` now
declares `com.aroundyou.app` for both platforms and the `around-you` scheme.

---

## Still open

- **No image upload UI.** `POST /uploads/signature` is ready and tested, but the
  admin screen still takes an image *URL*. Wiring a picker to the signature
  endpoint is the remaining piece.
- **Seed media is hotlinked** to Unsplash, Pexels and `media.w3.org`. Fine for a
  demo, not something to build a product on — migrate to Cloudinary.
- **The map is not a map.** `app/(tabs)/map.tsx` shows a static cityscape image
  and a neighborhood list. A real map needs `react-native-maps` plus a Google
  Maps or Mapbox key, and a dev build (it does not work in Expo Go).
- **Google OAuth**, when you want it: add `GET /api/auth/google/start` and
  `/callback`, verify the `id_token` server-side, then reuse the existing
  `users.insert` + session issuance. Register the redirect URIs against the
  `around-you` scheme and your API domain.
