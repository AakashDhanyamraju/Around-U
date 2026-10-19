"""The in-app inbox.

No rendered text is stored or returned — each row carries `type` plus the
structured facts in `data`, and the client builds the sentence. That way a copy
change applies retroactively to messages already in someone's inbox.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_current_user
from app.repositories import notifications

router = APIRouter(tags=["notifications"])


# Declared before /notifications/{notification_id}/read so the literal paths are
# not swallowed by the path parameter.
@router.get("/notifications/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    return {"unread_count": await notifications.unread_count(user["user_id"])}


@router.post("/notifications/read-all")
async def read_all(user: dict = Depends(get_current_user)):
    marked = await notifications.mark_all_read(user["user_id"])
    return {"ok": True, "marked": marked, "unread_count": 0}


@router.get("/notifications")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    rows = await notifications.list_for_user(
        user["user_id"], unread_only=unread_only, limit=limit, offset=offset
    )
    return {
        "notifications": rows,
        "unread_count": await notifications.unread_count(user["user_id"]),
    }


@router.post("/notifications/{notification_id}/read")
async def mark_read(notification_id: str, user: dict = Depends(get_current_user)):
    if not await notifications.mark_read(notification_id, user["user_id"]):
        # 404 rather than 403: whether someone else's notification exists is
        # none of this caller's business.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    return {
        "ok": True,
        "unread_count": await notifications.unread_count(user["user_id"]),
    }
