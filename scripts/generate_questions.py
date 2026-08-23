"""Stage 6 — Assessment (A1). Run once a course's graph is built:

    python scripts/generate_questions.py --course-id 18.06

One nano call per concept: a multiple-choice question grounded in the real
transcript excerpt around that concept's introduction, not generic textbook
phrasing. Every question carries `source_timestamp_ms` (the concept's own
`introduced_ms` — already grounded to a real segment, see build_graph.py)
and `concept_id`. `approved` defaults false — CLAUDE.md: "Don't let
generated questions reach the student view unapproved." Nothing here
flips that; X4 (review queue, Stage 9) is what will.
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Windows' console defaults to the system codepage (cp1252 here), which
# can't encode LLM-generated math notation (e.g. U+2212 MINUS SIGN) that
# routinely shows up in this course's real question prompts — found
# crashing a real run mid-loop. The auto-chain (ingest.py) runs this as a
# subprocess with inherited stdout, so this isn't just a console cosmetic:
# an uncaught crash here on a print() alone would kill the whole chain.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATABASE_URL = os.environ["DATABASE_URL"]
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_SMALL = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

# +/- window of transcript grounding around a concept's introduction.
CONTEXT_WINDOW_MS = 60_000


def call_nano(system: str, user: str, max_completion_tokens: int = 8000, timeout: int = 90) -> dict:
    """Same shape as build_graph.py's call_nano (reasoning_effort=low,
    hard finish_reason check) — see that file's comments for why both
    exist. Not shared via import: two small, independent scripts, matching
    this repo's existing per-script convention (ingest.py, build_graph.py)
    over a shared-utils module."""
    for attempt in range(2):
        try:
            response = httpx.post(
                OPENAI_CHAT_URL,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={
                    "model": OPENAI_MODEL_SMALL,
                    "response_format": {"type": "json_object"},
                    "max_completion_tokens": max_completion_tokens,
                    "reasoning_effort": "low",
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
                timeout=timeout,
            )
            response.raise_for_status()
            choice = response.json()["choices"][0]
            if choice["finish_reason"] == "length":
                raise RuntimeError("nano call truncated before emitting JSON (finish_reason=length)")
            return json.loads(choice["message"]["content"])
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt == 0:
                time.sleep(2)
                continue
            raise


EXAMINER_SYSTEM = """You write one multiple-choice question testing a single concept from a linear algebra lecture, grounded in the actual transcript excerpt given (not generic textbook phrasing — use the professor's own notation and framing where it appears).

Return strict JSON:
{
  "prompt": "the question text",
  "options": [{"id": "a", "text": "..."}, {"id": "b", "text": "..."}, {"id": "c", "text": "..."}, {"id": "d", "text": "..."}],
  "correct_option_id": "the id of the correct option",
  "explanation": "one or two sentences explaining why the correct answer is right, referencing the concept"
}

Exactly 4 options. Wrong options should be plausible mistakes a student might actually make (e.g. a sign error, a swapped row/column, an off-by-one), not obviously silly. The question should test real understanding of the concept, not just recall of a term."""


def generate_question(concept: dict, transcript_excerpt: str) -> dict:
    user = (
        f"Concept: {concept['label']}\n"
        f"Definition: {concept['definition']}\n\n"
        f"Transcript excerpt from where it's introduced:\n{transcript_excerpt}"
    )
    return call_nano(EXAMINER_SYSTEM, user)


def create_job(conn, lecture_id: str | None, kind: str) -> str:
    # Same shape as build_graph.py's create_job — see that file for why
    # lecture_id is nullable and left None for a standalone by-course run.
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


def update_job(conn, job_id: str, *, stage: str | None = None, pct: int | None = None, message: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET stage = COALESCE(%s, stage), pct = COALESCE(%s, pct), message = COALESCE(%s, message) WHERE id = %s",
            (stage, pct, message, job_id),
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course-id", default="18.06")
    parser.add_argument("--lecture-id", default=None)
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, label, definition, introduced_in, introduced_ms FROM concepts WHERE course_id = %s ORDER BY introduced_in, introduced_ms",
            (args.course_id,),
        )
        concepts = cur.fetchall()
        if not concepts:
            raise SystemExit(f"no concepts found for course {args.course_id} — run scripts/build_graph.py first")

    job_id = create_job(conn, args.lecture_id, "generate_questions")
    print(f"job {job_id} running")

    try:
        written = 0
        skipped_approved = 0
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            update_job(conn, job_id, stage="generating_questions", pct=10, message=f"Generating questions for {len(concepts)} concepts")
            for concept in concepts:
                # Guard first, before paying for a nano call: an approved
                # question means a real instructor signed off on it, and may
                # already have real attempts/schedule rows a student earned
                # by answering it — both REFERENCES questions(id) ON DELETE
                # CASCADE. The delete+reinsert below would silently both
                # revert the approval AND permanently destroy that student's
                # history for it. Skip regenerating anything already
                # approved, full stop.
                qid = f"q_{concept['id']}"
                cur.execute("SELECT approved FROM questions WHERE id = %s", (qid,))
                existing = cur.fetchone()
                if existing and existing["approved"]:
                    skipped_approved += 1
                    print(f"skipped {qid}: already approved, not regenerating")
                    continue

                lo, hi = concept["introduced_ms"] - CONTEXT_WINDOW_MS, concept["introduced_ms"] + CONTEXT_WINDOW_MS
                cur.execute(
                    "SELECT text FROM segments WHERE lecture_id = %s AND start_ms BETWEEN %s AND %s ORDER BY start_ms",
                    (concept["introduced_in"], lo, hi),
                )
                excerpt = " ".join(r["text"] for r in cur.fetchall())

                try:
                    q = generate_question(concept, excerpt)
                except Exception as e:
                    print(f"skipped {concept['id']}: {e}")
                    continue

                option_ids = {o["id"] for o in q["options"]}
                if len(q["options"]) != 4 or q["correct_option_id"] not in option_ids:
                    print(f"skipped {concept['id']}: malformed options from model")
                    continue

                cur.execute("DELETE FROM questions WHERE id = %s", (qid,))
                cur.execute(
                    """
                    INSERT INTO questions (id, lecture_id, concept_id, prompt, options, correct_option_id, explanation, source_timestamp_ms, approved)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, false)
                    """,
                    (
                        qid,
                        concept["introduced_in"],
                        concept["id"],
                        q["prompt"],
                        json.dumps(q["options"]),
                        q["correct_option_id"],
                        q.get("explanation", ""),
                        concept["introduced_ms"],
                    ),
                )
                written += 1
                print(f"{qid} ({concept['label']}): {q['prompt'][:70]}")

        conn.commit()
        print(f"wrote {written}/{len(concepts)} questions for course {args.course_id} ({skipped_approved} already approved, left untouched)")
        finish_job(conn, job_id)
        print(f"job {job_id} done")
    except Exception as e:
        finish_job(conn, job_id, error=str(e))
        conn.close()
        raise

    conn.close()


if __name__ == "__main__":
    main()
