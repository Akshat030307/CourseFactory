"""Stage 5 — Graph (G1, G2). Run once all of a course's lectures are ingested:

    python scripts/build_graph.py --course-id 18.06

Map-reduces each lecture's transcript into concepts (map_lecture, one call
per ~4K-token chunk), merges duplicates across the whole course in one call
(merge_course), then proposes DEPENDS_ON edges in one call per lecture
(link_edges — see its docstring for why merging and linking are split into
separate calls, and why linking is batched per lecture rather than done in
one shot for the whole course). Per CLAUDE.md's cost rule, long-context
analysis goes to OpenAI nano rather than Groq (Groq's free tier is tight on
tokens/min, not requests). Writes the relational `concepts` table
(labels/definitions, for JOINs) and the AGE `course_graph` (edges — see
gateway/app/graph_queries.py for the read side).
"""

import argparse
import json
import os
import re
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

# ~4K tokens/chunk per CLAUDE.md's map-reduce rule, ~4 chars/token estimate.
# Every fixture lecture here is short enough to land in one chunk; chunking
# still exists so a real full-length lecture doesn't blow the context window.
MAP_CHUNK_MAX_CHARS = 16_000


def ms_to_mmss(ms: int) -> str:
    total_s = ms // 1000
    return f"{total_s // 60}:{total_s % 60:02d}"


def strip_think(content: str) -> str:
    """Defensive only — OpenAI's JSON mode contractually returns pure JSON,
    unlike the Groq vision path (see ingest.py) which needed this for real.
    Costs nothing to keep as insurance against a model that ignores it."""
    if "<think>" in content:
        if "</think>" in content:
            return content.split("</think>", 1)[1].strip()
        return ""
    return content


