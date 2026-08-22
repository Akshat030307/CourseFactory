from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import PUBLIC_HOST
from app.db import lifespan
from app.errors import install as install_error_handlers
from app.routes import contradictions, graph, health, jobs, lectures, quiz, remediation, review_queue, search, upload
from app.ws import router as ws_router

REPO_ROOT = Path(__file__).resolve().parents[2]

app = FastAPI(title="Course Factory Gateway", lifespan=lifespan)

install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[PUBLIC_HOST],
    allow_methods=["*"],
    allow_headers=["*"],
)

v1 = APIRouter(prefix="/api/v1")
v1.include_router(health.router)
v1.include_router(lectures.router)
v1.include_router(search.router)
v1.include_router(graph.router)
v1.include_router(quiz.router)
v1.include_router(remediation.router)
v1.include_router(review_queue.router)
v1.include_router(contradictions.router)
v1.include_router(jobs.router)
v1.include_router(upload.router)

app.include_router(v1)
app.include_router(ws_router)

# Source videos (VideoPlayer) and processed derivatives — thumbnails, audio,
# frames (BoardStrip, later) — served directly, no auth per docs/API.md.
app.mount("/lectures", StaticFiles(directory=REPO_ROOT / "lectures"), name="lectures")
app.mount("/media", StaticFiles(directory=REPO_ROOT / "media"), name="media")
