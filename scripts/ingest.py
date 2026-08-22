"""Ingestion entrypoint. Run per lecture: `python scripts/ingest.py --file lectures/l01.mp4 --lecture-id l01`.

Stage 1 (I1-I4): audio extraction + transcription. Stage 2 (B1-B4): frame
extraction, perceptual dedup, OCR, spoken_elsewhere. Everything downstream
gets added to this same pipeline as its tickets land.
"""

import argparse
import base64
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import psycopg2
import pytesseract
from dotenv import load_dotenv
from PIL import Image, ImageStat

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

if os.name == "nt":
    # pytesseract shells out to tesseract.exe; winget installs it here and it's
    # not reliably on PATH for non-interactive shells.
    default_tesseract = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if Path(default_tesseract).exists():
        pytesseract.pytesseract.tesseract_cmd = default_tesseract

MEDIA_ROOT = Path(__file__).resolve().parents[1] / "media"
DATABASE_URL = os.environ["DATABASE_URL"]
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL_ASR = os.environ.get("GROQ_MODEL_ASR", "whisper-large-v3-turbo")
# llama-4-scout was deprecated by Groq on 2026-06-17 (404s) — found running B3.
GROQ_MODEL_VISION = os.environ.get("GROQ_MODEL_VISION", "qwen/qwen3.6-27b")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_VISION = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_MODEL_EMBED = os.environ.get("OPENAI_MODEL_EMBED", "text-embedding-3-small")

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings"
GROQ_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # ~25MB, verified in F2

FRAME_INTERVAL_SEC = int(os.environ.get("FRAME_INTERVAL_SEC", 5))
DEDUP_HAMMING_THRESHOLD = int(os.environ.get("DEDUP_HAMMING_THRESHOLD", 18))
MAX_VISION_FRAMES = int(os.environ.get("MAX_VISION_FRAMES", 150))
OCR_CONFIDENCE_THRESHOLD = 0.6  # below this, fall back to vision_description
SPOKEN_ELSEWHERE_THRESHOLD = 0.4  # word_similarity cutoff — tune against real footage
CHUNK_MAX_CHARS = 500
CHUNK_MAX_DURATION_MS = 30_000


def extract_audio(video_path: Path, lecture_id: str) -> Path:
    """Mono 16kHz MP3 — cuts the Groq upload by an order of magnitude and
    transcribes just as well. See CLAUDE.md I1."""
    out_dir = MEDIA_ROOT / lecture_id
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = out_dir / "audio.mp3"

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i", str(video_path),
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "libmp3lame",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )
    return audio_path


def _call_transcribe_api(url: str, api_key: str, model: str, audio_path: Path) -> dict:
    with open(audio_path, "rb") as f:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": model, "response_format": "verbose_json"},
            files={"file": (audio_path.name, f, "audio/mpeg")},
            timeout=120,
        )
    response.raise_for_status()
    return response.json()


def transcribe(audio_path: Path) -> list[dict]:
    """Groq whisper-large-v3-turbo, with one retry-then-OpenAI fallback on 429.
    audio_transcribe (the RocketRide node) can't reach Groq — see CLAUDE.md F2 —
    so this calls Groq's API directly instead."""
    size = audio_path.stat().st_size
    if size > GROQ_MAX_UPLOAD_BYTES:
        raise ValueError(
            f"{audio_path} is {size / 1024 / 1024:.1f}MB, over Groq's ~25MB limit. "
            "Chunking isn't built yet (not needed for 8-12 min fixtures per F2) — "
            "use a shorter clip."
        )

    try:
        result = _call_transcribe_api(GROQ_TRANSCRIBE_URL, GROQ_API_KEY, GROQ_MODEL_ASR, audio_path)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 429:
            raise
        time.sleep(2)
        try:
            result = _call_transcribe_api(GROQ_TRANSCRIBE_URL, GROQ_API_KEY, GROQ_MODEL_ASR, audio_path)
        except httpx.HTTPStatusError as e2:
            if e2.response.status_code != 429:
                raise
            result = _call_transcribe_api(OPENAI_TRANSCRIBE_URL, OPENAI_API_KEY, "whisper-1", audio_path)

    return [
        {
            "start_ms": round(seg["start"] * 1000),
            "end_ms": round(seg["end"] * 1000),
            "text": seg["text"].strip(),
        }
        for seg in result["segments"]
    ]