def call_nano(system: str, user: str, reasoning_effort: str = "low", max_completion_tokens: int = 8000, timeout: int = 60) -> dict:
    for attempt in range(2):
        try:
            response = httpx.post(
                OPENAI_CHAT_URL,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={
                    "model": OPENAI_MODEL_SMALL,
                    "response_format": {"type": "json_object"},
                    "max_completion_tokens": max_completion_tokens,
                    # gpt-5-nano is a reasoning model — without this, it burns the
                    # entire max_completion_tokens budget on invisible reasoning
                    # tokens before emitting any JSON (found running this: 4000/4000
                    # spent on reasoning, finish_reason="length", empty content).
                    "reasoning_effort": reasoning_effort,
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
                raise RuntimeError(
                    f"nano call truncated before emitting JSON (finish_reason=length) — "
                    f"raise max_completion_tokens or shrink the prompt"
                )
            content = strip_think(choice["message"]["content"])
            return json.loads(content)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt == 0:
                time.sleep(2)
                continue
            raise


def chunk_lines(lines: list[str], max_chars: int) -> list[list[str]]:
    chunks: list[list[str]] = []
    buf: list[str] = []
    buf_len = 0
    for line in lines:
        if buf and buf_len + len(line) > max_chars:
            chunks.append(buf)
            buf, buf_len = [], 0
        buf.append(line)
        buf_len += len(line) + 1
    if buf:
        chunks.append(buf)
    return chunks


MAP_SYSTEM = """You extract the key concepts introduced in a lecture transcript excerpt.
Each input line is "[MM:SS] spoken text". Return strict JSON:
{"concepts": [{"label": "short canonical name (2-4 words)", "definition": "one sentence, in this lecture's own terms", "timestamp": "MM:SS matching one of the given lines, as close as possible to where this concept is first introduced"}]}
Only include genuine substantive concepts a student would need to know — not "today", "example", "homework", or other filler. Prefer 3-8 concepts covering the real content of the excerpt."""


def map_lecture(segments: list[dict]) -> list[dict]:
    """One nano call per ~4K-token chunk of this lecture's transcript.
    Returns raw {label, definition, timestamp_ms} mentions grounded to a
    real segment's start_ms (snapped, not trusted verbatim from the model —
    see snap_to_segment)."""
    lines = [f"[{ms_to_mmss(s['start_ms'])}] {s['text']}" for s in segments]
    raw: list[dict] = []
    for chunk in chunk_lines(lines, MAP_CHUNK_MAX_CHARS):
        result = call_nano(MAP_SYSTEM, "\n".join(chunk))
        for c in result.get("concepts", []):
            ms = mmss_to_ms(c.get("timestamp", "0:00"))
            raw.append({
                "label": c["label"].strip(),
                "definition": c.get("definition", "").strip(),
                "timestamp_ms": snap_to_segment(ms, segments),
            })
    return raw


def mmss_to_ms(mmss: str) -> int:
    m = re.match(r"(\d+):(\d+)", mmss.strip())
    if not m:
        return 0
    return (int(m.group(1)) * 60 + int(m.group(2))) * 1000


def snap_to_segment(ms: int, segments: list[dict]) -> int:
    """The model can only echo a line's own [MM:SS] tag back, but do the
    nearest-real-timestamp snap here anyway rather than trust its arithmetic
    — grounds every concept to an actual segment instead of a value the
    model computed itself."""
    if not segments:
        return ms
    return min((s["start_ms"] for s in segments), key=lambda t: abs(t - ms))


MERGE_SYSTEM = """You are given concept mentions extracted separately from each lecture in a course, in lecture order. Some concepts repeat across lectures under different wording — merge those into ONE canonical concept rather than keeping near-duplicates separate. Most mentions are genuinely distinct and should stay their own concept.

Return strict JSON:
{"concepts": [{"canonical_label": "short plain-English name, Title Case, space-separated words — never snake_case or underscores", "definition": "clearest one-sentence definition", "member_indices": [0, 3, 7]}]}

member_indices refers to the 0-based position of each raw mention in the input "mentions" list. Every input mention must appear in exactly one concept's member_indices."""


LINK_SYSTEM = """You are given every concept taught in a course, in the order each was introduced, one lecture at a time. For each concept, you're also given "earlier_candidates" — every concept introduced strictly before it, which are the ONLY valid choices for a prerequisite.

For each concept, decide which 0-3 of its earlier_candidates are genuine direct prerequisites — things a student really needs before this concept makes sense. Don't be shy about candidates from an earlier lecture; that's often exactly where the real dependency is (e.g. matrix multiplication genuinely depends on how matrices were first defined, LU factorization genuinely depends on the elimination steps and pivots that came before it). Skip a concept entirely if none of its candidates are real prerequisites.

Return strict JSON:
{"edges": [{"from": "concept id", "to": "prerequisite concept id, must be one of that concept's earlier_candidates"}]}"""


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def merge_course(course_id: str, mentions: list[dict], lecture_titles: dict[str, str]) -> list[dict]:
    """One call across the whole course — cheap at fixture scale (4 lectures,
    a few dozen raw mentions) and the only way a merge call can see every
    lecture's concepts at once to de-duplicate across them."""
    seq_by_lecture = {m["lecture_id"]: m["sequence"] for m in mentions}
    payload = {
        "lectures": [
            {"lecture_id": lid, "sequence": seq_by_lecture.get(lid), "title": title}
            for lid, title in lecture_titles.items()
        ],
        "mentions": [
            {"i": i, "lecture_id": m["lecture_id"], "lecture_sequence": m["sequence"], "label": m["label"], "definition": m["definition"]}
            for i, m in enumerate(mentions)
        ],
    }
    result = call_nano(MERGE_SYSTEM, json.dumps(payload, indent=2), reasoning_effort="low", max_completion_tokens=8000, timeout=90)

    concepts: list[dict] = []
    used_ids: set[str] = set()
    for c in result.get("concepts", []):
        members = [mentions[i] for i in c.get("member_indices", []) if 0 <= i < len(mentions)]
        if not members:
            continue
        members.sort(key=lambda m: (m["sequence"], m["timestamp_ms"]))
        introduced = members[0]

        # Concept ids are a shared PRIMARY KEY across every course, and the
        # AGE graph is one shared physical structure (course_graph), not one
        # per course — course isolation depends entirely on ids never
        # colliding. Course-namespacing them here is what actually
        # guarantees that: two courses that both teach something called
        # "Gaussian Elimination" would otherwise slugify to the identical
        # c_gaussian_elimination and either crash this course's build on a
        # primary-key violation, or (in AGE specifically, since its MERGE
        # matches by id alone) silently repurpose the other course's
        # existing graph node. Invisible with one course in the system;
        # live the moment a second one exists.
        base_id = f"c_{slugify(course_id)}_{slugify(c['canonical_label'])}"
        cid = base_id
        n = 2
        while cid in used_ids:
            cid = f"{base_id}_{n}"
            n += 1
        used_ids.add(cid)

        revisits = []
        seen_lectures = {introduced["lecture_id"]}
        for m in members[1:]:
            if m["lecture_id"] not in seen_lectures:
                revisits.append(m)
                seen_lectures.add(m["lecture_id"])

        concepts.append({
            "id": cid,
            "label": c["canonical_label"],
            "definition": c.get("definition", ""),
            "introduced_in": introduced["lecture_id"],
            "introduced_ms": introduced["timestamp_ms"],
            "introduced_order": (introduced["sequence"], introduced["timestamp_ms"]),
            "revisited_in": [{"lecture_id": m["lecture_id"], "timestamp_ms": m["timestamp_ms"]} for m in revisits],
        })
    return concepts


def link_edges(concepts: list[dict]) -> list[dict]:
    """Separate call from merge_course on purpose: cramming clustering and
    edge proposal into one JSON response made the model inconsistent (it
    proposed edges referencing labels its own "concepts" list never
    defined, and once truncated the concept list to 5 out of 26 mentions
    with no hard token-limit signal — found by logging raw dropped edges).
    This version references concepts by their already-final id (assigned in
    merge_course) instead of a label the model has to retype consistently,
    and each concept is offered only its own valid earlier_candidates, which
    makes a forward-pointing edge something the model has to actively
    ignore instructions to produce rather than something a wrong guess can
    slip through as. G2: 'an edge pointing forward in time is a bug' —
    still defensively re-checked below regardless.

    One call per lecture (not one call for the whole course): a single
    24-concept flat list left the last lecture's concepts with zero edges
    every time, despite having the most candidates available — the model
    reliably thinned out toward the end of one large list. Batching by
    lecture gives each lecture's concepts an undiluted call of their own."""
    ordered = sorted(concepts, key=lambda c: c["introduced_order"])
    order_by_id = {c["id"]: c["introduced_order"] for c in concepts}
    id_set = set(order_by_id)

    lectures_seen: list[str] = []
    for c in ordered:
        if c["introduced_in"] not in lectures_seen:
            lectures_seen.append(c["introduced_in"])

    edges: list[dict] = []
    dropped = 0
    for lec_id in lectures_seen:
        subjects = [c for c in ordered if c["introduced_in"] == lec_id]
        payload = [
            {
                "id": c["id"],
                "label": c["label"],
                "definition": c["definition"],
                "earlier_candidates": [
                    {"id": e["id"], "label": e["label"]} for e in ordered if e["introduced_order"] < c["introduced_order"]
                ],
            }
            for c in subjects
        ]
        payload = [p for p in payload if p["earlier_candidates"]]
        if not payload:
            continue  # first lecture — nothing can have a prerequisite yet
        if os.environ.get("BUILD_GRAPH_DEBUG"):
            print(f"  linking {len(payload)} concept(s) introduced in {lec_id}...")
        result = call_nano(LINK_SYSTEM, json.dumps(payload, indent=2), reasoning_effort="low", max_completion_tokens=8000, timeout=90)

        for e in result.get("edges", []):
            from_id, to_id = e.get("from"), e.get("to")
            if from_id not in id_set or to_id not in id_set or from_id == to_id:
                dropped += 1
                if os.environ.get("BUILD_GRAPH_DEBUG"):
                    print(f"  dropped (unresolved/self-loop): {from_id!r} -> {to_id!r}")
                continue
            if order_by_id[to_id] >= order_by_id[from_id]:
                # "to" isn't strictly earlier than "from" — would be a forward
                # (or same-instant) edge. Reject rather than guess.
                dropped += 1
                if os.environ.get("BUILD_GRAPH_DEBUG"):
                    print(f"  dropped (forward/same-time): {from_id!r}{order_by_id[from_id]} -> {to_id!r}{order_by_id[to_id]}")
                continue
            edges.append({"from": from_id, "to": to_id})

    if dropped:
        print(f"link: dropped {dropped} invalid/forward-pointing candidate edge(s)")
    return edges


def cypher_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def write_graph(conn, course_id: str, concepts: list[dict], edges: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM concepts WHERE course_id = %s", (course_id,))
        for c in concepts:
            cur.execute(
                """
                INSERT INTO concepts (id, course_id, label, definition, introduced_in, introduced_ms)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (c["id"], course_id, c["label"], c["definition"], c["introduced_in"], c["introduced_ms"]),
            )

        cur.execute("SET search_path = ag_catalog, \"$user\", public")
        cur.execute(
            f"SELECT * FROM cypher('course_graph', $$ MATCH (c:Concept {{course_id: {cypher_str(course_id)}}}) DETACH DELETE c $$) AS (r agtype)"
        )
        for c in concepts:
            cur.execute(
                f"""SELECT * FROM cypher('course_graph', $$
                    MERGE (c:Concept {{id: {cypher_str(c['id'])}}})
                    SET c.label = {cypher_str(c['label'])}, c.course_id = {cypher_str(course_id)}
                $$) AS (r agtype)"""
            )
            cur.execute(
                f"""SELECT * FROM cypher('course_graph', $$
                    MERGE (l:Lecture {{id: {cypher_str(c['introduced_in'])}}})
                    WITH l
                    MATCH (c:Concept {{id: {cypher_str(c['id'])}}})
                    MERGE (c)-[r:INTRODUCED_IN]->(l)
                    SET r.timestamp_ms = {int(c['introduced_ms'])}
                $$) AS (r agtype)"""
            )
            for rev in c["revisited_in"]:
                cur.execute(
                    f"""SELECT * FROM cypher('course_graph', $$
                        MERGE (l:Lecture {{id: {cypher_str(rev['lecture_id'])}}})
                        WITH l
                        MATCH (c:Concept {{id: {cypher_str(c['id'])}}})
                        MERGE (c)-[r:REVISITED_IN]->(l)
                        SET r.timestamp_ms = {int(rev['timestamp_ms'])}
                    $$) AS (r agtype)"""
                )
        for e in edges:
            cur.execute(
                f"""SELECT * FROM cypher('course_graph', $$
                    MATCH (a:Concept {{id: {cypher_str(e['from'])}}}), (b:Concept {{id: {cypher_str(e['to'])}}})
                    MERGE (a)-[:DEPENDS_ON]->(b)
                $$) AS (r agtype)"""
            )
        cur.execute("SET search_path = \"$user\", public")
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course-id", default="18.06")
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, title, sequence FROM lectures WHERE course_id = %s ORDER BY sequence", (args.course_id,))
        lectures = cur.fetchall()
        if not lectures:
            raise SystemExit(f"no lectures found for course {args.course_id}")

        mentions: list[dict] = []
        for lec in lectures:
            cur.execute("SELECT start_ms, text FROM segments WHERE lecture_id = %s ORDER BY start_ms", (lec["id"],))
            segments = cur.fetchall()
            raw = map_lecture(segments)
            print(f"{lec['id']}: {len(raw)} raw concept mentions")
            for m in raw:
                mentions.append({**m, "lecture_id": lec["id"], "sequence": lec["sequence"]})

    print(f"merging {len(mentions)} raw mentions across {len(lectures)} lectures...")
    lecture_titles = {lec["id"]: lec["title"] for lec in lectures}
    concepts = merge_course(args.course_id, mentions, lecture_titles)
    print(f"merged to {len(concepts)} concepts")

    edges = link_edges(concepts)
    print(f"linked {len(edges)} DEPENDS_ON edges")

    write_graph(conn, args.course_id, concepts, edges)
    print(f"wrote graph for course {args.course_id}")
    conn.close()


if __name__ == "__main__":
    main()
