"""AGE Cypher lives here per CLAUDE.md rule 3 — the graph owns edges
(DEPENDS_ON, INTRODUCED_IN, REVISITED_IN); node data (labels, definitions,
mastery) is a relational mirror in the `concepts` table, queried with plain
SQL from db/queries/*.sql (see routes/graph.py). Pool connections already
carry ag_catalog on their search_path — see db.py's pool setup — so cypher()
is callable directly without a per-query SET.

AGE has no bind-parameter support inside a cypher() call's dollar-quoted
body — values have to be interpolated into the Cypher string itself, hence
_cypher_str's escaping. This is safe here because every value that reaches
it is our own generated data (course/lecture/concept ids, LLM-authored
labels), not raw user input.
"""

import json


def _agtype(value: str) -> object:
    """asyncpg returns agtype scalars as their raw text form — JSON-quoted
    for a string property (e.g. '"c_lu"'), bare for a number. json.loads
    unwraps either."""
    return json.loads(value)


def _cypher_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _cypher_str_list(ids: list[str]) -> str:
    return "[" + ", ".join(_cypher_str(i) for i in ids) + "]"


async def get_edges_for_course(conn, course_id: str) -> list[dict]:
    """Every DEPENDS_ON edge among this course's concepts."""
    rows = await conn.fetch(
        f"""SELECT * FROM cypher('course_graph', $$
            MATCH (a:Concept {{course_id: {_cypher_str(course_id)}}})-[:DEPENDS_ON]->(b:Concept)
            RETURN a.id, b.id
        $$) AS (from_id agtype, to_id agtype)"""
    )
    return [{"from": _agtype(r["from_id"]), "to": _agtype(r["to_id"]), "type": "DEPENDS_ON"} for r in rows]


async def get_one_hop_neighbor_ids(conn, ids: list[str]) -> set[str]:
    """Concepts directly connected to any of `ids` via DEPENDS_ON in either
    direction — used to build a lecture's collapsed cluster (its own
    concepts plus one hop out), per API.md's `?lecture_id=` contract."""
    if not ids:
        return set()
    rows = await conn.fetch(
        f"""SELECT * FROM cypher('course_graph', $$
            MATCH (c:Concept)-[:DEPENDS_ON]-(n:Concept)
            WHERE c.id IN {_cypher_str_list(ids)}
            RETURN DISTINCT n.id
        $$) AS (id agtype)"""
    )
    return {_agtype(r["id"]) for r in rows}


async def get_edges_among(conn, ids: list[str]) -> list[dict]:
    """DEPENDS_ON edges where both endpoints are in `ids` — the edge set for
    a collapsed lecture cluster once its node set (cluster + one hop) is
    known."""
    if not ids:
        return []
    id_list = _cypher_str_list(ids)
    rows = await conn.fetch(
        f"""SELECT * FROM cypher('course_graph', $$
            MATCH (a:Concept)-[:DEPENDS_ON]->(b:Concept)
            WHERE a.id IN {id_list} AND b.id IN {id_list}
            RETURN a.id, b.id
        $$) AS (from_id agtype, to_id agtype)"""
    )
    return [{"from": _agtype(r["from_id"]), "to": _agtype(r["to_id"]), "type": "DEPENDS_ON"} for r in rows]


async def get_backward_prerequisites(conn, concept_id: str, max_depth: int = 3) -> list[dict]:
    """Every concept reachable by walking DEPENDS_ON backward from
    `concept_id`, up to `max_depth` hops — the candidate pool for R1's
    remediation query. Multiple paths can reach the same candidate at
    different lengths (diamond dependencies); returns the minimum hop
    count per candidate, sorted shallowest-first, since R1 wants the
    nearest eligible prerequisite, not just any reachable one."""
    rows = await conn.fetch(
        f"""SELECT * FROM cypher('course_graph', $$
            MATCH path = (start:Concept {{id: {_cypher_str(concept_id)}}})-[:DEPENDS_ON*1..{max_depth}]->(candidate:Concept)
            RETURN candidate.id, length(path)
        $$) AS (id agtype, hops agtype)"""
    )
    best: dict[str, int] = {}
    for r in rows:
        cid, hops = _agtype(r["id"]), _agtype(r["hops"])
        if cid not in best or hops < best[cid]:
            best[cid] = hops
    return sorted(({"id": cid, "hops": hops} for cid, hops in best.items()), key=lambda c: c["hops"])


async def get_revisited_in(conn, concept_id: str) -> list[dict]:
    rows = await conn.fetch(
        f"""SELECT * FROM cypher('course_graph', $$
            MATCH (c:Concept {{id: {_cypher_str(concept_id)}}})-[r:REVISITED_IN]->(l:Lecture)
            RETURN l.id, r.timestamp_ms
        $$) AS (lecture_id agtype, timestamp_ms agtype)"""
    )
    return [{"lecture_id": _agtype(r["lecture_id"]), "timestamp_ms": _agtype(r["timestamp_ms"])} for r in rows]
