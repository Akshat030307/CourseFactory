from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler as default_http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

PROBLEM_JSON = "application/problem+json"


def install(app: FastAPI) -> None:
    # Starlette's router raises the base starlette.exceptions.HTTPException
    # directly for unmatched routes (not the fastapi.HTTPException subclass),
    # and handler lookup walks the raised exception's own MRO — a handler
    # registered against the fastapi subclass never matches that base-class
    # instance. Registering against the base class here still catches
    # fastapi.HTTPException too, since the lookup walks up to it.
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        if exc.headers:
            # Preserve behavior for exceptions that rely on custom headers
            # (e.g. WWW-Authenticate) by falling through to the default handler.
            return await default_http_exception_handler(request, exc)
        return JSONResponse(
            status_code=exc.status_code,
            media_type=PROBLEM_JSON,
            content={
                "type": "about:blank",
                "title": exc.detail if isinstance(exc.detail, str) else "Error",
                "status": exc.status_code,
                "instance": str(request.url.path),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            media_type=PROBLEM_JSON,
            content={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "instance": str(request.url.path),
            },
        )
