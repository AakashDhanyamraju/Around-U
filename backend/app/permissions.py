"""Role-based access control.

Two orthogonal layers, deliberately kept apart:

  * platform role  — `users.platform_role`, one per account: user / creator / staff
  * community role — `community_members.role`, one row per user per community:
                     member / manager / head

They are separate because a single person can be a creator for Houston, the head
of one community and a plain member of three others all at once. A flat enum
cannot express that.

Every check here is server-side and authoritative. The client receives role data
only so it can hide UI it would not be allowed to use.
"""

from typing import Callable, Optional

from fastapi import Depends, HTTPException, Path, status

from app import db
from app.dependencies import get_current_user, optional_user

# ---------- platform roles ----------
ROLE_USER = "user"
ROLE_CREATOR = "creator"
ROLE_STAFF = "staff"
ROLE_SUPERADMIN = "superadmin"

# `staff` and `superadmin` are a hierarchy; `creator` is a capability that sits
# beside them rather than below, so it is deliberately not ranked here. A staff
# account still needs a linked creator profile to publish.
_ELEVATED_RANK = {ROLE_STAFF: 1, ROLE_SUPERADMIN: 2}

PLATFORM_ROLES = (ROLE_USER, ROLE_CREATOR, ROLE_STAFF, ROLE_SUPERADMIN)

# ---------- community roles ----------
COMMUNITY_MEMBER = "member"
COMMUNITY_MANAGER = "manager"
COMMUNITY_HEAD = "head"

# Ordered so a check can be written as "at least manager".
_COMMUNITY_RANK = {COMMUNITY_MEMBER: 1, COMMUNITY_MANAGER: 2, COMMUNITY_HEAD: 3}

STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_BANNED = "banned"


def is_staff(user: Optional[dict]) -> bool:
    """True for staff *and* superadmin.

    Every existing community check calls this, so ranking rather than comparing
    equality is what makes superadmin a strict superset of staff instead of a
    sibling that silently loses those powers.
    """
    if not user:
        return False
    return _ELEVATED_RANK.get(user.get("platform_role", ""), 0) >= _ELEVATED_RANK[ROLE_STAFF]


def is_superadmin(user: Optional[dict]) -> bool:
    return bool(user) and user.get("platform_role") == ROLE_SUPERADMIN


def community_rank(role: Optional[str]) -> int:
    return _COMMUNITY_RANK.get(role or "", 0)


def outranks(actor_role: Optional[str], target_role: Optional[str]) -> bool:
    """True when `actor_role` sits strictly above `target_role`.

    Guards the moderation actions: a manager may act on members but never on
    another manager or on the head.
    """
    return community_rank(actor_role) > community_rank(target_role)


# ---------- membership lookup ----------
async def membership(community_id: str, user_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        "SELECT community_id, user_id, role, status, muted_until, joined_at "
        "FROM community_members WHERE community_id = $1 AND user_id = $2",
        community_id,
        user_id,
    )
    return db.as_dict(row)


async def community_for_update(community_id: str) -> Optional[dict]:
    row = await db.fetchrow(
        "SELECT community_id, region_id, slug, name, visibility, join_policy, "
        "       member_count, post_count, archived_at, created_by "
        "FROM communities WHERE community_id = $1 AND deleted_at IS NULL",
        community_id,
    )
    return db.as_dict(row)


async def can_view_community(community: dict, user: Optional[dict]) -> bool:
    """Public communities are readable by anyone, including signed-out guests.

    Private ones require an active membership — or staff.
    """
    if community["visibility"] == "public":
        return True
    if not user:
        return False
    if is_staff(user):
        return True
    member = await membership(community["community_id"], user["user_id"])
    return bool(member) and member["status"] == STATUS_ACTIVE


# ---------- platform role dependencies ----------
def require_platform_role(*allowed: str) -> Callable:
    """Dependency factory gating an endpoint on the caller's platform role.

    Elevated roles pass anything they outrank, so `staff` satisfies a `creator`
    gate and `superadmin` satisfies a `staff` gate.
    """

    async def _check(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("platform_role", ROLE_USER)
        if role in allowed:
            return user

        # An elevated role also satisfies any gate it outranks. An unranked gate
        # (`creator`) counts as staff level, so staff and superadmin clear it
        # while a plain user does not.
        needed = max(
            _ELEVATED_RANK.get(a, _ELEVATED_RANK[ROLE_STAFF]) for a in allowed
        )
        if _ELEVATED_RANK.get(role, 0) >= needed:
            return user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )

    return _check


