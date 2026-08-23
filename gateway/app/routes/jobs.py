from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.queries import load

router = APIRouter()


class LatestJob(BaseModel):
    id: str
    lecture_id: str | None
    status: str
    error: str | None


@router.get("/jobs/latest")
async def get_latest_job(request: Request) -> LatestJob | None:
    async with request.app.state.pool.acquire() as conn:
        row = await conn.fetchrow(load("latest_job.sql"))
    return LatestJob(**dict(row)) if row else None