def extract_frames(video_path: Path, lecture_id: str) -> Path:
    """fps=1/5, scaled to 1280 wide. Raw frames land in a scratch dir that
    dedup_frames() empties (moves survivors, deletes the rest) — see B1."""
    raw_dir = MEDIA_ROOT / lecture_id / "_raw_frames"
    raw_dir.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video_path),
            "-vf", f"fps=1/{FRAME_INTERVAL_SEC},scale=1280:-1",
            str(raw_dir / "f%05d.jpg"),
        ],
        check=True,
        capture_output=True,
    )
    return raw_dir


def dhash(gray_img: Image.Image, hash_size: int = 8) -> int:
    img = gray_img.resize((hash_size + 1, hash_size), Image.LANCZOS)
    pixels = list(img.getdata())
    bits = 0
    for row in range(hash_size):
        for col in range(hash_size):
            left = pixels[row * (hash_size + 1) + col]
            right = pixels[row * (hash_size + 1) + col + 1]
            bits = (bits << 1) | int(left > right)
    return bits


DEDUP_GRID = 4
DEDUP_TILE_HASH_SIZE = 6
BLANK_STDDEV_THRESHOLD = 5.0


def is_blank(gray_img: Image.Image) -> bool:
    """A uniform (solid black/white, fade transition) frame has stddev ~0 —
    real footage on this fixture set measures 33-51. A blank frame's dHash
    tiles are all-zero, which is a degenerate comparison point: threshold=18
    is exactly half of the 36-bit tile hash, and real content never differs
    from an all-zero reference by more than ~17 (found via diagnostics on
    l02/l03, where a single fade-to-black title-card frame became a "sink"
    that nothing for the rest of the 10-minute lecture could out-distance,
    silently swallowing every real board state). Drop these before hashing
    so they never become survivors or a comparison baseline."""
    return ImageStat.Stat(gray_img).stddev[0] < BLANK_STDDEV_THRESHOLD


def tiled_hashes(gray_img: Image.Image) -> list[int]:
    """dHash computed per-tile on a DEDUP_GRID x DEDUP_GRID grid, not on the
    whole frame. A whole-frame dHash on this footage is dominated by the
    lecturer's body moving between near-identical board states (tuned
    against real Strang footage — see B2: median consecutive-frame distance
    was 21/64 bits with no clean threshold at all). Tiling isolates that
    motion to a few tiles instead of swamping the signal."""
    w, h = gray_img.size
    tile_w, tile_h = w // DEDUP_GRID, h // DEDUP_GRID
    hashes = []
    for gy in range(DEDUP_GRID):
        for gx in range(DEDUP_GRID):
            box = (gx * tile_w, gy * tile_h, (gx + 1) * tile_w, (gy + 1) * tile_h)
            hashes.append(dhash(gray_img.crop(box), DEDUP_TILE_HASH_SIZE))
    return hashes