require_creator = require_platform_role(ROLE_CREATOR)
require_staff = require_platform_role(ROLE_STAFF)
require_superadmin = require_platform_role(ROLE_SUPERADMIN)


async def require_verified(user: dict = Depends(get_current_user)) -> dict:
    """Gate for actions that put a person in front of strangers.

    Creating a community, and later hosting an adhoc meetup, both sit behind a
    confirmed email address.
    """
    if not user.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address first.",
        )
    return user


async def require_region_grant(creator_id: str, region_id: str) -> None:
    """A creator may only publish into regions they have been granted."""
    granted = await db.fetchval(
        "SELECT 1 FROM creator_regions WHERE creator_id = $1 AND region_id = $2",
        creator_id,
        region_id,
    )
    if not granted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a creator for that region.",
        )


# ---------- community role dependencies ----------
class CommunityContext:
    """Resolved community + the caller's standing in it, passed to handlers."""

    def __init__(self, community: dict, user: Optional[dict], member: Optional[dict]):
        self.community = community
        self.user = user
        self.member = member

    @property
    def community_id(self) -> str:
        return self.community["community_id"]

    @property
    def role(self) -> Optional[str]:
        # Staff act with head-level authority without being a member.
        if is_staff(self.user):
            return COMMUNITY_HEAD
        if self.member and self.member["status"] == STATUS_ACTIVE:
            return self.member["role"]
        return None

    @property
    def is_active_member(self) -> bool:
        return self.role is not None

    def at_least(self, role: str) -> bool:
        return community_rank(self.role) >= community_rank(role)


async def _load(community_id: str, user: Optional[dict]) -> CommunityContext:
    community = await community_for_update(community_id)
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Community not found"
        )
    member = await membership(community_id, user["user_id"]) if user else None
    return CommunityContext(community, user, member)


async def community_context(
    community_id: str = Path(...),
    user: Optional[dict] = Depends(optional_user),
) -> CommunityContext:
    """Read access. Private communities 404 rather than 403 for non-members, so
    their existence is not disclosed."""
    ctx = await _load(community_id, user)
    if not await can_view_community(ctx.community, user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Community not found"
        )
    return ctx


async def authed_community_context(
    community_id: str = Path(...),
    user: dict = Depends(get_current_user),
) -> CommunityContext:
    """Community context for endpoints that need a signed-in caller but no
    particular role — joining, for instance, happens before membership exists.

    Depending on `get_current_user` rather than `optional_user` is what makes an
    anonymous request fail with 401 instead of the 404 that resolving the
    community first would produce.
    """
    ctx = await _load(community_id, user)
    if not await can_view_community(ctx.community, user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Community not found"
        )
    return ctx


def require_community_role(min_role: str) -> Callable:
    """Dependency factory gating on the caller's role *within* the community.

    Banned members are rejected outright; muted members may read but not write,
    which callers enforce with `require_not_muted`.
    """

    async def _check(
        community_id: str = Path(...),
        user: dict = Depends(get_current_user),
    ) -> CommunityContext:
        ctx = await _load(community_id, user)

        if ctx.member and ctx.member["status"] == STATUS_BANNED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You have been removed from this community.",
            )
        if not ctx.at_least(min_role):
            # Don't reveal a private community to someone with no standing.
            if not await can_view_community(ctx.community, user):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Community not found"
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to do that.",
            )
        if ctx.community.get("archived_at") and min_role != COMMUNITY_HEAD:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This community is archived.",
            )
        return ctx

    return _check


require_member = require_community_role(COMMUNITY_MEMBER)
require_manager = require_community_role(COMMUNITY_MANAGER)
require_head = require_community_role(COMMUNITY_HEAD)


def require_not_muted(ctx: CommunityContext) -> None:
    """Muting is the soft alternative to banning: read on, write off."""
    from datetime import datetime, timezone

    muted_until = ctx.member.get("muted_until") if ctx.member else None
    if muted_until and muted_until > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are muted in this community.",
        )


def can_edit_content(ctx: CommunityContext, author_user_id: str) -> bool:
    """Authors edit their own; managers and the head moderate everyone's."""
    if ctx.user and ctx.user["user_id"] == author_user_id:
        return True
    return ctx.at_least(COMMUNITY_MANAGER)
