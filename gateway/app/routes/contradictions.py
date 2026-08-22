from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.queries import load

router = APIRouter()


class Claim(BaseModel):
    lecture_id: str
    timestamp_ms: int
    text: str


class Contradiction(BaseModel):
    id: str
    confidence: float
    claim_a: Claim
    claim_b: Claim
    note: str | None


@router.get("/courses/{course_id}/contradictions")
async def get_contradictions(request: Request, course_id: str) -> list[Contradiction]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("contradictions.sql"), course_id)
    return [
        Contradiction(
            id=row["id"],
            confidence=row["confidence"],
            claim_a=Claim(lecture_id=row["claim_a_lecture_id"], timestamp_ms=row["claim_a_timestamp_ms"], text=row["claim_a_text"]),
            claim_b=Claim(lecture_id=row["claim_b_lecture_id"], timestamp_ms=row["claim_b_timestamp_ms"], text=row["claim_b_text"]),
            note=row["note"],
        )
        for row in rows
    ]
