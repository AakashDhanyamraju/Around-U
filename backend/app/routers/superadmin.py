"""Superadmin portal.

Role assignment and user administration, restricted to `superadmin`. Staff
deliberately cannot reach any of this: `staff` is platform moderation, while
appointing other admins is privilege escalation and belongs one tier higher.

Every role change is written to `role_audit`, because the previous admin surface
was a shared secret with no identity attached — there was no way to answer "who
did that".
"""

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import cache, permissions
from app.config import settings
from app.models import (
    AdminUserCreate,
    CreatorLinkRequest,
    HomeRegionRequest,
    PlatformRoleUpdate,
    RegionGrantRequest,
)
from app.repositories import communities, content, regions, sessions, users

router = APIRouter(prefix="/superadmin", tags=["superadmin"])

# Every route here sits behind the same gate.
_GATE = [Depends(permissions.require_superadmin)]


def _public(user: dict) -> dict:
    """Never leak password_hash or deleted_at into an API response."""
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture"),
        "email_verified": user.get("email_verified", False),
        "platform_role": user.get("platform_role", "user"),
        "creator_id": user.get("creator_id"),
        "home_region_id": user.get("home_region_id"),
        "last_login_at": user.get("last_login_at"),
        "created_at": user["created_at"],
    }


async def _load(user_id: str) -> dict:
    user = await users.by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


# ---------- overview ----------
@router.get("/overview", dependencies=_GATE)
async def overview():
    role_counts = {
        role: await users.count_by_platform_role(role)
        for role in permissions.PLATFORM_ROLES
    }
    return {
        "users": {
            **role_counts,
            "total": sum(role_counts.values()),
        },
        "content": await content.stats(),
        "super_admin_emails": settings.super_admin_email_list,
        "integrations": {
            "redis": cache.is_available(),
            "email": settings.ses_configured,
            "uploads": settings.cloudinary_configured,
        },
    }


@router.get("/audit", dependencies=_GATE)
async def audit_log(limit: int = Query(100, ge=1, le=500)):
    return {"entries": await users.role_audit(limit)}


# ---------- users ----------
@router.get("/users", dependencies=_GATE)
async def list_users(
    q: Optional[str] = Query(None, max_length=100),
    platform_role: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    if platform_role and platform_role not in permissions.PLATFORM_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown platform_role"
        )
    rows, total = await users.search(
        query=q, platform_role=platform_role, limit=limit, offset=offset
    )
    return {"users": [_public(u) for u in rows], "total": total}


@router.get("/users/{user_id}", dependencies=_GATE)
async def get_user(user_id: str):
    user = await _load(user_id)
    creator = (
        await content.creator_by_id(user["creator_id"]) if user.get("creator_id") else None
    )
    granted = (
        await content.regions_for_creator(user["creator_id"])
        if user.get("creator_id")
        else []
    )
    return {
        "user": _public(user),
        "creator": creator,
        "creator_regions": granted,
        "communities": await communities.communities_for_user(user_id),
    }


@router.post("/users", status_code=status.HTTP_201_CREATED, dependencies=_GATE)
async def create_user(payload: AdminUserCreate):
    if await users.by_email(payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email is already registered.",
        )

    # Passwordless, and email_verified stays FALSE: nothing here proves the
    # person owns the address. Their first one-time code or Google sign-in is
    # what flips it, exactly as for a self-service signup.
    user = await users.insert(
        email=payload.email,
        name=payload.name,
        password_hash=None,
        email_verified=False,
    )

    if payload.platform_role != "user":
        user = await users.set_platform_role(user["user_id"], payload.platform_role)

    # Deliberately sends nothing. The account is a placeholder for the role; the
    # person signs in whenever they like and the code goes out then.
    return {"user": _public(user)}


@router.post("/users/{user_id}/role", dependencies=_GATE)
async def set_role(
    user_id: str,
    payload: PlatformRoleUpdate,
    actor: dict = Depends(permissions.require_superadmin),
):
    user = await _load(user_id)
    previous = user.get("platform_role", "user")

    if previous == payload.platform_role:
        return {"user": _public(user), "changed": False}

    # Locking yourself out is trivially easy and irreversible without database
    # access, so self-demotion goes through a different door (there isn't one).
    if user_id == actor["user_id"] and payload.platform_role != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role. Ask another superadmin.",
        )

    # Never let the last superadmin be demoted — that would leave nobody able to
    # appoint one, since the role is the only thing that can grant itself.
    if previous == "superadmin" and payload.platform_role != "superadmin":
        remaining = await users.count_by_platform_role("superadmin")
        if remaining <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This is the only superadmin. Appoint another one first.",
            )

    # A configured bootstrap address would simply be re-promoted at next login,
    # so refuse rather than pretend the change stuck.
    if settings.is_super_admin_email(user["email"]) and payload.platform_role != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This address is configured as a superadmin and would be restored "
                "on next sign-in. Change SUPER_ADMIN_EMAILS instead."
            ),
        )

    updated = await users.set_platform_role(user_id, payload.platform_role)
    await users.record_role_change(
        subject_id=user_id,
        actor_id=actor["user_id"],
        from_role=previous,
        to_role=payload.platform_role,
        note=payload.note,
    )
    return {"user": _public(updated), "changed": True}


