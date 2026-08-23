import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.auth import resolve_student_id
from app.queries import load

router = APIRouter()

LINK_CODE_TTL = timedelta(minutes=10)
# Unambiguous alphabet — a person types this by hand into Telegram, so no
# 0/O or 1/I/l to misread off a screen.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8


class LinkCodeResponse(BaseModel):
    code: str
    expires_at: datetime


@router.post("/telegram/link-code")
async def create_link_code(request: Request, student_id: str | None = None) -> LinkCodeResponse:
    """A logged-in student (or an instructor acting on a selected student's
    behalf — reuses the same resolver every other student-scoped endpoint
    does) generates a short-lived code, then sends `/start <code>` to the
    Telegram bot to link that chat to this account. Replaces the old
    behavior where /start silently claimed the single demo student
    regardless of who sent it."""
    effective_student_id = resolve_student_id(request.state.identity, student_id)
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    expires_at = datetime.now(timezone.utc) + LINK_CODE_TTL
    async with request.app.state.pool.acquire() as conn:
        await conn.execute(load("insert_telegram_link_code.sql"), code, effective_student_id, expires_at)
    return LinkCodeResponse(code=code, expires_at=expires_at)
