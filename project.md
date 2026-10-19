# Around You

## What this is

A city-scale community app, Houston-first, aimed at Gen Z. It started as a
**read-only discovery feed** — curated local creators publish editorial posts
("5 things to do in Houston this weekend"), users browse a Pinterest-style
masonry grid, bookmark and follow.

It is now becoming a **participation** app. The thesis: the app should be the
medium through which people actually meet up, not just another feed to scroll.
Three pillars:

1. **Regional creator content** — the editorial spine. Creators publish for a
   region they're authorised to cover.
2. **Communities** — interest groups inside a region ("Houston Climbers"), with
   their own posts, comments and reactions. This is where belonging happens.
3. **Events** — both pre-planned and *adhoc* ("I'm at Memorial Park, come hang").
   This converts the first two into real-world hangouts and is the differentiator.

The problem it solves: local discovery apps tell you what exists but not who to
go with, and social apps connect you to people you already know. Around You is
aimed at the gap — ground-level, in-your-city, with strangers who share an
interest.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Expo SDK 54, expo-router (`typedRoutes: true`), React Native 0.81, TypeScript strict |
| Backend | FastAPI, Python 3.12, asyncpg (raw SQL, **no ORM**) |
| Database | Postgres on Supabase |
| Cache / rate limiting | Redis Cloud (optional — degrades gracefully) |
| Email | AWS SES |
| Media | Cloudinary signed direct uploads |
| Auth | **Passwordless**: email OTP or Google via Supabase. Opaque server-side session tokens (30 day) |

## Auth — passwordless, and why

There is **no password path**. Two ways in, and both prove ownership of the
address as a side effect of signing in:

| Path | Endpoints | How the email gets verified |
|---|---|---|
| Email OTP | `POST /api/auth/otp/request` → `/api/auth/otp/verify` | Entering the code *is* the proof |
| Google | `POST /api/auth/google` | Supabase asserts `email_verified` |

That is what makes **"every account has a verified email" an invariant** rather
than a follow-up step nobody completes. A consequence worth knowing: no real
sign-in path can now produce an unverified session, so `require_verified` can only
be exercised in tests by forcing the flag off — `make_user(verified=False)`.

There is also **no separate sign-up**. Verifying a code creates the account if it
doesn't exist, so the app has one auth screen, and `AuthResponse.created` tells
the client whether to show onboarding.

`users.password_hash` still exists and still holds old values. Nothing reads it —
kept deliberately so a temporary re-enable is possible if an account ever locks
itself out of both paths.

### Rules that are load-bearing

- **The OTP is stored hashed** (`auth_codes.code_hash`, bcrypt). That table is the
  likeliest to end up in a backup or a screenshot, and a plaintext row there is a
  working credential.
- **The guess counter lives on the row**, not in Redis (`auth_codes.attempts`).
  The Redis limiter *fails open*, and a 6-digit code with unlimited guesses is only
  ~10⁶ attempts. Same reason the per-address request throttle counts rows in
  Postgres rather than trusting the cache.
- **Requesting a new code burns the old one.** Several live codes at once would
  multiply an attacker's chances.
- **One message for every verification failure** (`GENERIC_CODE_ERROR`) — wrong,
  expired, never-issued and out-of-attempts are indistinguishable, or the endpoint
  becomes an account-existence oracle. `/otp/request` likewise responds identically
  whether or not the account exists.
- **Outside production, `/otp/request` returns the code as `dev_code`.** That is
  how the flow stays testable without a mailbox while SES is sandboxed. Always
  `None` when `is_production`.
- **Google identity resolution is by provider subject id, not email** — see
  `app/identity_link.py`. Order: known identity → matching verified email →
  create. Email-first would let a provider that doesn't verify claim someone
  else's account, and would fork anyone who changes their Google address.
- **Supabase tokens are verified by calling `/auth/v1/user`**, not by checking the
  JWT locally. One HTTPS round trip at sign-in, in exchange for no JWT library, no
  signing keys in config, and no chance of botching algorithm or key-rotation
  handling. Supabase is already a hard dependency.
