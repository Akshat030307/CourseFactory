"""Stage 9 — Depth (X1). Run once the graph exists:

    python scripts/detect_contradictions.py --course-id 18.06

One claim extracted per concept (OpenAI nano — same provider as the
Map-maker, build_graph.py), grounded in the real transcript excerpt around
where that concept was introduced. "Graph-adjacent" claim pairs — the two
endpoints of each DEPENDS_ON edge — are then checked for genuine
contradiction by the Adversary, deliberately on a **different provider**
(Groq) than the Map-maker, per CLAUDE.md: "so their errors aren't
correlated." Comparing every claim against every other claim would be
O(n^2) and mostly meaningless (an 18.06 claim about matrix multiplication
has no business being checked against one about translation tracks); the
graph already tells us which concepts are related enough for a
contradiction between them to even make sense.

Honest expectation, not a bug to chase: this is one professor teaching one
coherent course. Real, substantive contradictions are unlikely to turn up
in real MIT OCW footage — a clean run reporting zero is the correct
outcome, not a failure to detect something that's there.
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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_SMALL = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL_SMART = os.environ.get("GROQ_MODEL_SMART", "openai/gpt-oss-120b")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

CONTEXT_WINDOW_MS = 60_000
CONFIDENCE_THRESHOLD = 0.6  # below this, too speculative to surface


def call_json(url: str, api_key: str, model: str, system: str, user: str, reasoning_effort: str | None = "low") -> dict:
    body = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if reasoning_effort:
        # gpt-5-nano burns its whole token budget on invisible reasoning
        # tokens without this — see build_graph.py's call_nano for the full
        # story. Groq's gpt-oss models take the same field harmlessly.
        body["reasoning_effort"] = reasoning_effort
        body["max_completion_tokens"] = 4000
    for attempt in range(2):
        try:
            r = httpx.post(url, headers={"Authorization": f"Bearer {api_key}"}, json=body, timeout=90)
            r.raise_for_status()
            choice = r.json()["choices"][0]
            if choice["finish_reason"] == "length":
                raise RuntimeError("call truncated before emitting JSON (finish_reason=length)")
            return json.loads(choice["message"]["content"])
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt == 0:
                time.sleep(2)
                continue
            raise


CLAIM_SYSTEM = """Extract exactly ONE specific, checkable factual claim the lecturer makes about the given concept, grounded in the transcript excerpt. A claim is a concrete assertion (e.g. "the inverse of a product reverses the order: (AB)^-1 = B^-1 A^-1"), not a vague restatement of the definition.

Return strict JSON: {"claim": "...", "timestamp": "MM:SS matching one of the given lines, closest to where this claim is actually stated"}"""


def extract_claim(concept: dict, segments: list[dict]) -> dict | None:
    lo, hi = concept["introduced_ms"] - CONTEXT_WINDOW_MS, concept["introduced_ms"] + CONTEXT_WINDOW_MS
    window = [s for s in segments if lo <= s["start_ms"] <= hi]
    if not window:
        return None
    lines = [f"[{s['start_ms'] // 60000}:{(s['start_ms'] // 1000) % 60:02d}] {s['text']}" for s in window]
    user = f"Concept: {concept['label']}\n\nTranscript excerpt:\n" + "\n".join(lines)
    result = call_json(OPENAI_CHAT_URL, OPENAI_API_KEY, OPENAI_MODEL_SMALL, CLAIM_SYSTEM, user)
    claim_text = result.get("claim", "").strip()
    if not claim_text:
        return None
    ts = result.get("timestamp", "0:00")
    ms = mmss_to_ms(ts)
    nearest = min(window, key=lambda s: abs(s["start_ms"] - ms))
    return {"text": claim_text, "timestamp_ms": nearest["start_ms"]}


def mmss_to_ms(mmss: str) -> int:
    import re

    m = re.match(r"(\d+):(\d+)", mmss.strip())
    return (int(m.group(1)) * 60 + int(m.group(2))) * 1000 if m else 0


ADVERSARY_SYSTEM = """You check whether two claims from a course, about two related concepts, genuinely contradict each other — not just phrased differently, but actually inconsistent if both were true.

Return strict JSON: {"contradicts": true/false, "confidence": 0.0-1.0, "note": "one sentence explaining the contradiction, or empty string if none"}

