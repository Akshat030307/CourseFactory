from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.auth import require_instructor
from app.queries import load

router = APIRouter()


class Student(BaseModel):
    id: str
    username: str
    name: str | None
    has_telegram: bool
    created_at: str


@router.get("/students")
async def list_students(request: Request) -> list[Student]:
    """Instructor-only — populates the student switcher (AppShell.tsx) so
    the instructor can view any particular student's mastery/lecture/graph
    data instead of only ever seeing the demo student's."""
    require_instructor(request.state.identity)
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("list_students.sql"))
    return [
        Student(
            id=row["id"],
            username=row["username"],
            name=row["name"],
            has_telegram=row["has_telegram"],
            created_at=row["created_at"].isoformat(),
        )
        for row in rows
    ]
