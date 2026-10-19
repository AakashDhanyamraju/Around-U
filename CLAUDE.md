# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Around You** — a city-discovery app for Houston (food, events, hidden gems, real
estate, culture) curated from local creators, with region-scoped communities.
Expo (iOS / Android / web) frontend, FastAPI + Postgres backend. Originally
generated on Emergent, now self-hosted (see `docs/SELF_HOSTING.md`).

> **Stack note:** The user's global CLAUDE.md rules target a Kotlin/Micronaut backend
> and a Next.js frontend. This repo is **Python FastAPI + Expo/React Native** — those
> stack-specific rules (Exposed ORM, `@Controller`, Vitest, axios case interceptors,
> etc.) do **not** apply here. The general principles (UTC everywhere, soft deletes,
> no foreign keys, snake_case JSON) do, and this codebase already follows them.

## Commands

Backend (run from `backend/`, virtualenv in `.venv/`):

| Task | Command |
|---|---|
| Run API | `uvicorn app.main:app --reload --port 8000` |
| Run all tests | `pytest` |
| Run one test | `pytest tests/test_auth.py::test_name` |
| Seed demo content (empty DB only) | `python -m app.seed` |
| Wipe & reseed | `python -m app.seed --force` |
| Format / lint | `black app tests && isort app tests && flake8 app` |

Migrations apply automatically at startup, and also as a side effect of `python -m app.seed`.

Frontend (run from `frontend/`):

| Task | Command |
|---|---|
| Start dev server | `npx expo start` (`w` web, `i` iOS, `a` Android) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (`expo lint`) |
| Build web bundle | `npm run build:web` |

`packageManager` is `yarn`, and a `preinstall` hook (`scripts/check-pkg.js`) may enforce
it — install with the manager that script expects. Android emulators can't reach
`localhost`; use `http://10.0.2.2:8000`. `EXPO_PUBLIC_*` env vars are inlined at build
time, so restart the dev server after changing `.env`.

**`pytest` runs against whatever `DATABASE_URL` points at and writes to it — point it
at a scratch database, never production.**

## Backend architecture

Layered, and layers do not skip: **routers → repositories → `db.py`**. There is **no
ORM** — repositories write raw SQL through the asyncpg helpers.

- `app/main.py` — app wiring, lifespan (connect DB, run migrations, connect cache,
  configure media, optional seed), CORS, the `RequestValidationError` handler that
  flattens pydantic errors into one readable `detail`, and `/api/health`.
- `app/config.py` — single `pydantic-settings` object for every integration. `.env` is
  anchored to `backend/.env` by absolute path (a bare `.env` resolves against the CWD
  and silently loads nothing). Every integration **degrades gracefully**: Postgres is
  the only hard dependency; Redis / SES / Cloudinary are optional and their live status
  is reported at `/api/health`. Admin endpoints **fail closed** (503) when
  `admin_api_key` is unset.
- `app/db.py` — one asyncpg pool + a file-based migration runner. `statement_cache_size=0`
  is deliberate: Supabase's port-6543 pooler is PgBouncer in transaction mode and cannot
  carry server-side prepared statements across pooled connections.
- `app/repositories/` — Postgres data access, one module per aggregate (users, sessions,
  content, communities, community_posts, social, moderation, regions, auth_codes, identities).
- `app/routers/` — HTTP endpoints, all mounted under `/api`.
- `app/models.py` — all request/response pydantic schemas.

### Migrations

Numbered `.sql` files in `backend/migrations/` (e.g. `004_otp_auth.sql`), applied **once
each in filename order**, tracked in a `schema_migrations` table, each wrapped in its own
transaction. Write them idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) so re-running
by hand is safe. **To add a table: add the next numbered SQL file** and a matching
repository module — do not mutate the DB out of band.

### Transactions

The module-level `db.fetch/fetchrow/fetchval/execute` helpers each acquire **their own
connection**, so a sequence of them is not atomic. Any operation that pairs a row write
with a denormalized counter (e.g. `follows` insert + `creators.followers`, or a
`community_posts` insert + `communities.post_count`) **must** use `async with
db.transaction() as conn:` and run every statement on the yielded `conn`.

### Auth (README is stale here — trust the code)

Authentication is **passwordless**. Two sign-in paths, both proving email ownership as a
side effect: **Google OAuth via Supabase** (`supabase_auth.py`, token verified server-side
against `/auth/v1/user`) and **email OTP** (`auth_codes` repo + `emailer.py`). There is no
password path; `users.password_hash` still exists in the schema but nothing reads it.
Sessions remain **opaque server-side bearer tokens** (`sessions.user_for_token`), so the
token shape the frontend handles is unchanged. Anti-enumeration is a hard requirement:
requesting a code returns the same response whether or not the account exists, and every
verification failure returns one generic message.

