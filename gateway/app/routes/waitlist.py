from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
async def mark_invited(request: Request, signup_id: int) -> dict:
    async with request.app.state.pool.acquire() as conn:
        result = await conn.execute(load("mark_waitlist_invited.sql"), signup_id)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail=f"No waitlist entry with id {signup_id}.")
    return {"ok": True}
