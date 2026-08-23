import re
import secrets

import asyncpg
import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import require_instructor
from app.queries import load

router = APIRouter()


class WaitlistJoinRequest(BaseModel):
    name: str
    email: str
    message: str | None = None


class WaitlistItem(BaseModel):
    id: int
    name: str
    email: str
    message: str | None
    invited: bool
    created_at: str


class CreatedAccount(BaseModel):
    username: str
    password: str
    name: str


def _slugify_username(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "", text.lower())
    return slug or "student"


# POST is public (see app/auth_middleware.py's PUBLIC_METHOD_PATHS — same
# path, method-gated: anyone can join, only a logged-in admin can list).
@router.post("/waitlist")
async def join_waitlist(request: Request, body: WaitlistJoinRequest) -> dict:
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name or "@" not in email:
        raise HTTPException(status_code=400, detail="Name and a real email are required.")
    async with request.app.state.pool.acquire() as conn:
        await conn.execute(load("insert_waitlist_signup.sql"), name, email, body.message)
    return {"ok": True}


@router.get("/waitlist")
async def list_waitlist(request: Request) -> list[WaitlistItem]:
    require_instructor(request.state.identity)
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("list_waitlist.sql"))
    return [
        WaitlistItem(
            id=row["id"],
            name=row["name"],
            email=row["email"],
            message=row["message"],
            invited=row["invited"],
            created_at=row["created_at"].isoformat(),
        )
        for row in rows
    ]


@router.post("/waitlist/{signup_id}/invite")
async def create_account(request: Request, signup_id: int) -> CreatedAccount:
    """Stage 15: this used to just flip `invited` as bookkeeping after the
    admin manually emailed credentials. Now it generates those credentials
    itself — still admin-provisioned only (no self-service registration),
    just no longer a separate manual step. The `AND invited = false` guard
    in mark_waitlist_invited.sql makes a double-click safe: the second call
    sees 0 rows updated and 404s instead of creating a second account."""
    require_instructor(request.state.identity)
    async with request.app.state.pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(load("mark_waitlist_invited.sql"), signup_id)
            if row is None:
                raise HTTPException(status_code=404, detail=f"No pending waitlist entry with id {signup_id}.")

            name = row["name"]
            base_username = _slugify_username(row["email"].split("@")[0]) or _slugify_username(name)
            password = secrets.token_urlsafe(12)
            password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

            username = base_username
            suffix = 1
            while True:
                try:
                    # Nested conn.transaction() becomes a SAVEPOINT under
                    # asyncpg — needed because a caught UniqueViolationError
                    # still poisons the OUTER transaction for any further
                    # statement unless the failing insert is isolated behind
                    # its own savepoint to roll back to.
                    async with conn.transaction():
                        await conn.execute(load("insert_student_account.sql"), username, password_hash, name)
                    break
                except asyncpg.UniqueViolationError:
                    suffix += 1
                    username = f"{base_username}{suffix}"

    return CreatedAccount(username=username, password=password, name=name)
