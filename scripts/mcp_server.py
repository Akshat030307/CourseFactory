"""Stage 8 — Distribution (D1). MCP server exposing the course brain to
Claude Desktop / Cursor / any MCP client, over stdio.

    python scripts/mcp_server.py

**Not a RocketRide node.** docs/API.md's original draft said these tools
are "exposed via RocketRide's MCP surface" — checked the actual synced
catalog (.rocketride/schema/mcp_client.json) before building on that claim,
same as every other RocketRide assumption this project has verified. The
only MCP-related node RocketRide has is `mcp_client` — it lets a *pipeline*
consume an *external* MCP server's tools. There is no node for the reverse
direction (exposing a pipeline as an MCP server), so there is no RocketRide
path to this ticket at all. Built with the official `mcp` Python SDK
instead, talking to the gateway's already-built, already-tested REST API —
consistent with every other stage's "direct call over an unverified
RocketRide path" choice.

Per docs/PIPELINES.md's P5: three of four tools are pure reads (gateway
HTTP, no LLM); only `explain_concept` generates.
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from mcp.server.mcpserver import MCPServer

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8000")
PUBLIC_HOST = os.environ.get("PUBLIC_HOST", "http://localhost:5173")
# Stage 13: the gateway now requires auth on every route (VPS deployment —
# see gateway/app/auth_middleware.py). This runs as a local subprocess
# Claude Desktop spawns, with no login flow of its own — it authenticates
# with the static service key instead, same as scripts/telegram_bot.py.
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "")
GATEWAY_HEADERS = {"Authorization": f"Bearer {SERVICE_API_KEY}"}
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
# llama-3.3-70b-versatile 404s as of this build (checked Groq's live
# /models list — see .env.example) — openai/gpt-oss-120b is current.
GROQ_MODEL_SMART = os.environ.get("GROQ_MODEL_SMART", "openai/gpt-oss-120b")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_SMALL = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

server = MCPServer(name="course-factory")


def deep_link(lecture_id: str, timestamp_ms: int, lane: str = "both") -> str:
    return f"{PUBLIC_HOST}/lecture/{lecture_id}?t={timestamp_ms}&lane={lane}"


def format_ts(ms: int) -> str:
    total_s = ms // 1000
    return f"{total_s // 60}:{total_s % 60:02d}"


async def _find_concept(course_id: str, name: str) -> dict | None:
    """Resolve a natural-language concept name to a graph node. The graph
    is tiny (a course-scale fixture, not a search index), so a case-
    insensitive substring match against the already-fetched node list is
    simpler and just as correct as adding a dedicated lookup endpoint to
    the gateway for MCP's sole benefit."""
    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        r = await client.get(f"{GATEWAY_URL}/api/v1/courses/{course_id}/graph")
        r.raise_for_status()
        graph = r.json()
    needle = name.strip().lower()
    for node in graph["nodes"]:
        if node["label"].strip().lower() == needle:
            return {**node, "_graph": graph}
    for node in graph["nodes"]:
        if needle in node["label"].strip().lower():
            return {**node, "_graph": graph}
    return None


