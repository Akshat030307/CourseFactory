import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import (
    COOKIE_NAME,
    Identity,
    cookie_token_from_headers,
    create_session_token,
    resolve_login,
    verify_session_token,
)

router = APIRouter()

# Cookie lifetime matches the JWT's own — no point in a cookie that outlives
# the token it carries. 7 days, not "session" (browser-close-expiring),
# since the closest real user of this is one instructor coming back daily.
COOKIE_MAX_AGE = 60 * 60 * 24 * 7

# Secure=True cookies are silently dropped by browsers over plain HTTP —
# right for the real VPS deployment (Caddy terminates real HTTPS), wrong
# for testing this locally over http://localhost. Default true (production
# is the common case now); set COOKIE_SECURE=false in a local .env to test
# the login flow against `npm run dev`.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"


class LoginRequest(BaseModel):
    username: str
    password: str


class MeResponse(BaseModel):
    authenticated: bool
    username: str | None = None
    role: str | None = None
    student_id: str | None = None


@router.post("/auth/login")
async def login(request: Request, body: LoginRequest, response: Response) -> MeResponse:
    async with request.app.state.pool.acquire() as conn:
        identity = await resolve_login(conn, body.username, body.password)
    if identity is None:
        raise HTTPException(status_code=401, detail="Wrong username or password.")

    token = create_session_token(identity)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return MeResponse(authenticated=True, username=identity.username, role=identity.role, student_id=identity.student_id)


@router.post("/auth/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request) -> MeResponse:
    token = cookie_token_from_headers(request.headers.get("cookie", ""))
    payload = verify_session_token(token) if token else None
    if not payload:
        return MeResponse(authenticated=False)
    identity = Identity(role=payload["role"], student_id=payload.get("student_id"), username=payload["sub"])
    return MeResponse(authenticated=True, username=identity.username, role=identity.role, student_id=identity.student_id)