Be conservative. Two claims about related-but-distinct ideas are not a contradiction just because they sound different. Only flag a real logical inconsistency."""


def check_contradiction(claim_a: dict, claim_b: dict) -> dict:
    """Groq first (the Adversary's own provider, deliberately different
    from the Map-maker's OpenAI nano — CLAUDE.md: "so their errors aren't
    correlated"), retry once, then fall through to OpenAI nano. Found the
    hard way running this for real: 13 back-to-back Groq calls right after
    13 OpenAI calls hit 429s on 5 of them even with call_json's built-in
    single retry — CLAUDE.md's fallback rule ("degrading to a $0.0005 call
    beats erroring") applies here too, even though it means occasionally
    losing the cross-provider guarantee for a handful of comparisons rather
    than silently dropping them."""
    user = f'Claim A ({claim_a["concept_label"]}): "{claim_a["text"]}"\nClaim B ({claim_b["concept_label"]}): "{claim_b["text"]}"'
    try:
        return call_json(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_SMART, ADVERSARY_SYSTEM, user, reasoning_effort=None)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 429:
            raise
        time.sleep(3)
        try:
            return call_json(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_SMART, ADVERSARY_SYSTEM, user, reasoning_effort=None)
        except httpx.HTTPStatusError as e2:
            if e2.response.status_code != 429 or not OPENAI_API_KEY:
                raise
            return call_json(OPENAI_CHAT_URL, OPENAI_API_KEY, OPENAI_MODEL_SMALL, ADVERSARY_SYSTEM, user, reasoning_effort="low")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course-id", default="18.06")
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, label, introduced_in, introduced_ms FROM concepts WHERE course_id = %s ORDER BY introduced_ms",
            (args.course_id,),
        )
        concepts = cur.fetchall()
        if not concepts:
            raise SystemExit(f"no concepts for course {args.course_id} — run scripts/build_graph.py first")

        segments_by_lecture: dict[str, list[dict]] = {}
        claims_by_concept: dict[str, dict] = {}
        cur.execute("DELETE FROM contradictions WHERE claim_a IN (SELECT c.id FROM claims c JOIN concepts co ON co.id = c.concept_id WHERE co.course_id = %s)", (args.course_id,))
        cur.execute("DELETE FROM claims WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = %s)", (args.course_id,))

        for concept in concepts:
            lecture_id = concept["introduced_in"]
            if lecture_id not in segments_by_lecture:
                cur.execute("SELECT start_ms, text FROM segments WHERE lecture_id = %s ORDER BY start_ms", (lecture_id,))
                segments_by_lecture[lecture_id] = cur.fetchall()

            try:
                claim = extract_claim(concept, segments_by_lecture[lecture_id])
            except Exception as e:
                print(f"skipped claim for {concept['id']}: {e}")
                continue
            if claim is None:
                continue

            claim_id = f"claim_{concept['id']}"
            cur.execute(
                "INSERT INTO claims (id, lecture_id, timestamp_ms, text, concept_id) VALUES (%s, %s, %s, %s, %s)",
                (claim_id, lecture_id, claim["timestamp_ms"], claim["text"], concept["id"]),
            )
            claims_by_concept[concept["id"]] = {
                "claim_id": claim_id,
                "text": claim["text"],
                "concept_label": concept["label"],
            }
            print(f"{claim_id}: {claim['text'][:80]}")

        conn.commit()

        cur.execute("SET search_path = ag_catalog, \"$user\", public")
        cur.execute(
            f"""SELECT * FROM cypher('course_graph', $$
                MATCH (a:Concept {{course_id: {_cypher_str(args.course_id)}}})-[:DEPENDS_ON]->(b:Concept)
                RETURN a.id, b.id
            $$) AS (a agtype, b agtype)"""
        )
        pairs = [(json.loads(r["a"]), json.loads(r["b"])) for r in cur.fetchall()]

        found = 0
        checked = 0
        for a_id, b_id in pairs:
            claim_a = claims_by_concept.get(a_id)
            claim_b = claims_by_concept.get(b_id)
            if not claim_a or not claim_b:
                continue
            checked += 1
            try:
                result = check_contradiction(claim_a, claim_b)
            except Exception as e:
                print(f"skipped contradiction check {a_id}<->{b_id}: {e}")
                continue
            if result.get("contradicts") and result.get("confidence", 0) >= CONFIDENCE_THRESHOLD:
                cid = f"x_{a_id}_{b_id}"
                cur.execute(
                    "INSERT INTO contradictions (id, claim_a, claim_b, confidence, note) VALUES (%s, %s, %s, %s, %s)",
                    (cid, claim_a["claim_id"], claim_b["claim_id"], result["confidence"], result.get("note", "")),
                )
                found += 1
                print(f"CONTRADICTION {cid}: {result['note']}")

        conn.commit()

    print(f"checked {checked} graph-adjacent claim pairs, found {found} contradiction(s)")
    conn.close()


def _cypher_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


if __name__ == "__main__":
    main()
