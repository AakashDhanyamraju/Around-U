"""Entry point kept for compatibility with `uvicorn server:app`.

The implementation now lives in the `app` package:
  app/config.py        environment + integration credentials
  app/db.py            asyncpg pool and migration runner
  app/cache.py         Redis cache and login rate limiting
  app/emailer.py       AWS SES transactional email
  app/media.py         Cloudinary signed uploads
  app/security.py      bcrypt hashing and token generation
  app/repositories/    Postgres data access
  app/routers/         HTTP endpoints
  app/seed.py          demo dataset (python -m app.seed)

Prefer `uvicorn app.main:app` for new deployments.
"""

from app.main import app

__all__ = ["app"]
