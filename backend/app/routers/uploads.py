"""Cloudinary signed-upload issuance.

The signature is short-lived and scoped to a folder. Requiring a signed-in user
stops the endpoint from becoming an open upload relay for your Cloudinary quota.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app import media
from app.config import settings
from app.dependencies import get_current_user
from app.models import UploadSignatureResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/signature", response_model=UploadSignatureResponse)
async def create_upload_signature(
    folder: str | None = Query(default=None, max_length=120),
    _user: dict = Depends(get_current_user),
):
    if not media.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image uploads are not configured on this server.",
        )

    subfolder = settings.cloudinary_upload_folder
    if folder:
        # Keep uploads inside the configured root, whatever the client asks for.
        safe = folder.strip("/").replace("..", "")
        if safe:
            subfolder = f"{settings.cloudinary_upload_folder}/{safe}"

    return media.build_upload_signature(folder=subfolder)
