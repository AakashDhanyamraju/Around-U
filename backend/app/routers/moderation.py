"""Reporting, blocking, and the staff moderation queue.

These endpoints are the reason it is safe to let strangers post to each other.
They are deliberately available to every signed-in user, on every target type.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import permissions
from app.dependencies import get_current_user
from app.models import ReportCreate, ReportResolve
from app.repositories import community_posts, moderation

router = APIRouter(tags=["moderation"])


async def _community_for_target(target_type: str, target_id: str):
    """Routes a report to the community that owns the target, when there is one.

    Denormalising it onto the report row is what lets a community manager see
    their own queue without walking every target's parent at read time.
    """
    if target_type == "community_post":
        return await community_posts.community_id_for_post(target_id)
    if target_type == "comment":
        comment = await community_posts.comment_by_id(target_id)
        if comment and comment["target_type"] == "community_post":
            return await community_posts.community_id_for_post(comment["target_id"])
    if target_type == "community":
        return target_id
    return None


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def create_report(
    payload: ReportCreate,
    user: dict = Depends(get_current_user),
):
    if payload.target_type == "user" and payload.target_id == user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot report yourself.",
        )

    community_id = await _community_for_target(payload.target_type, payload.target_id)
    report = await moderation.create_report(
        user["user_id"], payload.model_dump(), community_id=community_id
    )
    if report is None:
        # Already reported by this person and still open. Report it as accepted
        # rather than an error — telling them it "failed" invites a retry loop.
        return {"ok": True, "duplicate": True}
    return report


@router.get("/reports")
async def list_reports(
    report_status: str = Query("open", pattern="^(open|actioned|dismissed)$"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(permissions.require_staff),
):
    """Platform-wide queue. Per-community queues live under /communities/{id}/reports."""
    return {
        "reports": await moderation.list_reports(
            status=report_status, limit=limit, offset=offset
        )
    }


@router.get("/reports/{report_id}")
async def get_report(
    report_id: str,
    user: dict = Depends(get_current_user),
):
    """The detail pane: the reported content, the reporter, the author's history.

    Same authority split as resolving — staff see anything, a community manager
    only their own community's queue.
    """
    report = await moderation.report_detail(report_id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Report not found"
        )
    await _assert_can_handle(report, user)
    return report


@router.post("/reports/{report_id}/resolve")
async def resolve_report(
    report_id: str,
    payload: ReportResolve,
    user: dict = Depends(get_current_user),
):
    report = await moderation.report_by_id(report_id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Report not found"
        )

    await _assert_can_handle(report, user)

    resolved = await moderation.resolve_report(
        report_id,
        user["user_id"],
        payload.status,
        resolution=payload.resolution,
        note=payload.note,
    )
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That report has already been handled.",
        )
    return resolved


async def _assert_can_handle(report: dict, user: dict) -> None:
    """Staff can handle anything; a manager only their own community's queue."""
    if permissions.is_staff(user):
        return

    community_id = report.get("community_id")
    allowed = False
    if community_id:
        member = await permissions.membership(community_id, user["user_id"])
        allowed = (
            member is not None
            and member["status"] == permissions.STATUS_ACTIVE
            and permissions.community_rank(member["role"])
            >= permissions.community_rank(permissions.COMMUNITY_MANAGER)
        )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to do that.",
        )


# ---------- blocks ----------
@router.get("/blocks")
async def my_blocks(user: dict = Depends(get_current_user)):
    return {"blocked_user_ids": await moderation.blocked_user_ids(user["user_id"])}


@router.post("/blocks/{blocked_user_id}")
async def block_user(blocked_user_id: str, user: dict = Depends(get_current_user)):
    if blocked_user_id == user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot block yourself.",
        )
    await moderation.add_block(user["user_id"], blocked_user_id)
    return {"ok": True}


@router.delete("/blocks/{blocked_user_id}")
async def unblock_user(blocked_user_id: str, user: dict = Depends(get_current_user)):
    await moderation.remove_block(user["user_id"], blocked_user_id)
    return {"ok": True}