- Only the **OAuth handshake** runs through Supabase; everything downstream keeps
  our own session model. That is why adding Google touched one endpoint instead of
  all 54.

`email_tokens` and the `sessions.create_email_token` / `consume_email_token`
helpers are now **unused** — they served the old verify-email and password-reset
flows. Left in place, harmless.

## Layout

```
backend/
  app/
    main.py            FastAPI wiring, lifespan, /api/health
    config.py          pydantic-settings; every integration is optional
    db.py              asyncpg pool, transaction(), migration runner
    permissions.py     RBAC — the capability matrix and role dependencies
    models.py          ALL Pydantic request/response schemas
    routers/           thin: parse input, delegate, shape response
    repositories/      all SQL lives here
  migrations/*.sql     applied in filename order, once, tracked in schema_migrations
  tests/               integration tests against a REAL database
frontend/
  app/                 expo-router file-based routes
  src/
    api.ts             fetch wrapper, ApiError, ALL TypeScript types
    auth.tsx           AuthProvider
    social.tsx         SocialProvider (bookmarks, follows)
    community-context.tsx  CommunityProvider (membership state)
    communities.ts     communities API client
    theme.ts           design tokens — the real source of truth
```

## Hard conventions — do not break these

These are settled, deliberate decisions documented in `docs/SELF_HOSTING.md`.

- **Semantic `TEXT` primary keys**, not UUIDs: `cr_morteza`, `po_seed_007`,
  `user_a1b2c3`, `com_`, `cp_`, `cm_`, `ev_`, `reg_`, `rep_`. `TEXT` never `VARCHAR`.
- **No foreign key constraints.** Relationships are validated in application code.
- **Soft deletes** via `deleted_at`; every read filters it; partial indexes cover
  the active-row queries.
- **All timestamps `TIMESTAMPTZ`**, UTC everywhere in the API, formatted only on
  the client.
- **Errors are `{"detail": "a readable sentence"}`** — the client renders that
  string directly, so it must be something a person can act on.
- **Supabase runs through the 6543 transaction pooler**, so asyncpg uses
  `statement_cache_size=0`. Don't remove it — you get intermittent
  `prepared statement _pg_N already exists` under concurrency.
- **The frontend client does NO case conversion.** All TS types are declared in
  backend `snake_case`; screens map to camelCase at the call site.
- **Seeding never destroys data on boot.** Destructive reseed is CLI-only:
  `python -m app.seed --force`.
- **Reuse the `update_updated_at()` trigger function** from `001_init.sql:16` —
  never redefine it in a new migration.
- **Multi-word `@QueryValue`-style query params** must match what the client
  sends exactly; there is no auto snake_case conversion for query params.

## RBAC — two orthogonal layers

This is the most subtle part of the codebase. **Read `app/permissions.py` before
touching anything authorisation-related.**

The two layers are separate because one person can be a creator for Houston, the
head of one community, and a plain member of three others *simultaneously*. A
flat role enum cannot express that.

**Layer 1 — platform role** (`users.platform_role`, one per account):

| Role | Can do |
|---|---|
| `user` | Browse, follow, join communities, RSVP |
| `creator` | Publish regional editorial posts — only into regions granted in `creator_regions` |
| `staff` | Platform moderation across all communities. Supersedes the legacy `is_admin` boolean |
| `superadmin` | The above, **plus** assigning roles and managing user accounts |

`staff` and `superadmin` are a **hierarchy** (`_ELEVATED_RANK` in `permissions.py`);
`creator` is a capability that sits beside them, not below — a staff account still
needs a linked `creator_id` to publish.

**Why superadmin exists as a separate tier:** `staff` already short-circuits every
community check, so "universal access" was never the gap. The gap was
**privilege escalation** — nothing stopped one staff member appointing another.
Role assignment and account administration therefore live one tier up.

`is_staff()` is **rank-based, not an equality check**. Every community permission
path calls it, so comparing `== ROLE_STAFF` would silently strip superadmin of
those powers.

### Superadmin bootstrap