def tiled_median_distance(hashes_a: list[int], hashes_b: list[int]) -> int:
    per_tile = sorted(bin(a ^ b).count("1") for a, b in zip(hashes_a, hashes_b))
    return per_tile[len(per_tile) // 2]


def _to_signed_bigint(h: int) -> int:
    # dHash produces a full unsigned 64-bit value; Postgres BIGINT is signed.
    return h - (1 << 64) if h >= (1 << 63) else h


DEDUP_MAX_GAP_MS = 90_000


def dedup_frames(raw_dir: Path, lecture_id: str, threshold: int = DEDUP_HAMMING_THRESHOLD) -> list[dict]:
    """Walk raw frames in time order, keep one whenever the median per-tile
    Hamming distance from the last-kept frame exceeds `threshold` (tuned to
    18 against real footage — see the DEDUP_GRID comment above), OR when
    DEDUP_MAX_GAP_MS has elapsed since the last kept frame regardless of
    distance. The gap fallback exists because the distance metric only
    catches abrupt change (an erase-and-rewrite) — diagnosed on real l02/l03
    footage where board content accumulates gradually (steps added one at a
    time, nothing erased) and the per-step distance never once crosses the
    threshold for the entire rest of a 10-minute lecture, so nothing after
    the first ~55s was ever kept. l01 happened to have dramatic erasures the
    threshold alone catches; not every lecture does. 90s picked to land
    close to l01's own natural average gap (~85s across its 7 survivors),
    so it mostly just backstops lectures where the threshold path goes
    quiet rather than firing constantly on ones where it already works.
    Deletes raw frames immediately after hashing — see B2."""
    frames_dir = MEDIA_ROOT / lecture_id / "frames"
    if frames_dir.exists():
        # Re-ingesting the same lecture — clear last run's survivors so
        # renaming this run's doesn't collide with stale files (Windows
        # rename() errors on an existing target; POSIX would've silently
        # overwritten, masking this until someone hit it on Windows).
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)

    raw_files = sorted(raw_dir.glob("f*.jpg"))
    kept: list[dict] = []
    last_tiled: list[int] | None = None
    last_kept_ms: int | None = None

    for i, raw_path in enumerate(raw_files):
        gray = Image.open(raw_path).convert("L")
        if is_blank(gray):
            raw_path.unlink()
            continue
        tiled = tiled_hashes(gray)
        timestamp_ms = i * FRAME_INTERVAL_SEC * 1000
        gap_expired = last_kept_ms is not None and (timestamp_ms - last_kept_ms) >= DEDUP_MAX_GAP_MS
        if last_tiled is None or tiled_median_distance(tiled, last_tiled) > threshold or gap_expired:
            dest = frames_dir / f"f{len(kept):04d}.jpg"
            raw_path.rename(dest)
            kept.append(
                {
                    "path": dest,
                    "timestamp_ms": timestamp_ms,
                    "phash": _to_signed_bigint(dhash(gray)),
                }
            )
            last_tiled = tiled
            last_kept_ms = timestamp_ms
        else:
            raw_path.unlink()

    raw_dir.rmdir()
    return kept


def ocr_frame(image_path: Path) -> tuple[str, float]:
    data = pytesseract.image_to_data(Image.open(image_path), output_type=pytesseract.Output.DICT)
    words: list[str] = []
    confidences: list[float] = []
    for text, conf in zip(data["text"], data["conf"]):
        text = text.strip()
        if not text:
            continue
        words.append(text)
        conf_val = float(conf)
        if conf_val >= 0:
            confidences.append(conf_val)
    full_text = " ".join(words)
    avg_confidence = (sum(confidences) / len(confidences) / 100) if confidences else 0.0
    return full_text, avg_confidence


VISION_PROMPT = (
    "Transcribe exactly what is written on this blackboard/whiteboard — "
    "math, diagrams, labels, all of it. Be precise and concise. "
    "Answer directly with the transcription only — skip any reasoning or "
    "preamble, do not narrate what you're looking for."
)


def _call_vision_api(url: str, api_key: str, model: str, image_path: Path) -> str:
    b64 = base64.b64encode(image_path.read_bytes()).decode()
    response = httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "max_completion_tokens": 2000,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }
            ],
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"].strip()
    # Both qwen3.6 (Groq) and gpt-5-nano (OpenAI fallback) are reasoning
    # models — they emit <think>...</think> before the actual answer unless
    # told not to. Found the hard way: one response never closed its </think>
    # at all (ran to 45KB of scratch work, presumably hit the token cap
    # mid-thought) and got stored as the board description verbatim. Treat
    # an unclosed think block as "no real answer" rather than raw dump it.
    if "<think>" in content:
        if "</think>" in content:
            content = content.split("</think>", 1)[1].strip()
        else:
            content = ""

    # A refusal ("I'm sorry, I can't read this...") isn't board content, but
    # nothing distinguishes it from real text downstream — it would silently
    # get embedded and flagged as "written but never spoken" (it'll never
    # match a transcript segment either). Filter the common openers.
    # Normalize curly quotes first — models write "can't" with U+2019, not
    # ASCII "'", so a literal-apostrophe check silently never matched.
    normalized = content.lower().replace("’", "'").replace("‘", "'")
    refusal_openers = ("i'm sorry", "i am sorry", "i can't", "i cannot", "i'm having trouble", "i'm unable")
    if normalized.startswith(refusal_openers):
        content = ""

    return content


def vision_describe(image_path: Path) -> str:
    """Groq qwen3.6-27b, with one retry-then-OpenAI fallback on 429 — same
    pattern as transcribe(), per CLAUDE.md's cost-fallback rule."""
    try:
        return _call_vision_api(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_VISION, image_path)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 429:
            raise
        time.sleep(2)
        try:
            return _call_vision_api(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_VISION, image_path)
        except httpx.HTTPStatusError as e2:
            if e2.response.status_code != 429:
                raise
            if not OPENAI_API_KEY:
                raise RuntimeError("Groq vision rate-limited twice and OPENAI_API_KEY isn't set for the fallback") from e2
            return _call_vision_api(OPENAI_CHAT_URL, OPENAI_API_KEY, OPENAI_MODEL_VISION, image_path)


