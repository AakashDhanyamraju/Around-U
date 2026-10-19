"""Passwordless authentication.

Two sign-in paths, and both establish ownership of the email address as a side
effect of signing in:

  * Google, via Supabase — the provider asserts `email_verified`
  * Email OTP           — entering the code IS the proof of ownership

That is what makes "every account has a verified email" an invariant rather than
a follow-up step. There is no password path; `users.password_hash` remains in the
schema but nothing reads it.

Sessions are still opaque server-side bearer tokens, so the token shape the
frontend already handles is unchanged and no other endpoint needed touching.

Anti-enumeration stance: requesting a code returns the same response whether or
not the address has an account, and every verification failure returns one
message regardless of cause.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app import cache, emailer, identity_link, security, supabase_auth
from app.config import settings
from app.dependencies import get_current_user
from app.models import (
    AuthResponse,
    GoogleAuthRequest,
    OtpRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    UserResponse,
)
from app.repositories import auth_codes, sessions, users

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# One message for every verification failure — wrong code, expired code, no code
# at all, or too many attempts. Distinguishing them tells an attacker which
# addresses are worth pursuing and how close they are.
GENERIC_CODE_ERROR = "That code is not valid or has expired. Request a new one."


def _public_user(user: dict) -> dict:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture"),
        "email_verified": user.get("email_verified", False),
        # The client uses the role only to decide which UI to show; every
        # actual permission is enforced server-side regardless.
        "platform_role": user.get("platform_role", "user"),
        "creator_id": user.get("creator_id"),
        "home_region_id": user.get("home_region_id"),
        "created_at": user["created_at"],
    }


def _client_ip(request: Request) -> str:
    # Behind a proxy/load balancer the real client is the first XFF entry.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _ip_bucket(ip: str) -> str:
    return f"otp-ip:{ip}"


async def _issue_session(user_id: str, user_agent: Optional[str]) -> str:
    token = security.new_session_token()
    await sessions.create_session(user_id, token, user_agent=user_agent)
    return token


# ---------- email OTP ----------
@router.post("/otp/request", response_model=OtpRequestResponse)
async def request_otp(
    payload: OtpRequest,
    request: Request,
    user_agent: Optional[str] = Header(None),
):
    """Sends a one-time code, creating nothing yet.

    The account is only created once the code is verified, so an unverified row
    never exists — someone typing a stranger's address cannot squat it.
    """
    email = payload.email.strip().lower()

    # Per-address cap, counted in Postgres so it holds even with Redis down.
    # Without it this endpoint is a free mail cannon aimed at any address.
    if await auth_codes.recent_request_count(email) >= settings.otp_max_requests_per_window:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many codes requested for this address. "
                f"Try again in {settings.otp_request_window_minutes} minutes."
            ),
        )

    # Per-IP cap on top, to blunt someone walking a list of addresses. Best
    # effort: the Redis limiter fails open, which is why the per-address cap
    # above is the one that actually has to hold.
    #
    # The ceiling is deliberately well above the per-address one: a household or
    # office behind one NAT address shares this counter, and a completed sign-in
    # clears it (see verify_otp), so normal use never accumulates.
    ip_bucket = _ip_bucket(_client_ip(request))
    if await cache.failure_count(ip_bucket) >= settings.otp_max_requests_per_ip:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts from this network. Please try again later.",
        )
    await cache.register_failure(ip_bucket)

    existing = await users.by_email(email)
    purpose = auth_codes.PURPOSE_LOGIN if existing else auth_codes.PURPOSE_SIGNUP

    code, _row = await auth_codes.issue(
        email,
        purpose=purpose,
        name_hint=payload.name,
        user_agent=user_agent,
    )
    await emailer.send_login_code_email(email, code, is_signup=existing is None)

    logger.info("Issued %s code for %s", purpose, email)

    return {
        # Says nothing about whether the account exists.
        "detail": f"We sent a {settings.otp_length}-digit code to {email}.",
        "expires_in_minutes": settings.otp_ttl_minutes,
        # Outside production the code comes back in the response so the flow is
        # usable without a working mailbox — SES is sandboxed, so in development
        # there is frequently no delivery at all. Never set in production.
        "dev_code": None if settings.is_production else code,
    }


@router.post("/otp/verify", response_model=AuthResponse)
async def verify_otp(
    payload: OtpVerifyRequest,
    request: Request,
    user_agent: Optional[str] = Header(None),
):
    """Exchanges a valid code for a session, creating the account if needed."""
    email = payload.email.strip().lower()

    result = await auth_codes.verify(email, payload.code)
    if not result.ok:
        logger.info("OTP verify failed for %s (%s)", email, result.reason)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=GENERIC_CODE_ERROR
        )

    user = await users.by_email(email)
    created = False
    if user is None:
        # Entering the code proved they can read mail at this address, so the
        # account starts verified. There is no separate confirmation step.
        name = payload.name or result.row.get("name_hint") or email.split("@")[0]
        user = await users.insert(
            email=email,
            name=name,
            password_hash=None,
            email_verified=True,
        )
        created = True
        logger.info("Created account %s via OTP", user["user_id"])
    elif not user.get("email_verified"):
        # Pre-existing account from the old password era, or one created before
        # this flow — a successful code is the verification it was waiting for.
        await users.mark_email_verified(user["user_id"])
        user = await users.by_id(user["user_id"])

    user = await users.promote_if_configured(user)

    token = await _issue_session(user["user_id"], user_agent)
    await users.touch_last_login(user["user_id"])
    # A completed sign-in clears the network-level counter, so a shared address
    # is not slowly throttled out by legitimate use.
    await cache.clear_failures(_ip_bucket(_client_ip(request)))

    return {
        "user": _public_user(user),
        "session_token": token,
        "created": created,
    }


# ---------- Google via Supabase ----------
@router.post("/google", response_model=AuthResponse)
async def google_sign_in(
    payload: GoogleAuthRequest,
    user_agent: Optional[str] = Header(None),
):
    """Exchanges a verified Supabase access token for one of our sessions.

    Supabase runs the consent flow; this endpoint is where that becomes a local
    account. The token is checked with Supabase before anything in it is trusted.
    """
    if not supabase_auth.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured on this server.",
        )

    try:
        identity = await supabase_auth.identity_from_access_token(payload.access_token)
    except supabase_auth.SupabaseAuthError as e:
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
                if e.retryable
                else status.HTTP_401_UNAUTHORIZED
            ),
            detail=e.message,
        )

    if not identity.email_verified:
        # Linking an unverified provider email to an account by address would let
        # anyone who can create an account at that provider claim someone else's
        # row. Google always verifies, so this should not fire in practice.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your provider has not verified that email address.",
        )

    user, created = await identity_link.resolve(identity)
    user = await users.promote_if_configured(user)

    token = await _issue_session(user["user_id"], user_agent)
    await users.touch_last_login(user["user_id"])
    # A completed OAuth sign-in makes any outstanding emailed code moot.
    await auth_codes.burn_all_for(user["email"])

    return {
        "user": _public_user(user),
        "session_token": token,
        "created": created,
    }


@router.get("/providers")
async def available_providers():
    """Lets the app hide a Google button that would only 503.

    Cheaper and less confusing than discovering it via a failed sign-in.
    """
    return {
        "google": supabase_auth.is_configured(),
        "email_otp": True,
        "password": False,
        "supabase_url": settings.supabase_url or None,
    }


# ---------- session ----------
@router.get("/me", response_model=UserResponse)
async def me(user: dict = Depends(get_current_user)):
    return _public_user(user)


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Idempotent: always 200, so signing out never leaves the client stuck."""
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            await sessions.delete_session(token.strip())
    return {"ok": True}


@router.post("/sign-out-everywhere")
async def sign_out_everywhere(user: dict = Depends(get_current_user)):
    """Drops every session for the account, including the caller's.

    With no password to change, this is the only self-service remedy if someone
    thinks a device is compromised.
    """
    await sessions.delete_all_for_user(user["user_id"])
    return {"ok": True}