Only a superadmin can grant that role, so somebody has to be first.
`SUPER_ADMIN_EMAILS` (config, comma-separated, defaults to
`aakashdhanyamraju425@gmail.com`) is promoted automatically by
`users.promote_if_configured()`, called on **both register and login** — so the
account need not exist when the migration runs, and editing the row by hand is
undone on next sign-in. Config is the source of truth.

Guards in `routers/superadmin.py`, all tested:

- Cannot change **your own** role — instant irreversible lockout.
- Cannot demote or delete the **last** superadmin — nobody would be left to
  appoint one.
- Cannot demote a **configured bootstrap address** — it would be restored at next
  login anyway, so it refuses rather than pretending the change stuck.
- Every role change is written to **`role_audit`** with actor, subject, from/to and
  an optional note. The old admin surface was a shared secret with no identity
  attached, so "who did that" was previously unanswerable.

**Layer 2 — community role** (`community_members.role`, one row per user per community):

| Role | Can do | Count |
|---|---|---|
| `head` | Owns it: identity, appoint/remove managers, transfer ownership, delete | Exactly 1, enforced by a partial unique index |
| `manager` | Moderate posts and comments, approve join requests, create community events, pin, mute, ban members. **Cannot** touch the head or delete the community | Many |
| `member` | Post, comment, react, RSVP | Many |

A user with no `community_members` row anywhere is "just in the app" — that's the
*absence* of a community role, not a role of its own.

Key rules encoded in `permissions.py`:

- `staff` short-circuits community checks and acts with head-level authority.
- **Private communities 404, never 403** — a 403 would confirm they exist.
- A manager may only act on someone strictly below them (`outranks()`).
- **Write endpoints must resolve auth first.** Use `authed_community_context` /
  `_authed_post_context`, not the `optional_user` variants — otherwise anonymous
  callers get 404 instead of 401.
- The client receives role data *only* to hide UI. Never a security boundary.

## Why `community_posts` is separate from `posts`

Deliberate, and load-bearing. `posts.creator_id` is `NOT NULL` and its indexes
are tuned for the public discover feed. Folding community content in would mean
adding `WHERE community_id IS NULL` to every existing feed query — and one missed
filter leaks **private** community content into the public feed. Separate tables
make that class of bug structurally impossible. There is a test asserting it
(`test_private_posts_never_reach_the_public_feed`).

## Counter discipline

`communities.member_count`, `post_count`, `community_posts.comment_count` and
`reaction_count` are denormalised. **Every write that changes one happens in the
same `db.transaction()` as the row it counts.**

This exists because `creators.followers` already drifted — `follows` inserts were
never paired with an increment, so that number is currently wrong. Don't repeat
it. `test_member_count_matches_reality_through_churn` is the guard.

Note the module-level `db.fetch`/`db.execute` helpers each acquire their own
connection and are **not** covered by a `transaction()` block — use the yielded
connection inside it.

## What's built

**M1 complete and verified** — communities, RBAC, creator self-publishing, and the
superadmin portal.

Migrations `002_communities_events.sql`, `003_superadmin.sql` and
`004_otp_auth.sql` are applied. 14 new tables: `regions`, `creator_regions`,
`communities`, `community_members`, `community_posts`, `comments`, `reactions`,
`events`, `event_rsvps`, `reports`, `blocks`, `role_audit`, `auth_codes`,
`auth_identities`.

**Auth is rebuilt passwordless** — see the Auth section above. All password
endpoints are removed (there are tests asserting they 404), and the app has a
single two-stage login screen plus a Google button that only appears when
Supabase is configured.

Backend: `permissions.py`, repositories and routers for regions, communities,
community posts/comments/reactions, creator publishing, moderation
(reports + blocks), and the superadmin portal. ~54 new endpoints.

Frontend: Groups tab, community detail (composer, emoji reactions, moderation
actions), member management, create-community flow, creator publish screen,
super admin portal (`app/superadmin/index.tsx` — user directory, role assignment,
creator linking, region grants, audit log), `CommunityProvider`, and a
`SignInPrompt` sheet for guest actions.

**Test status: ~202 passing, 2 skipped** (Cloudinary unconfigured, and the
bootstrap-on-register test which skips when that account already exists).

