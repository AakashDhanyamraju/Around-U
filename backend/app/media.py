"""Cloudinary signed uploads.

The client uploads straight to Cloudinary; the backend only signs the request.
That keeps large files off the API process and keeps the API secret server-side.
Unsigned upload presets are deliberately not used — they let anyone upload to
your account.
"""

import logging
import time
from typing import Optional

import cloudinary
import cloudinary.api
import cloudinary.uploader
import cloudinary.utils

from app.config import settings

logger = logging.getLogger(__name__)

_configured = False


def configure() -> bool:
    global _configured
    if _configured:
        return True
    if not settings.cloudinary_configured:
        logger.info("Cloudinary not configured — upload endpoints will return 503")
        return False
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    _configured = True
    logger.info("Cloudinary configured (cloud=%s)", settings.cloudinary_cloud_name)
    return True


def is_configured() -> bool:
    return settings.cloudinary_configured


def build_upload_signature(folder: Optional[str] = None) -> dict:
    """Returns everything a client needs for a direct signed upload.

    Only the parameters signed here may be sent with the upload — Cloudinary
    recomputes the signature over them and rejects any mismatch.
    """
    configure()
    target_folder = folder or settings.cloudinary_upload_folder
    timestamp = int(time.time())

    params_to_sign = {"folder": target_folder, "timestamp": timestamp}
    signature = cloudinary.utils.api_sign_request(
        params_to_sign, settings.cloudinary_api_secret
    )

    return {
        "cloud_name": settings.cloudinary_cloud_name,
        "api_key": settings.cloudinary_api_key,
        "timestamp": timestamp,
        "signature": signature,
        "folder": target_folder,
        "upload_url": (
            f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}"
            "/image/upload"
        ),
    }


def delete_asset(public_id: str) -> bool:
    configure()
    try:
        result = cloudinary.uploader.destroy(public_id, invalidate=True)
        return result.get("result") == "ok"
    except Exception as e:  # cloudinary raises bare Exception subclasses
        logger.error("Cloudinary delete failed for %s: %s", public_id, e)
        return False
