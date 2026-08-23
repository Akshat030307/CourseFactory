import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.auth import require_instructor
from app.queries import load

router = APIRouter()

REPO_ROOT = Path(__file__).resolve().parents[3]
LECTURES_DIR = REPO_ROOT / "lectures"
INGEST_SCRIPT = REPO_ROOT / "scripts" / "ingest.py"

# Anything a browser <video> tag can reliably play without server-side
# transcoding, which is real scope this ticket doesn't need — a naive
# upload-as-mp4 with the wrong container would just produce an unplayable
# lecture, which is worse than telling the user to convert it first.
ALLOWED_EXTENSIONS = {".mp4", ".webm"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2GB — generous for a real lecture, not unbounded


class Course(BaseModel):
    id: str
    title: str


class UploadResponse(BaseModel):
    lecture_id: str
    course_id: str


def slugify(text: str) -> str:
    slug = "".join(c.lower() if c.isalnum() else "-" for c in text).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "course"


@router.get("/courses")
async def list_courses(request: Request) -> list[Course]:
    # Deliberately NOT require_instructor (unlike /upload, /review-queue,
    # /waitlist) — this reverses that Stage 15 default on purpose, not an
    # oversight. GET /lectures already has zero per-student content
    # restriction (every student sees every lecture today), so a course
    # switcher usable by student sessions needs the course list too;
    # extending that same "role-gated, not enrollment-gated" openness from
    # lectures to courses doesn't open a new hole.
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("courses.sql"))
    return [Course(**dict(row)) for row in rows]


async def _resolve_course(conn, course_id: str | None, new_course_title: str | None) -> tuple[str, int]:
    """Shared by /upload and /upload/youtube: upsert the course (a no-op if
    course_id names an existing one), then claim the next free sequence
    slot for it. Returns (resolved_course_id, next_sequence)."""
    resolved_course_id = course_id or f"c_{slugify(new_course_title)}"
    resolved_course_title = new_course_title if new_course_title else course_id
    await conn.execute(load("upsert_course.sql"), resolved_course_id, resolved_course_title)
    next_seq = await conn.fetchval(load("next_sequence.sql"), resolved_course_id)
    return resolved_course_id, next_seq


@router.post("/upload")
async def upload_lecture(
    request: Request,
    file: UploadFile,
    title: str = Form(...),
    course_id: str | None = Form(None),
    new_course_title: str | None = Form(None),
) -> UploadResponse:
    require_instructor(request.state.identity)
    if not title.strip():
        raise HTTPException(400, "Title is required.")
    if not course_id and not new_course_title:
        raise HTTPException(400, "Pick a course or name a new one.")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported video format '{ext or 'unknown'}'. "
            f"Upload {' or '.join(sorted(ALLOWED_EXTENSIONS))} — convert with ffmpeg first if needed.",
        )

    lecture_id = f"l_{uuid.uuid4().hex[:10]}"
    dest = LECTURES_DIR / f"{lecture_id}{ext}"
    LECTURES_DIR.mkdir(parents=True, exist_ok=True)

    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "File too large (2GB limit).")
            out.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "Empty file.")

    async with request.app.state.pool.acquire() as conn:
        resolved_course_id, next_seq = await _resolve_course(conn, course_id, new_course_title)
        await conn.execute(
            load("insert_lecture.sql"), lecture_id, resolved_course_id, title, next_seq, dest.name
        )

    # Fire-and-forget: scripts/ingest.py runs the full pipeline (audio,
    # transcription, board dedup, OCR/vision, embeddings) and writes its own
    # job row that GET /jobs/latest + the existing WebSocket already know how
    # to surface (X5) — no new progress-tracking plumbing needed for this.
    # Inherits this process's env (same conda env, same PATH) exactly like
    # running it by hand from a terminal would.
    subprocess.Popen(
        [
            sys.executable,
            str(INGEST_SCRIPT),
            "--file", str(dest),
            "--lecture-id", lecture_id,
            "--course-id", resolved_course_id,
            "--title", title,
            "--sequence", str(next_seq),
        ],
        cwd=REPO_ROOT,
    )

    return UploadResponse(lecture_id=lecture_id, course_id=resolved_course_id)


class YoutubeUploadRequest(BaseModel):
    url: str
    title: str
    course_id: str | None = None
    new_course_title: str | None = None


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


@router.post("/upload/youtube")
async def upload_from_youtube(request: Request, body: YoutubeUploadRequest) -> UploadResponse:
    require_instructor(request.state.identity)
    if not body.title.strip():
        raise HTTPException(400, "Title is required.")
    if not body.course_id and not body.new_course_title:
        raise HTTPException(400, "Pick a course or name a new one.")

    host = urlparse(body.url).netloc.lower()
    if host not in YOUTUBE_HOSTS:
        raise HTTPException(400, "That doesn't look like a YouTube URL.")

    lecture_id = f"l_{uuid.uuid4().hex[:10]}"

    async with request.app.state.pool.acquire() as conn:
        resolved_course_id, next_seq = await _resolve_course(conn, body.course_id, body.new_course_title)
        # source_path stays NULL — no local file exists yet. scripts/ingest.py
        # downloads it; lectures.sql's own video_url fallback
        # (COALESCE(NULLIF(source_path,''), id || '.mp4')) resolves correctly
        # the instant the download writes to that exact conventional path, so
        # nothing here needs to come back and set source_path later.
        await conn.execute(
            load("insert_lecture.sql"), lecture_id, resolved_course_id, body.title, next_seq, None
        )

    subprocess.Popen(
        [
            sys.executable,
            str(INGEST_SCRIPT),
            "--youtube-url", body.url,
            "--lecture-id", lecture_id,
            "--course-id", resolved_course_id,
            "--title", body.title,
            "--sequence", str(next_seq),
        ],
        cwd=REPO_ROOT,
    )

    return UploadResponse(lecture_id=lecture_id, course_id=resolved_course_id)