`events` and `event_rsvps` tables exist but have **no endpoints yet** — that's M2.

## Current plan

| Milestone | Scope | Status |
|---|---|---|
| M1 | Communities, RBAC, creator logins | **Done** |
| M2 | Planned events + RSVP, event discovery, first real geo queries | Next |
| M3 | Adhoc meetups — gated creation, fuzzy location, expiry sweep, "who's out right now" | Unblocked (Redis fixed) |
| M4 | Creator feed alongside the masonry grid; comments/reactions on regional posts | |
| M5 | Event recaps, show-up badges. **Live community chat** belongs here as its own body of work | |

Design decisions already taken:

- Communities are **region-scoped interest groups**, not the region itself.
- Group "talk" is **threaded posts + comments + reactions**. Live chat is deferred
  — it needs WebSockets, presence, push and read state, none of which exist.
- Community creation: **any verified user, capped at 2 active**, with a 30-day
  idle auto-archive (`archive_idle_communities()`).
- Adhoc safety: **verified hosts only, fuzzy location until the host accepts an
  RSVP, auto-expiry**. Exact `lat`/`lng` are stored but only *served* to an
  approved viewer.
- Staying on **Python/FastAPI**. A Node/Fastify port was considered and shelved;
  revisit post-MVP. The raw-SQL design keeps that cheap.

## Commands

```bash
# Backend (from backend/)
.venv/Scripts/python.exe -m uvicorn app.main:app --reload   # dev server
.venv/Scripts/python.exe -m pytest -q                       # tests
.venv/Scripts/python.exe -m app.seed --force                # destructive reseed
docker compose up -d                                        # API only

# Frontend (from frontend/)
npm run start          # expo dev server (also regenerates .expo/types/router.d.ts)
npm run typecheck      # tsc --noEmit — RUN THIS before committing any .ts/.tsx
```

**`pytest` runs against whatever `DATABASE_URL` points at and WRITES TO IT.** It
is currently pointed at the live Supabase project by explicit choice. Fixtures
clean up after themselves, but an interrupted run can leave rows behind.

**expo-router typed routes**: adding a screen makes `tsc` fail until
`.expo/types/router.d.ts` regenerates, which happens when the dev server starts.
Start Expo once after adding routes, then typecheck.

## Gotchas and known-broken things

- **The rate limiter fails open.** Redis is working now, but if the credentials
  ever break again, throttling silently stops instead of erroring — the symptom is
  *no symptom*. Check `GET /api/health` → `cache: "ok"` before trusting any limit.

  The failure mode is why the two limits that actually matter for auth live in
  Postgres rather than Redis: the OTP guess cap (`auth_codes.attempts`) and the
  per-address code-request throttle. Only the per-network OTP cap depends on Redis.

  If it does break: the value must be the Redis Cloud **database password**, not
  the account API key — that mistake is what broke it the first time. Plaintext
  `redis://` is correct for this endpoint; `rediss://` is not offered and will fail
  to connect.
- **Two conflicting design systems.** `design_guidelines.json` (cream `#FDFCF8`
  / rust `#B25E46`, Playfair + Manrope, written for a Tailwind/Shadcn *web*
  build) is a **historical artifact**. `frontend/src/theme.ts` (peach `#FFF4EB`
  / coral `#F26B3A`, Bricolage Grotesque + Inter) is what actually ships and what
  `app.json` uses for the splash. **Use `theme.ts`.**
- `theme.ts` exports `spacing`, and older screens ignore it in favour of
  hardcoded numbers. New screens should use the tokens.
- **The map tab is not a map.** `app/(tabs)/map.tsx` is a hardcoded Unsplash photo
  with seven decorative pins at fixed percentage positions. A real map needs
  `react-native-maps` + a dev build (you leave Expo Go behind). `expo-location`
  alone works in Expo Go and is enough for distance-sorted lists.
- **`posts.likes` is decorative** — displayed but there is no like endpoint at
  all. `reactions` supersedes it. `MasonryCard.tsx:71-75` and `post/[id].tsx`
  render **fake social proof** (pravatar avatars, `+{80 + likes % 320} interested`).
  Replace these with real reaction/RSVP counts, don't sit them side by side.
