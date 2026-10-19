"""FastAPI application wiring."""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app import cache, db, media, seed
from app.config import masked, settings
from app.routers import (
    admin,
    auth,
    communities,
    community_posts,
    content,
    creator,
    moderation,
    notifications,
    regions,
    social,
    spots,
    superadmin,
    uploads,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def _log_integration_status() -> None:
    logger.info("Environment      : %s", settings.environment)
    logger.info("Postgres         : %s", masked(settings.database_url, 28))
    logger.info(
        "Redis            : %s",
        "configured" if settings.redis_configured else "disabled",
    )
    logger.info(
        "AWS SES          : %s",
        f"{settings.aws_ses_region} as {settings.ses_from_email}"
        if settings.ses_configured
        else "not configured (emails will be logged, not sent)",
    )
    logger.info(
        "Cloudinary       : %s",
        settings.cloudinary_cloud_name if settings.cloudinary_configured else "not configured",
    )
    logger.info(
        "Admin API key    : %s",
        "set" if settings.admin_api_key else "UNSET (admin endpoints return 503)",
    )
    logger.info("CORS origins     : %s", ", ".join(settings.cors_origin_list))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _log_integration_status()

    await db.connect()
    await db.run_migrations()
    await db.cleanup_expired_auth_rows()

    await cache.connect()
    media.configure()

    if settings.seed_on_startup:
        # Non-destructive: only fills a genuinely empty database.
        await seed.seed_if_empty()

    logger.info("Startup complete")
    yield

    await cache.disconnect()
    await db.disconnect()


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    # Schema docs are useful in development but are noise-and-surface in prod.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

# CORS must name explicit origins: the wildcard is invalid alongside
# allow_credentials=True and browsers reject the combination outright.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Secret"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    """Turns pydantic's nested error list into one readable sentence.

    FastAPI's default 422 body is an array the frontend cannot show a user, so
    the first message is surfaced as `detail` alongside the raw list.
    """
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query"))
    message = first.get("msg", "Invalid request")
    message = message.removeprefix("Value error, ")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": f"{field}: {message}" if field else message,
            "errors": [
                {
                    "field": ".".join(
                        str(p) for p in e.get("loc", ()) if p not in ("body", "query")
                    ),
                    "message": e.get("msg", ""),
                }
                for e in errors
            ],
        },
    )


api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(content.router)
api_router.include_router(regions.router)
api_router.include_router(social.router)
api_router.include_router(communities.router)
api_router.include_router(community_posts.router)
api_router.include_router(creator.router)
api_router.include_router(spots.router)
api_router.include_router(notifications.router)
api_router.include_router(moderation.router)
api_router.include_router(uploads.router)
api_router.include_router(admin.router)
api_router.include_router(superadmin.router)


@api_router.get("/")
async def root():
    return {"message": "Around You API"}


@api_router.get("/health")
async def health():
    """Reports live dependency state — use this as the container health check."""
    try:
        await db.fetchval("SELECT 1")
        database_ok = True
    except Exception as e:  # noqa: BLE001 - health must never raise
        logger.error("Health check: database unreachable: %s", e)
        database_ok = False

    return JSONResponse(
        status_code=status.HTTP_200_OK if database_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            # Postgres is the only hard dependency; the rest degrade gracefully.
            "status": "ok" if database_ok else "degraded",
            "database": "ok" if database_ok else "unreachable",
            "cache": "ok" if cache.is_available() else "disabled",
            "email": "ok" if settings.ses_configured else "not_configured",
            "uploads": "ok" if media.is_configured() else "not_configured",
        },
    )


app.include_router(api_router)