def run_ocr(frames: list[dict]) -> None:
    """Tesseract on every frame; Groq vision only for low-confidence ones,
    hard-capped at MAX_VISION_FRAMES regardless of how many qualify — see B3."""
    vision_used = 0
    for frame in frames:
        text, confidence = ocr_frame(frame["path"])
        frame["ocr_text"] = text
        frame["ocr_confidence"] = confidence
        frame["vision_description"] = None

        if confidence < OCR_CONFIDENCE_THRESHOLD and vision_used < MAX_VISION_FRAMES:
            if vision_used > 0:
                time.sleep(3)  # Groq's free-tier vision rate limit is tight — space calls out
            try:
                frame["vision_description"] = vision_describe(frame["path"])
                vision_used += 1
            except (httpx.HTTPError, RuntimeError) as e:
                # One frame's vision call failing shouldn't sink the whole
                # ingest run — leave vision_description None and move on.
                print(f"vision_describe failed for {frame['path'].name}: {e}")


def compute_spoken_elsewhere(conn, lecture_id: str, board_text: str) -> bool:
    """Does any phrase on this board appear in any transcript segment?
    Trigram word-similarity, not exact match — OCR/vision text is noisy and
    board phrases are short fragments of longer spoken sentences. Checked
    line-by-line: a multi-line board dump ("Row picture\\nMatrix form\\n...")
    is several distinct phrases, and diluting them into one blob before
    matching would wash out a real match against any single one. See B4."""
    lines = [" ".join(line.lower().split()) for line in board_text.split("\n")]
    lines = [line for line in lines if len(line) >= 4]
    if not lines:
        return False
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT max(best)
            FROM unnest(%s::text[]) AS phrase,
                 LATERAL (
                     SELECT max(word_similarity(phrase, lower(text))) AS best
                     FROM segments WHERE lecture_id = %s
                 ) sub
            """,
            (lines, lecture_id),
        )
        (max_similarity,) = cur.fetchone()
    return bool(max_similarity is not None and max_similarity >= SPOKEN_ELSEWHERE_THRESHOLD)


def probe_duration_ms(video_path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(result.stdout.strip()) * 1000)


def set_duration(conn, lecture_id: str, duration_ms: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE lectures SET duration_ms = %s WHERE id = %s",
            (duration_ms, lecture_id),
        )
    conn.commit()


def create_job(conn, lecture_id: str, kind: str) -> str:
    job_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (id, lecture_id, kind, status, started_at)
            VALUES (%s, %s, %s, 'running', now())
            """,
            (job_id, lecture_id, kind),
        )
    conn.commit()
    return job_id


def update_job(
    conn,
    job_id: str,
    *,
    stage: str | None = None,
    pct: int | None = None,
    message: str | None = None,
    add_cost_cents: float = 0.0,
) -> None:
    # X5's trace panel / cost meter read stage+pct (existing), message (the
    # node-level detail) and cost_cents (running total, additive — every
    # OpenAI call this pipeline makes adds its real cost as it happens,
    # rather than one estimate at the end).
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET stage = COALESCE(%s, stage), pct = COALESCE(%s, pct), message = COALESCE(%s, message), cost_cents = cost_cents + %s WHERE id = %s",
            (stage, pct, message, add_cost_cents, job_id),
        )
    conn.commit()


def finish_job(conn, job_id: str, *, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET status = %s, error = %s, pct = CASE WHEN %s THEN 100 ELSE pct END, finished_at = now()
            WHERE id = %s
            """,
            ("failed" if error else "done", error, error is None, job_id),
        )
    conn.commit()


def ensure_lecture(conn, lecture_id: str, course_id: str, title: str, sequence: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO courses (id, title) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (course_id, course_id),
        )
        cur.execute(
            """
            INSERT INTO lectures (id, course_id, title, sequence, status)
            VALUES (%s, %s, %s, %s, 'transcribing')
            ON CONFLICT (id) DO UPDATE SET status = 'transcribing'
            """,
            (lecture_id, course_id, title, sequence),
        )
    conn.commit()


def write_segments(conn, lecture_id: str, segments: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM segments WHERE lecture_id = %s", (lecture_id,))
        for i, seg in enumerate(segments):
            cur.execute(
                """
                INSERT INTO segments (id, lecture_id, start_ms, end_ms, text)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (f"{lecture_id}_s{i:04d}", lecture_id, seg["start_ms"], seg["end_ms"], seg["text"]),
            )
        cur.execute(
            "UPDATE lectures SET status = 'extracting' WHERE id = %s",
            (lecture_id,),
        )
    conn.commit()


