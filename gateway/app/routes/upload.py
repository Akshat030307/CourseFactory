import subprocess
import sys
import uuid
from pathlib import Path

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
    require_instructor(request.state.identity)
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(load("courses.sql"))
    return [Course(**dict(row)) for row in rows]


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

    resolved_course_id = course_id or f"c_{slugify(new_course_title)}"
    resolved_course_title = new_course_title if new_course_title else course_id

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
        await conn.execute(load("upsert_course.sql"), resolved_course_id, resolved_course_title)
        next_seq = await conn.fetchval(load("next_sequence.sql"), resolved_course_id)
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
