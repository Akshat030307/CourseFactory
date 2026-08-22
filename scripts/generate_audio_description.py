"""Stage 9 — Depth (X3). Run once a lecture's frames are ingested:

    python scripts/generate_audio_description.py --lecture-id l01

Registers an `audio_description` track (db/schema.sql's `tracks` table,
one row per lecture+lang) — a single narrated MP3 walking through that
lecture's deduped board states in order, for a student who can't see them.

**Not RocketRide's `accessibility_describe` node.** That node is real
(checked `.rocketride/schema/accessibility_describe.json` before assuming
otherwise) but it's Google Gemini Vision under the hood and requires a
`GEMINI_API_KEY` this project doesn't have — a new credential dependency,
not a bug to route around. Rather than block on getting one, this reuses
`vision_description`/`ocr_text` already captured for every frame in B2/B3
(real vision calls, already paid for, already grounded) and adds one cheap
OpenAI nano pass per lecture to turn that sequence into a flowing narration
script — no new vision API calls at all. edge-tts (already running as a
compose sidecar, confirmed via `POST :5002/speak`) reads it aloud.
"""

import argparse
import json
import os
import time
from pathlib import Path

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
MEDIA_ROOT = Path(__file__).resolve().parents[1] / "media"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_SMALL = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
EDGE_TTS_URL = os.environ.get("EDGE_TTS_URL", "http://localhost:5002")

NARRATION_SYSTEM = """You write a spoken audio-description script for a blind or low-vision student, describing what a lecturer wrote on the chalkboard over the course of a lecture — they can already hear the lecturer talking, this is ONLY for the board content they can't see.

You're given a time-ordered list of board states (approximate position in the lecture, plus the text/content on the board at that point — some entries are garbled OCR, do your best or skip if truly unusable).

Write flowing prose meant to be read aloud by text-to-speech: reference timing naturally ("early on," "a few minutes later," "toward the end") rather than literal timestamps, describe the mathematical content in words suitable for listening (not reading symbols), and skip anything unusable rather than reading garbage aloud. Keep it under 300 words.

Return strict JSON: {"narration": "..."}"""


def call_nano(system: str, user: str) -> str:
    for attempt in range(2):
        try:
            r = httpx.post(
                OPENAI_CHAT_URL,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={
                    "model": OPENAI_MODEL_SMALL,
                    "response_format": {"type": "json_object"},
                    "reasoning_effort": "low",
                    "max_completion_tokens": 4000,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                },
                timeout=90,
            )
            r.raise_for_status()
            choice = r.json()["choices"][0]
            if choice["finish_reason"] == "length":
                raise RuntimeError("nano call truncated before emitting JSON (finish_reason=length)")
            return json.loads(choice["message"]["content"])["narration"]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt == 0:
                time.sleep(2)
                continue
            raise


def position_label(timestamp_ms: int, duration_ms: int) -> str:
    frac = timestamp_ms / duration_ms if duration_ms else 0
    if frac < 0.15:
        return "at the very start"
    if frac < 0.4:
        return "early in the lecture"
    if frac < 0.6:
        return "around the middle"
    if frac < 0.85:
        return "later in the lecture"
    return "toward the end"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lecture-id", required=True)
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT duration_ms FROM lectures WHERE id = %s", (args.lecture_id,))
        lecture = cur.fetchone()
        if lecture is None:
            raise SystemExit(f"no lecture {args.lecture_id!r}")

        cur.execute(
            "SELECT timestamp_ms, vision_description, ocr_text FROM frames WHERE lecture_id = %s ORDER BY timestamp_ms",
            (args.lecture_id,),
        )
        frames = cur.fetchall()
        if not frames:
            raise SystemExit(f"no frames for {args.lecture_id} — run scripts/ingest.py first")

        entries = []
        for f in frames:
            text = (f["vision_description"] or f["ocr_text"] or "").strip()
            if not text:
                continue
            entries.append(f"[{position_label(f['timestamp_ms'], lecture['duration_ms'])}] {text}")

        if not entries:
            raise SystemExit(f"no usable board text for {args.lecture_id} — nothing to narrate")

        narration = call_nano(NARRATION_SYSTEM, "\n".join(entries))
        print(f"narration ({len(narration)} chars):\n{narration}\n")

        out_dir = MEDIA_ROOT / args.lecture_id
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"ad-{args.lang}.mp3"

        r = httpx.post(f"{EDGE_TTS_URL}/speak", json={"text": narration, "lang": args.lang}, timeout=60)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")

        media_url = f"/media/{args.lecture_id}/ad-{args.lang}.mp3"
        cur.execute(
            """
            INSERT INTO tracks (lecture_id, kind, lang, path) VALUES (%s, 'audio_description', %s, %s)
            ON CONFLICT (lecture_id, kind, lang) DO UPDATE SET path = EXCLUDED.path
            """,
            (args.lecture_id, args.lang, media_url),
        )
    conn.commit()
    print(f"registered audio_description track for {args.lecture_id}/{args.lang}")
    conn.close()


if __name__ == "__main__":
    main()
