"""Mapping a verified external identity onto a local account.

This is the part of OAuth that is easy to get wrong, so the resolution order is
explicit:

  1. Known provider identity  -> that account, always. The provider's subject id
     is immutable, so this survives the person changing their Google address.
  2. Matching local email     -> link and adopt. Safe *only* because the caller
     has already checked `email_verified`; without that, anyone able to create an
     account at the provider could claim someone else's row by address.
  3. Neither                  -> create a new account, already verified.

Case 1 taking precedence over case 2 is what stops a subject-id change from
silently forking someone into a second account, and stops an email change from
attaching them to a stranger's.
"""

import logging

from app import db
from app.repositories import identities, users
from app.supabase_auth import ExternalIdentity

logger = logging.getLogger(__name__)


async def resolve(identity: ExternalIdentity) -> tuple[dict, bool]:
    """Returns (user, created).

    Assumes the caller has verified the token and confirmed
    `identity.email_verified`.
    """
    # 1. Already-linked identity wins outright.
    existing_link = await identities.by_provider_uid(
        identity.provider, identity.provider_uid
    )
    if existing_link:
        user = await users.by_id(existing_link["user_id"])
        if user:
            await identities.link(
                identity.provider,
                identity.provider_uid,
                user["user_id"],
                identity.email,
            )
            return user, False
        # The account was deleted from under the link; fall through and treat
        # this as a fresh sign-in rather than resurrecting a dead row.
        logger.warning(
            "Identity %s/%s pointed at missing user %s; re-resolving",
            identity.provider,
            identity.provider_uid,
            existing_link["user_id"],
        )

    # 2. Adopt an existing account with the same verified address.
    by_email = await users.by_email(identity.email)
    if by_email:
        await identities.link(
            identity.provider,
            identity.provider_uid,
            by_email["user_id"],
            identity.email,
        )
        updates = {}
        if not by_email.get("email_verified"):
            # The provider vouches for the address, which is at least as strong
            # as our own confirmation email.
            await users.mark_email_verified(by_email["user_id"])
        if not by_email.get("picture") and identity.picture:
            updates["picture"] = identity.picture
        if updates:
            await users.update_profile(by_email["user_id"], **updates)

        refreshed = await users.by_id(by_email["user_id"])
        logger.info(
            "Linked %s identity to existing account %s",
            identity.provider,
            by_email["user_id"],
        )
        return refreshed or by_email, False

    # 3. Brand new account. Created verified — the provider already asserted it.
    async with db.transaction() as conn:
        user_id = users.new_user_id()
        row = await conn.fetchrow(
            """
            INSERT INTO users
              (user_id, email, name, picture, password_hash, email_verified)
            VALUES ($1, $2, $3, $4, NULL, TRUE)
            RETURNING user_id, email, name, picture, email_verified, is_admin,
                      platform_role, creator_id, home_region_id,
                      last_login_at, created_at, updated_at, deleted_at
            """,
            user_id,
            identity.email,
            identity.name or identity.email.split("@")[0],
            identity.picture,
        )
        await conn.execute(
            """
            INSERT INTO auth_identities
              (provider, provider_uid, user_id, email, last_seen_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (provider, provider_uid) DO UPDATE
              SET email = EXCLUDED.email, last_seen_at = NOW()
            """,
            identity.provider,
            identity.provider_uid,
            user_id,
            identity.email,
        )

    logger.info("Created account %s via %s", user_id, identity.provider)
    return dict(row), True