def write_frames(conn, lecture_id: str, frames: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM frames WHERE lecture_id = %s", (lecture_id,))
        for i, f in enumerate(frames):
            f["id"] = f"{lecture_id}_f{i:04d}"
            cur.execute(
                """
                INSERT INTO frames (id, lecture_id, timestamp_ms, phash, thumb_path,
                                     ocr_text, ocr_confidence, vision_description, spoken_elsewhere)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    f["id"],
                    lecture_id,
                    f["timestamp_ms"],
                    f["phash"],
                    f"/media/{lecture_id}/frames/{f['path'].name}",
                    f["ocr_text"],
                    f["ocr_confidence"],
                    f["vision_description"],
                    f["spoken_elsewhere"],
                ),
            )
        cur.execute("UPDATE lectures SET status = 'analyzing' WHERE id = %s", (lecture_id,))
    conn.commit()


def chunk_transcript(segments: list[dict]) -> list[dict]:
    """Group consecutive segments into ~30s / ~500-char windows — small
    enough for a search snippet to stay coherent, large enough that search
    isn't matching against single fragments like "at a time." See S1."""
    chunks: list[dict] = []
    buf_texts: list[str] = []
    buf_start_ms: int | None = None
    buf_last_end_ms = 0

    def flush() -> None:
        if buf_texts:
            chunks.append({"source": "transcript", "timestamp_ms": buf_start_ms, "text": " ".join(buf_texts), "frame_id": None})

    for seg in segments:
        if buf_start_ms is None:
            buf_start_ms = seg["start_ms"]
        buf_texts.append(seg["text"])
        buf_last_end_ms = seg["end_ms"]
        duration = buf_last_end_ms - buf_start_ms
        if duration >= CHUNK_MAX_DURATION_MS or sum(len(t) for t in buf_texts) >= CHUNK_MAX_CHARS:
            flush()
            buf_texts = []
            buf_start_ms = None
    flush()
    return chunks


def chunk_boards(frames: list[dict]) -> list[dict]:
    """One chunk per frame — vision_description when we have it (more
    reliable than raw OCR), else ocr_text. Frames with no usable text at all
    (vision rate-limited, OCR found nothing) are skipped. See S1."""
    chunks = []
    for f in frames:
        text = f["vision_description"] or f["ocr_text"]
        if text and text.strip():
            chunks.append({"source": "board", "timestamp_ms": f["timestamp_ms"], "text": text, "frame_id": f["id"]})
    return chunks


# text-embedding-3-small's published rate ($/1M tokens) — a standard,
# stable OpenAI price, not something re-checked live this session the way
# CLAUDE.md's nano pricing was; flagged as such rather than implying fresh
# verification it didn't get.
OPENAI_EMBED_COST_PER_M_TOKENS = 0.02


def embed_texts(texts: list[str]) -> tuple[list[list[float]], float]:
    """Returns (embeddings, cost_cents) — the real cost of this call, from
    the API's own reported token usage, not an estimate from len(texts)."""
    if not texts:
        return [], 0.0
    response = httpx.post(
        OPENAI_EMBED_URL,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={"model": OPENAI_MODEL_EMBED, "input": texts},
        timeout=60,
    )
    response.raise_for_status()
    body = response.json()
    embeddings = [row["embedding"] for row in body["data"]]
    tokens = body.get("usage", {}).get("total_tokens", 0)
    cost_cents = (tokens / 1_000_000) * OPENAI_EMBED_COST_PER_M_TOKENS * 100
    return embeddings, cost_cents


def write_chunks(conn, lecture_id: str, chunks: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM chunks WHERE lecture_id = %s", (lecture_id,))
        for c in chunks:
            cur.execute(
                """
                INSERT INTO chunks (lecture_id, source, timestamp_ms, frame_id, text, embedding)
                VALUES (%s, %s, %s, %s, %s, %s::vector)
                """,
                (lecture_id, c["source"], c["timestamp_ms"], c["frame_id"], c["text"], str(c["embedding"])),
            )
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--lecture-id", required=True)
    parser.add_argument("--course-id", default="18.06")
    parser.add_argument("--title", default=None)
    parser.add_argument("--sequence", type=int, default=1)
    args = parser.parse_args()
    title = args.title or args.lecture_id

    conn = psycopg2.connect(DATABASE_URL)
    ensure_lecture(conn, args.lecture_id, args.course_id, title, args.sequence)
    set_duration(conn, args.lecture_id, probe_duration_ms(args.file))

    job_id = create_job(conn, args.lecture_id, "ingest")
    print(f"job {job_id} running")

    try:
        update_job(conn, job_id, stage="audio_extraction", pct=0, message="Extracting mono 16kHz audio via ffmpeg")
        audio_path = extract_audio(args.file, args.lecture_id)
        print(f"audio extracted: {audio_path} ({audio_path.stat().st_size / 1024:.0f} KB)")

        update_job(conn, job_id, stage="transcription", pct=10, message=f"Transcribing via Groq {GROQ_MODEL_ASR}")
        segments = transcribe(audio_path)
        print(f"transcribed: {len(segments)} segments")

        update_job(conn, job_id, stage="writing_segments", pct=25, message=f"Writing {len(segments)} transcript segments")
        write_segments(conn, args.lecture_id, segments)
        print(f"wrote segments for {args.lecture_id}")

        update_job(conn, job_id, stage="frame_extraction", pct=30, message="Extracting frames at 1 per 5s via ffmpeg")
        raw_dir = extract_frames(args.file, args.lecture_id)
        raw_count = len(list(raw_dir.glob("f*.jpg")))
        print(f"extracted {raw_count} raw frames")

        update_job(conn, job_id, stage="dedup", pct=45, message=f"Deduping {raw_count} frames via perceptual hashing")
        frames = dedup_frames(raw_dir, args.lecture_id)
        print(f"deduped: {len(frames)} board states survived ({raw_count} -> {len(frames)})")

        update_job(conn, job_id, stage="ocr", pct=55, message=f"OCR + Groq vision on {len(frames)} board states")
        run_ocr(frames)
        print(f"ocr'd {len(frames)} frames")

        update_job(conn, job_id, stage="spoken_elsewhere", pct=85, message="Matching board text against transcript (pg_trgm)")
        for f in frames:
            # vision_description is far more reliable than raw OCR on chalk
            # handwriting when it exists — use it for the match if we have it.
            text_for_match = f["vision_description"] or f["ocr_text"]
            f["spoken_elsewhere"] = compute_spoken_elsewhere(conn, args.lecture_id, text_for_match)
        never_spoken = sum(1 for f in frames if not f["spoken_elsewhere"])
        print(f"{never_spoken}/{len(frames)} frames never spoken aloud")

        update_job(conn, job_id, stage="writing_frames", pct=90, message=f"Writing {len(frames)} board states")
        write_frames(conn, args.lecture_id, frames)
        print(f"wrote frames for {args.lecture_id}")

        update_job(conn, job_id, stage="chunking_embedding", pct=95, message=f"Embedding chunks via OpenAI {OPENAI_MODEL_EMBED}")
        chunks = chunk_transcript(segments) + chunk_boards(frames)
        embeddings, embed_cost_cents = embed_texts([c["text"] for c in chunks])
        for c, e in zip(chunks, embeddings):
            c["embedding"] = e
        write_chunks(conn, args.lecture_id, chunks)
        update_job(conn, job_id, add_cost_cents=embed_cost_cents, message=f"Embedded {len(chunks)} chunks ({embed_cost_cents:.4f}¢)")
        print(f"embedded {len(chunks)} chunks ({sum(1 for c in chunks if c['source']=='transcript')} transcript, {sum(1 for c in chunks if c['source']=='board')} board)")

        with conn.cursor() as cur:
            cur.execute("UPDATE lectures SET status = 'ready' WHERE id = %s", (args.lecture_id,))
        conn.commit()

        finish_job(conn, job_id)
        print(f"job {job_id} done")
    except Exception as e:
        finish_job(conn, job_id, error=str(e))
        conn.close()
        raise

    conn.close()


if __name__ == "__main__":
    main()