- **The admin secret is burned** — it's in git history and in plaintext in
  `test_result.md`. It needs rotating, and creator publishing now makes it
  unnecessary for content entry.
- **Test accounts must never accumulate.** Two layers in `tests/conftest.py`:
  `registered_user` / `make_user` purge their own accounts via `purge_users()`,
  and a session-scoped autouse `sweep_test_accounts` fixture removes anything
  matching `test-%@example.com` at the end of the run — several tests call
  `/api/auth/register` directly and would otherwise leak.

  This is not tidiness. ~479 such accounts had accumulated in the live database,
  and once role-assignment tests began promoting them, **68 were `superadmin`
  sharing the single hardcoded password `test-password-123`**. Purged; the live
  database now holds exactly one account. If you add a fixture that creates
  users, give it a teardown.
- `test_result.md` is stale — it references `backend/server.py`, now a 19-line
  shim around `app.main:app`.
- **SES is still sandboxed** (200 sends/day, verified recipients only) and this now
  sits on the critical path: with OTP as a primary sign-in method, an address that
  is not a verified SES recipient **cannot receive its code in production**.
  Outside production the code comes back as `dev_code`, so development is fine.
  Requesting production access is the blocker for real users signing in by email.
- **Google sign-in is configured and live.** `SUPABASE_URL` + `SUPABASE_ANON_KEY`
  are set and Google is enabled under Authentication → Providers, so
  `/api/auth/providers` reports `google: true` and the app shows the button. If it
  ever reports `false`, one of those two env vars is missing — the app hides the
  button rather than offering a 503, so the symptom is a *missing* button.

  Two settings live only in dashboards and are easy to forget when things break:
  the Google Cloud OAuth client must list
  `https://<project>.supabase.co/auth/v1/callback` as an authorised redirect URI,
  and Supabase → Authentication → URL Configuration must allow the app's own
  redirect (`around-you://auth-callback` for builds, an `exp://…/--/auth-callback`
  for Expo Go, `http://localhost:8081/auth-callback` on web). A
  `redirect_uri_mismatch` from Google means the first; a redirect that lands
  nowhere means the second.

  The **Google client secret belongs only in the Supabase dashboard** — nothing in
  this repo should ever hold it.
- **No frontend test runner** — no Jest, no Playwright. Only the testID registry
  in `frontend/constants/testIds/`. Frontend verification is manual.
- **No data-fetching library** (no React Query/SWR/Zustand). Server state is
  `useState` + `useEffect` + `useFocusEffect` per screen. Cross-screen shared
  state uses context providers (`SocialProvider`, `CommunityProvider`) — follow
  that pattern rather than introducing a library for one feature.
- `PrimaryButton` exists **twice** with different props: `busy` in
  `src/components/AuthKit.tsx`, `loading` in `src/components/admin/Fields.tsx`.
  Pick one rather than adding a third.
- `app.json` splash points at `./assets/images/splash-icon.png`; the file on disk
  is `splash-image.png`.

## Architectural rules

- **Routers stay thin**: parse HTTP input, delegate, shape the response. No SQL.
- **All SQL lives in `repositories/`**, with a column constant and an update
  allowlist guarding any dynamically-built `UPDATE` (see
  `content.py` `_POST_UPDATABLE`).
- **All Pydantic schemas live in `app/models.py`**; all TypeScript types live in
  `frontend/src/api.ts`. One place each.
- **The eight categories** (`All, Food, Events, Real Estate, Hidden Gems,
  Nightlife, Outdoor, Culture`) exist in two places already —
  `frontend/src/theme.ts` and hardcoded in `app/routers/content.py:14-23`. Do
  not add a third taxonomy.
- Every community/content mutation calls `cache.invalidate_content()`.
- `tests/test_admin.py` `ADMIN_ROUTES` is the canonical list of paths requiring
  `X-Admin-Secret`. New *bearer-auth* endpoints do not belong there.
- Comments explain **why**, not what. No docstrings restating a function name.
