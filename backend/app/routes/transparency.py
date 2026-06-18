"""Transparency endpoints for privacy and cleanup claims."""

from fastapi import APIRouter

from ..utils.cleanup import janitor_stats

router = APIRouter()


@router.get("/transparency/janitor")
async def transparency_janitor():
    """Return aggregate cleanup counters without exposing user file metadata."""
    return janitor_stats()