@server.tool()
async def search_course(query: str, course_id: str, lane: str = "both") -> str:
    """Search a course's lectures for spoken or written content. `lane` is
    "spoken", "written", or "both" — "written" finds board content that
    was never said aloud, the thing no transcript-only search engine can
    do. Returns ranked moments with a deep link to each."""
    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        r = await client.post(
            f"{GATEWAY_URL}/api/v1/search",
            json={"query": query, "lane": lane, "course_id": course_id, "limit": 5},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()

    if not data["results"]:
        return f'No results for "{query}" in course {course_id}.'

    lines = []
    for res in data["results"]:
        never_spoken = " (written but never said aloud)" if res.get("spoken_elsewhere") is False else ""
        lines.append(
            f"- {res['lecture_title']} @ {format_ts(res['timestamp_ms'])}{never_spoken}: {res['snippet']}\n"
            f"  {deep_link(res['lecture_id'], res['timestamp_ms'], lane=res['source'])}"
        )
    return "\n".join(lines)


@server.tool()
async def explain_concept(concept: str, course_id: str) -> str:
    """Explain a concept from the course, grounded in how this specific
    course actually taught it, and say where it was introduced."""
    node = await _find_concept(course_id, concept)
    if node is None:
        return f'No concept matching "{concept}" found in course {course_id}.'

    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        r = await client.get(f"{GATEWAY_URL}/api/v1/concepts/{node['id']}", timeout=15)
        r.raise_for_status()
        detail = r.json()

    prompt = (
        f"Concept: {detail['label']}\n"
        f"Definition (from the course): {detail['definition']}\n\n"
        "Explain this concept clearly in 2-4 sentences, suitable for a student who just heard the term "
        "and wants to understand it, not just recall it."
    )
    explanation = await _generate(prompt)

    link = deep_link(detail["introduced_in"], detail["introduced_ms"])
    return f"{explanation}\n\nIntroduced in {detail['introduced_lecture_title']} at {format_ts(detail['introduced_ms'])}.\n{link}"


@server.tool()
async def find_prerequisite(concept: str, course_id: str) -> str:
    """List the direct prerequisites of a concept — what a student needs
    to understand first, per the course's own dependency graph."""
    node = await _find_concept(course_id, concept)
    if node is None:
        return f'No concept matching "{concept}" found in course {course_id}.'

    graph = node["_graph"]
    prereq_ids = {e["to"] for e in graph["edges"] if e["from"] == node["id"]}
    if not prereq_ids:
        return f"{node['label']} has no recorded prerequisites in this course — it's foundational."

    by_id = {n["id"]: n for n in graph["nodes"]}
    lines = [f"{node['label']} depends on:"]
    for pid in prereq_ids:
        p = by_id.get(pid)
        if p is None:
            continue
        lines.append(f"- {p['label']}: {deep_link(p['lecture_id'], p['timestamp_ms'])}")
    return "\n".join(lines)


@server.tool()
async def get_moment(lecture_id: str, timestamp_ms: int) -> str:
    """Get the transcript and board text around a specific moment in a
    lecture."""
    window_ms = 20_000
    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        seg_r, frame_r = await client.get(
            f"{GATEWAY_URL}/api/v1/lectures/{lecture_id}/segments",
            params={"from_ms": max(0, timestamp_ms - window_ms), "to_ms": timestamp_ms + window_ms},
            timeout=15,
        ), await client.get(
            f"{GATEWAY_URL}/api/v1/lectures/{lecture_id}/frames",
            params={"from_ms": max(0, timestamp_ms - window_ms), "to_ms": timestamp_ms + window_ms},
            timeout=15,
        )
        seg_r.raise_for_status()
        frame_r.raise_for_status()

    segments = seg_r.json()
    frames = frame_r.json()

    lines = [f"Moment: {deep_link(lecture_id, timestamp_ms)}", ""]
    if segments:
        lines.append("Spoken:")
        lines.extend(f"[{format_ts(s['start_ms'])}] {s['text']}" for s in segments)
    if frames:
        lines.append("")
        lines.append("Board:")
        for f in frames:
            text = f.get("vision_description") or f.get("ocr_text")
            if text:
                lines.append(f"[{format_ts(f['timestamp_ms'])}] {text}")
    if not segments and not frames:
        lines.append("Nothing recorded in this window.")
    return "\n".join(lines)


async def _generate(prompt: str) -> str:
    """Groq first (cost rule: try Groq for anything model-shaped — this is
    a short completion, not the long-context case that sends build_graph.py
    / generate_questions.py straight to nano), one retry then OpenAI nano
    fallback on 429 — same shape as ingest.py's vision_describe()."""
    try:
        return await _call_chat(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_SMART, prompt)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 429:
            raise
        try:
            return await _call_chat(GROQ_CHAT_URL, GROQ_API_KEY, GROQ_MODEL_SMART, prompt)
        except httpx.HTTPStatusError as e2:
            if e2.response.status_code != 429 or not OPENAI_API_KEY:
                raise
            return await _call_chat(OPENAI_CHAT_URL, OPENAI_API_KEY, OPENAI_MODEL_SMALL, prompt, reasoning_effort="low")


async def _call_chat(url: str, api_key: str, model: str, prompt: str, reasoning_effort: str | None = None) -> str:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}]}
    if reasoning_effort:
        # gpt-5-nano is a reasoning model — without this it can burn its
        # whole token budget on invisible reasoning tokens before emitting
        # any visible content (found the hard way building build_graph.py).
        body["reasoning_effort"] = reasoning_effort
        body["max_completion_tokens"] = 1000
    # Not a gateway call (Groq/OpenAI directly) — GATEWAY_HEADERS's bearer
    # token has no business here, unlike the other four AsyncClient uses in
    # this file. Its own Authorization header below is the real one.
    async with httpx.AsyncClient() as client:
        r = await client.post(url, headers={"Authorization": f"Bearer {api_key}"}, json=body, timeout=30)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()


if __name__ == "__main__":
    server.run(transport="stdio")
