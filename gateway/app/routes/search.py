import time
from typing import Literal

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.config import OPENAI_API_KEY, OPENAI_MODEL_EMBED
from app.queries import load

router = APIRouter()

OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings"

LANE_TO_SOURCE = {"spoken": "transcript", "written": "board", "both": None}


class SearchRequest(BaseModel):
    query: str
    lane: Literal["spoken", "written", "both"] = "both"
    course_id: str
    lecture_id: str | None = None
    limit: int = 10


class SearchResult(BaseModel):
    lecture_id: str
    lecture_title: str
    timestamp_ms: int
    snippet: str
    score: float
    source: Literal["transcript", "board"]
    spoken_elsewhere: bool | None
    frame_id: str | None


class SearchResponse(BaseModel):
    results: list[SearchResult]
    took_ms: int


async def embed_query(query: str) -> list[float]:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            OPENAI_EMBED_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": OPENAI_MODEL_EMBED, "input": [query]},
            timeout=10,
        )
    response.raise_for_status()
    return response.json()["data"][0]["embedding"]


@router.post("/search")
async def search(request: Request, body: SearchRequest) -> SearchResponse:
    started = time.monotonic()
    embedding = await embed_query(body.query)
    source = LANE_TO_SOURCE[body.lane]

    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            load("search.sql"),
            str(embedding),
            body.course_id,
            body.lecture_id,
            source,
            body.limit,
        )

    results = [
        SearchResult(
            lecture_id=row["lecture_id"],
            lecture_title=row["lecture_title"],
            timestamp_ms=row["timestamp_ms"],
            snippet=row["snippet"],
            score=row["score"],
            source=row["source"],
            spoken_elsewhere=row["spoken_elsewhere"],
            frame_id=row["frame_id"],
        )
        for row in rows
    ]
    took_ms = round((time.monotonic() - started) * 1000)
    return SearchResponse(results=results, took_ms=took_ms)
