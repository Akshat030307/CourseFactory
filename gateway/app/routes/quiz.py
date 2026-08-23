from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import resolve_student_id
from app.queries import load
from app.routes.remediation import RemediationResponse, compute_remediation

router = APIRouter()

# SM-2-lite: correct grows the interval by the current ease and nudges ease
# up slightly (capped); incorrect resets to daily review and nudges ease
# down (floored). This is the actual algorithm, written in A2 (Stage 6) —
# D3 (Stage 8) adds the read side (GET /schedule) that surfaces what this
# has been writing all along, for the Telegram bot and the in-app drill.
EASE_MIN, EASE_MAX = 1.3, 2.8
EASE_STEP = 0.15
MAX_INTERVAL_DAYS = 90


class QuizOption(BaseModel):
    id: str
    text: str


class QuizQuestion(BaseModel):
    id: str
    prompt: str
    options: list[QuizOption]
    correct_option_id: str
    concept_id: str | None
    source_timestamp_ms: int
    explanation: str | None


class AttemptRequest(BaseModel):
    question_id: str
    chosen_option_id: str
    # Advisory only for a student session (their own session id always
    # wins server-side — see resolve_student_id); an instructor/service
    # caller can specify who they're acting on behalf of.
    student_id: str | None = None


class AttemptResponse(BaseModel):
    correct: bool
    remediation: RemediationResponse | None = None


class DueQuestion(BaseModel):
    question_id: str
    due_at: datetime
    lecture_id: str
    lecture_title: str
    prompt: str
    options: list[QuizOption]
    correct_option_id: str
    explanation: str | None
    source_timestamp_ms: int


@router.get("/lectures/{lecture_id}/quiz")
async def get_quiz(request: Request, lecture_id: str, include_unapproved: bool = False) -> list[QuizQuestion]:
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("quiz.sql"), lecture_id, include_unapproved)
    return [
        QuizQuestion(
            id=row["id"],
            prompt=row["prompt"],
            options=[QuizOption(**o) for o in row["options"]],
            correct_option_id=row["correct_option_id"],
            concept_id=row["concept_id"],
            source_timestamp_ms=row["source_timestamp_ms"],
            explanation=row["explanation"],
        )
        for row in rows
    ]


@router.post("/attempts")
async def post_attempt(request: Request, body: AttemptRequest) -> AttemptResponse:
    student_id = resolve_student_id(request.state.identity, body.student_id)
    async with request.app.state.pool.acquire() as conn:
        question = await conn.fetchrow(load("get_question.sql"), body.question_id)
        if question is None:
            raise HTTPException(status_code=404, detail=f"No question with id {body.question_id!r}.")

        correct = body.chosen_option_id == question["correct_option_id"]

        await conn.execute(load("insert_attempt.sql"), student_id, body.question_id, correct)

        if question["concept_id"] is not None:
            await conn.fetchval(load("upsert_mastery.sql"), student_id, question["concept_id"], 1.0 if correct else 0.0)

        prior = await conn.fetchrow(load("get_schedule.sql"), student_id, body.question_id)
        prior_interval = prior["interval_days"] if prior else 1
        prior_ease = prior["ease"] if prior else 2.5
        if correct:
            new_ease = min(prior_ease + EASE_STEP, EASE_MAX)
            new_interval = min(round(prior_interval * new_ease), MAX_INTERVAL_DAYS)
        else:
            new_ease = max(prior_ease - EASE_STEP * 2, EASE_MIN)
            new_interval = 1
        await conn.execute(load("upsert_schedule.sql"), student_id, body.question_id, new_interval, new_ease)

        # Only worth the extra traversal on a wrong answer — a correct one
        # has nothing to remediate. Reuses R1's exact query (graph_queries.py
        # / remediation.py), not a second implementation of the same logic.
        remediation = None if correct else await compute_remediation(conn, body.question_id, student_id)

    return AttemptResponse(correct=correct, remediation=remediation)


@router.get("/schedule")
async def get_schedule(request: Request, student_id: str | None = None) -> list[DueQuestion]:
    """Due reviews (SM-2-lite, D3). Powers both the Telegram bot and the
    in-app drill — same query, same due set, nothing bot-specific baked in
    here."""
    effective_student_id = resolve_student_id(request.state.identity, student_id)
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("schedule_due.sql"), effective_student_id)
    return [
        DueQuestion(
            question_id=row["question_id"],
            due_at=row["due_at"],
            lecture_id=row["lecture_id"],
            lecture_title=row["lecture_title"],
            prompt=row["prompt"],
            options=[QuizOption(**o) for o in row["options"]],
            correct_option_id=row["correct_option_id"],
            explanation=row["explanation"],
            source_timestamp_ms=row["source_timestamp_ms"],
        )
        for row in rows
    ]