@router.post("/users/{user_id}/creator-link", dependencies=_GATE)
async def link_creator_profile(user_id: str, payload: CreatorLinkRequest):
    """Links an account to a creator profile — the bridge that lets a creator
    log in and publish rather than having content typed in for them."""
    user = await _load(user_id)

    if payload.creator_id is None:
        updated = await users.link_creator(user_id, None)
        return {"user": _public(updated), "creator": None}

    creator = await content.creator_by_id(payload.creator_id)
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Creator profile not found"
        )

    # A partial unique index enforces this too; checking first gives a message
    # that says what is actually wrong.
    holder = await users.by_creator_id(payload.creator_id)
    if holder and holder["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"That creator profile is already linked to {holder['email']}.",
        )

    updated = await users.link_creator(user_id, payload.creator_id)
    # Linking a profile without the role would leave them unable to publish.
    if updated.get("platform_role") == "user":
        updated = await users.set_platform_role(user_id, "creator")
    return {"user": _public(updated), "creator": creator}


@router.post("/users/{user_id}/regions", dependencies=_GATE)
async def grant_region(
    user_id: str,
    payload: RegionGrantRequest,
    actor: dict = Depends(permissions.require_superadmin),
):
    """Grants publishing rights for a region to this account's creator profile."""
    user = await _load(user_id)
    creator_id = user.get("creator_id")
    if not creator_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link a creator profile before granting regions.",
        )
    if not await regions.exists(payload.region_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )

    await content.grant_region(creator_id, payload.region_id, actor["user_id"])
    return {"creator_regions": await content.regions_for_creator(creator_id)}


@router.delete("/users/{user_id}/regions/{region_id}", dependencies=_GATE)
async def revoke_region(user_id: str, region_id: str):
    user = await _load(user_id)
    creator_id = user.get("creator_id")
    if not creator_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account has no creator profile.",
        )
    await content.revoke_region(creator_id, region_id)
    return {"creator_regions": await content.regions_for_creator(creator_id)}


@router.post("/users/{user_id}/home-region", dependencies=_GATE)
async def set_home_region(user_id: str, payload: HomeRegionRequest):
    await _load(user_id)
    if payload.region_id and not await regions.exists(payload.region_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )
    updated = await users.set_home_region(user_id, payload.region_id)
    return {"user": _public(updated)}


@router.post("/users/{user_id}/verify-email", dependencies=_GATE)
async def force_verify_email(user_id: str):
    """SES is still sandboxed, so verifying by hand is sometimes the only way to
    get an account past the email gate."""
    await _load(user_id)
    await users.mark_email_verified(user_id)
    return {"user": _public(await _load(user_id))}


@router.post("/users/{user_id}/revoke-sessions", dependencies=_GATE)
async def revoke_sessions(user_id: str):
    await _load(user_id)
    await sessions.delete_all_for_user(user_id)
    return {"ok": True}


@router.delete("/users/{user_id}", dependencies=_GATE)
async def delete_user(
    user_id: str,
    actor: dict = Depends(permissions.require_superadmin),
):
    user = await _load(user_id)

    if user_id == actor["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account here.",
        )
    if settings.is_super_admin_email(user["email"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This address is configured as a superadmin.",
        )
    if user.get("platform_role") == "superadmin":
        remaining = await users.count_by_platform_role("superadmin")
        if remaining <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This is the only superadmin. Appoint another one first.",
            )

    await users.soft_delete(user_id)
    await users.record_role_change(
        subject_id=user_id,
        actor_id=actor["user_id"],
        from_role=user.get("platform_role"),
        to_role="deleted",
        note="account deleted",
    )
    return {"ok": True}


# ---------- creator profiles ----------
@router.get("/creators", dependencies=_GATE)
async def list_creators():
    """Creator profiles plus which account (if any) holds each one, so the portal
    can show what is still unlinked."""
    creators = await content.list_creators(limit=500)
    for c in creators:
        holder = await users.by_creator_id(c["creator_id"])
        c["linked_user"] = (
            {"user_id": holder["user_id"], "email": holder["email"], "name": holder["name"]}
            if holder
            else None
        )
    return {"creators": creators}
