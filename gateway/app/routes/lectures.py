from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.auth import resolve_student_id
from app.queries import load

router = APIRouter()


class Lecture(BaseModel):
    id: str
    title: str
    course_id: str
    sequence: int
    duration_ms: int | None
    status: str
    video_url: str
    mastery: float | None


class Segment(BaseModel):
    id: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None


class Frame(BaseModel):
    id: str
    timestamp_ms: int
    thumb_url: str
    ocr_text: str | None
    ocr_confidence: float | None
    vision_description: str | None
    spoken_elsewhere: bool


class Track(BaseModel):
    kind: str
    lang: str
    url: str


@router.get("/lectures")
async def list_lectures(request: Request, student_id: str | None = None) -> list[Lecture]:
    effective_student_id = resolve_student_id(request.state.identity, student_id)
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("lectures.sql"), effective_student_id)
    return [Lecture(**dict(row)) for row in rows]


@router.get("/lectures/{lecture_id}/segments")
async def list_segments(
    request: Request,
    lecture_id: str,
    from_ms: int | None = None,
    to_ms: int | None = None,
) -> list[Segment]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("segments.sql"), lecture_id, from_ms, to_ms)
    return [Segment(**dict(row)) for row in rows]


@router.get("/lectures/{lecture_id}/frames")
async def list_frames(
    request: Request,
    lecture_id: str,
    from_ms: int | None = None,
    to_ms: int | None = None,
    limit: int = 500,
) -> list[Frame]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("frames.sql"), lecture_id, from_ms, to_ms, limit)
    return [
        Frame(
            id=row["id"],
            timestamp_ms=row["timestamp_ms"],
            thumb_url=row["thumb_path"],
            ocr_text=row["ocr_text"],
            ocr_confidence=row["ocr_confidence"],
            vision_description=row["vision_description"],
            spoken_elsewhere=row["spoken_elsewhere"],
        )
        for row in rows
    ]


@router.get("/lectures/{lecture_id}/tracks")
async def list_tracks(request: Request, lecture_id: str) -> list[Track]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("tracks.sql"), lecture_id)
    return [Track(kind=row["kind"], lang=row["lang"], url=row["path"]) for row in rows]