### Authorization (`app/permissions.py`)

Two **orthogonal** RBAC layers — a flat enum cannot express a person who is a creator for
Houston, head of one community, and a plain member of three others:

- **Platform role** (`users.platform_role`): `user` / `creator` / `staff` / `superadmin`.
  `staff` and `superadmin` are a ranked hierarchy (superadmin is a strict superset of
  staff); `creator` is a capability that sits beside them. Superadmin is bootstrapped via
  the `super_admin_emails` config, matched on register **and on every login**.
- **Community role** (`community_members.role`): `member` / `manager` / `head`, one row
  per user per community, ranked so checks read as "at least manager". Staff act with
  head-level authority without being members.

Every check is **server-side and authoritative**; the client receives role data only to
hide UI it may not use. Private communities return **404, not 403** to non-members so
their existence is not disclosed. Use the dependency factories (`require_platform_role`,
`require_community_role`, `require_verified`, `require_region_grant`) rather than hand-
rolling checks in handlers.

## Frontend architecture

Expo Router (file-based routing under `frontend/app/`). Path alias `@/*` maps to the repo
root; `tsconfig` runs in `strict` mode.

- `src/api.ts` — the single typed fetch client. Prepends `/api`, attaches the bearer
  token, and throws `ApiError` carrying the backend's own `detail` string plus HTTP
  status (`isAuthError`, `isNetworkError` helpers). Always surface `ApiError.message` to
  the user, never a raw status string. All the shared TypeScript types (`Post`, `Creator`,
  `User`, `Community`, `CommunityPost`, roles) live here.
- `src/auth.tsx` — auth context. `admin.ts` / `superadmin.ts` / `social.tsx` /
  `communities.ts` are the feature API modules.
- `src/utils/storage/` and `src/utils/fonts/` use `.web.ts` variants for platform splits
  (Expo SecureStore on native vs web storage). Edit both when changing behavior.

### Design system — "Organic"

The UI implements the designer's Organic system (`docs/UX_BRIEF.md` is the product brief;
the source of truth for values is the design project's `organic.css`).

- `src/theme.ts` — the ported tokens: three 9-step ramps, the space scale, radii (cards
  `32.2`, every small control fully round), shadows, and the type scale taken from the
  phone mockups. Headings are **Caprasimo 400** — it ships one weight, so never ask for a
  bold face; body is **Figtree**. Handles, counts and timestamps are monospaced.
- `src/theme-context.tsx` — the palette is **per city** and follows `users.home_region_id`.
  Screens call `useTheme()` and build styles with `useMemo(() => makeStyles(t), [t])`.
  `t.ink(n)` stands in for the design's `color-mix(text n%, transparent)`.
- `src/components/organic/` — the primitives every screen is assembled from
  (`PillButton`, `Tag`, `Avatar`, `Card`, `ChipRow`, `SearchBar`, `Hatch`, `ReportSheet`…).
  Build screens from these rather than restyling from scratch.
- `theme.ts` also exports static `colors` / `spacing` / `shadow` aliases. Those exist **only**
  for the surfaces the redesign didn't restructure — the admin and superadmin consoles,
  community create/members. New screens must use `useTheme()`, or they won't re-theme.

Tabs are **Explore / Feed / Nearby / Communities / Saved**; Explore is the landing screen
signed in or out. Profile is not a tab — the account screen (`app/account.tsx`) hangs off
the avatar in the Explore header.

## Conventions (apply everywhere)

- **snake_case on the wire and in TS.** API JSON is snake_case, and the frontend types in
  `api.ts` use snake_case fields **directly** — there is no camelCase conversion layer.
  Do not add one; match the existing field names exactly.
- **Timestamps** are `TIMESTAMPTZ` / UTC in the DB and API; the client formats to local
  for display only.
- **No foreign keys.** Relationships are validated in application code (creating a post
  checks its `creator_id` explicitly).
- **Soft deletes.** Rows carry `deleted_at` and every read filters it out. The one hard-
  delete is `POST /admin/cleanup`, which resets to the seed baseline.
- **Errors** are `{"detail": "a readable sentence"}`; validation failures add an
  `errors: [{field, message}]` array.
- **Secrets** live only in gitignored `.env` files. Anything in `frontend/.env` ships
  inside the JS bundle, so it must never hold a secret — the admin key is typed in at
  runtime and sent as the `X-Admin-Secret` header.
