from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.queries import load
from app.routes.quiz import QuizOption

router = APIRouter()

# No auth system (CLAUDE.md: "one hardcoded student, one instructor") — a
# fixed string is the honest equivalent of a real approved_by identity here.
INSTRUCTOR_ID = "instructor"


class ReviewItem(BaseModel):
    id: str
    lecture_id: str
    lecture_title: str
    concept_id: str | None
    concept_label: str | None
    prompt: str
    options: list[QuizOption]
    correct_option_id: str
    explanation: str | None
    source_timestamp_ms: int
    segment_text: str | None
    frame_id: str | None
    frame_thumb_url: str | None


class ApproveByConceptRequest(BaseModel):
    concept_id: str


@router.get("/review-queue")
async def get_review_queue(request: Request, course_id: str) -> list[ReviewItem]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("review_queue.sql"), course_id)
    return [
        ReviewItem(
            id=row["id"],
            lecture_id=row["lecture_id"],
            lecture_title=row["lecture_title"],
            concept_id=row["concept_id"],
            concept_label=row["concept_label"],
            prompt=row["prompt"],
            options=[QuizOption(**o) for o in row["options"]],
            correct_option_id=row["correct_option_id"],
            explanation=row["explanation"],
            source_timestamp_ms=row["source_timestamp_ms"],
            segment_text=row["segment_text"],
            frame_id=row["frame_id"],
            frame_thumb_url=row["frame_thumb_path"],
        )
        for row in rows
    ]


@router.post("/questions/{question_id}/approve")
async def approve_question(request: Request, question_id: str) -> dict:
    async with request.app.state.pool.acquire() as conn:
        result = await conn.execute(load("approve_question.sql"), question_id, INSTRUCTOR_ID)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail=f"No question with id {question_id!r}.")
    return {"id": question_id, "approved": True}


@router.post("/questions/{question_id}/reject")
async def reject_question(request: Request, question_id: str) -> dict:
    async with request.app.state.pool.acquire() as conn:
        result = await conn.execute(load("reject_question.sql"), question_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail=f"No question with id {question_id!r}.")
    return {"id": question_id, "rejected": True}


@router.post("/review-queue/approve")
async def approve_by_concept(request: Request, body: ApproveByConceptRequest) -> dict:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("approve_questions_by_concept.sql"), body.concept_id, INSTRUCTOR_ID)
    return {"concept_id": body.concept_id, "approved_ids": [r["id"] for r in rows]}
