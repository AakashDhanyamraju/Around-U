# Around You

A city discovery app for Houston — food, events, hidden gems, real estate and
culture, curated from local creators. Expo (iOS / Android / web) on the front,
FastAPI + Postgres on the back.

This repo was originally generated on the Emergent platform and has since been
migrated to run entirely on self-hosted infrastructure. See
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for what changed and the deployment
checklist.

---

## Stack

| Layer | Technology |
|---|---|
| Mobile / web app | Expo SDK 54, Expo Router, React Native 0.81 |
| API | FastAPI, Python 3.12, asyncpg |
| Database | Postgres (Supabase) |
| Cache & rate limiting | Redis (Redis Cloud) — optional |
| Transactional email | AWS SES |
| Image / video hosting | Cloudinary (signed direct uploads) |
| Auth | Email + password, bcrypt, server-side session tokens |

---

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt

cp .env.example .env          # then fill in the values
```

At minimum `.env` needs `DATABASE_URL` and `ADMIN_API_KEY`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # ADMIN_API_KEY
```

Create the schema and load the demo content:

```bash
python -m app.seed            # runs migrations, then seeds if the DB is empty
uvicorn app.main:app --reload --port 8000
```

Check it: <http://localhost:8000/api/health> — every integration reports its own
status there. Interactive API docs are at `/docs` outside production.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env          # EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
npx expo start
```

Press `w` for web, `i` for iOS, `a` for Android. Android emulators cannot reach
`localhost` — use `http://10.0.2.2:8000`; physical devices need your LAN IP.

### 3. Docker (alternative)

```bash
docker compose up api                     # API only
docker compose --profile local-cache up   # API + a local Redis
```

---

## Commands

| Task | Command |
|---|---|
| Run API | `cd backend && uvicorn app.main:app --reload --port 8000` |
| Run tests | `cd backend && pytest` |
| Apply migrations | automatic on boot, or `python -m app.seed` |
| Seed demo content | `cd backend && python -m app.seed` |
| Wipe & reseed content | `cd backend && python -m app.seed --force` |
| Format / lint Python | `black app tests && isort app tests && flake8 app` |
| Typecheck frontend | `cd frontend && npm run typecheck` |
| Build web bundle | `cd frontend && npm run build:web` |

`pytest` runs against whatever `DATABASE_URL` points at **and writes to it** —
point it at a scratch database, not production.

---

## Project layout

```
backend/
  app/
    config.py          environment + credentials for every integration
    db.py              asyncpg pool, migration runner
    security.py        bcrypt hashing, token generation
    cache.py           Redis cache + login rate limiting
    emailer.py         AWS SES transactional email
    media.py           Cloudinary signed uploads
    models.py          request/response schemas
    dependencies.py    bearer-session and admin-secret guards
    repositories/      Postgres data access
    routers/           auth, content, social, admin, uploads
    seed.py            demo dataset
    main.py            app wiring, CORS, health
  migrations/          numbered .sql files, applied once each
  tests/               pytest integration suite
frontend/
  app/                 Expo Router screens
  src/
    api.ts             typed fetch client + ApiError
    auth.tsx           auth context
    components/        shared UI including AuthKit
  constants/testIds/   testIDs for E2E tooling
docs/
  SELF_HOSTING.md      migration notes + deployment checklist
```

---

## API

All routes are under `/api`.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | Creates an account, returns a session, emails a verification link |
| POST | `/auth/login` | Returns a session token |
| POST | `/auth/logout` | Revokes the current token |
| GET | `/auth/me` | Current user |
| GET | `/auth/verify-email?token=` | Link target; redirects into the app |
| POST | `/auth/verify-email` | Same, for clients posting the token |
| POST | `/auth/resend-verification` | Always 200 |
| POST | `/auth/forgot-password` | Always 200 (no account enumeration) |
| POST | `/auth/reset-password` | Consumes token, revokes all sessions |
| POST | `/auth/change-password` | Requires auth, rotates all sessions |

### Content (public)
`GET /creators` · `GET /creators/{id}` · `GET /posts` · `GET /posts/{id}` ·
`GET /categories` · `GET /health`

### Social (requires auth)
`GET|POST|DELETE /bookmarks[/{post_id}]` · `GET|POST|DELETE /follows[/{creator_id}]`

### Uploads (requires auth)
`POST /uploads/signature` — returns a short-lived Cloudinary signature so the
client uploads directly; the API secret never leaves the server.

### Admin (requires `X-Admin-Secret`)
`POST|PATCH|DELETE /admin/creators[/{id}]` ·
`POST|PATCH|DELETE /admin/posts[/{id}]` ·
`GET /admin/stats` · `POST /admin/cleanup`

---

## Conventions

- **Timestamps** are `TIMESTAMPTZ` in Postgres, UTC everywhere in the API, and
  formatted for display only on the client.
- **No foreign keys.** Relationships are validated in the application, so
  creating a post checks its `creator_id` explicitly.
- **Soft deletes.** Rows carry `deleted_at`; every read filters it out. The one
  exception is `POST /admin/cleanup`, which hard-deletes to restore the baseline.
- **Errors.** The API returns `{"detail": "a readable sentence"}`, and the client
  surfaces that message rather than an HTTP status string.
- **Secrets** live only in `.env` files (gitignored) or your host's secret store.
  Anything in `frontend/.env` ships inside the JS bundle, so it must never hold
  a secret — the admin key is typed in at runtime instead.
