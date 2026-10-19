"""Public region listing."""

from fastapi import APIRouter, HTTPException, status

from app.repositories import regions

router = APIRouter(tags=["regions"])


@router.get("/regions")
async def list_regions():
    return await regions.list_regions()


@router.get("/regions/{region_id}")
async def get_region(region_id: str):
    region = await regions.by_id(region_id)
    if not region:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Region not found"
        )
    return region
