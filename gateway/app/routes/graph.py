from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.auth import resolve_student_id
from app.graph_queries import (
    get_edges_among,
    get_edges_for_course,
    get_one_hop_neighbor_ids,
    get_revisited_in,
)
from app.queries import load

router = APIRouter()


class GraphNode(BaseModel):
    id: str
    label: str
    lecture_id: str
    timestamp_ms: int
    mastery: float | None


class GraphEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    type: str


class Graph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class Revisit(BaseModel):
    lecture_id: str
    timestamp_ms: int


class RelatedQuestion(BaseModel):
    id: str
    prompt: str
    source_timestamp_ms: int


class ConceptDetail(BaseModel):
    id: str
    label: str
    definition: str | None
    introduced_in: str
    introduced_lecture_title: str
    introduced_ms: int
    revisited_in: list[Revisit]
    related_questions: list[RelatedQuestion]


@router.get("/courses/{course_id}/graph")
async def get_course_graph(
    request: Request, course_id: str, lecture_id: str | None = None, student_id: str | None = None
) -> Graph:
    """Full course graph, or — with ?lecture_id= — that lecture's own
    concepts plus their one-hop neighbors, for collapsed rendering (G3/G4)."""
    effective_student_id = resolve_student_id(request.state.identity, student_id)
    async with request.app.state.pool.acquire() as conn:
        if lecture_id is None:
            node_rows = await conn.fetch(load("graph_nodes.sql"), course_id, effective_student_id, None)
            edges = await get_edges_for_course(conn, course_id)
        else:
            base_rows = await conn.fetch(load("graph_nodes_by_lecture.sql"), course_id, lecture_id)
            base_ids = [r["id"] for r in base_rows]
            neighbor_ids = await get_one_hop_neighbor_ids(conn, base_ids)
            all_ids = list({*base_ids, *neighbor_ids})
            node_rows = await conn.fetch(load("graph_nodes.sql"), course_id, effective_student_id, all_ids)
            edges = await get_edges_among(conn, all_ids)

    nodes = [GraphNode(**dict(row)) for row in node_rows]
    return Graph(nodes=nodes, edges=[GraphEdge(**e) for e in edges])


@router.get("/concepts/{concept_id}")
async def get_concept(request: Request, concept_id: str) -> ConceptDetail:
    async with request.app.state.pool.acquire() as conn:
        row = await conn.fetchrow(load("concept.sql"), concept_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"No concept with id {concept_id!r}.")
        revisits = await get_revisited_in(conn, concept_id)
        question_rows = await conn.fetch(load("concept_questions.sql"), concept_id)

    return ConceptDetail(
        id=row["id"],
        label=row["label"],
        definition=row["definition"],
        introduced_in=row["lecture_id"],
        introduced_lecture_title=row["lecture_title"],
        introduced_ms=row["timestamp_ms"],
        revisited_in=[Revisit(**r) for r in revisits],
        related_questions=[RelatedQuestion(**dict(r)) for r in question_rows],
    )
