from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.config import DEMO_STUDENT_ID
from app.graph_queries import get_backward_prerequisites, get_revisited_in
from app.queries import load

router = APIRouter()

# "Demonstrated mastery" cutoff — mastery.score is 0..1 (see db/schema.sql).
# No row at all (never attempted) also counts as not-yet-demonstrated.
MASTERY_THRESHOLD = 0.6

# No signal anywhere in the schema for "how long should this remediation
# clip run" — a flat heuristic, not derived from board-state boundaries or
# segment lengths. Matches docs/API.md's own example value exactly; a real
# "watch until the topic changes" detector is more than this ticket needs.
DURATION_HINT_MS = 90_000


class RemediationConcept(BaseModel):
    id: str
    label: str


class RemediationTarget(BaseModel):
    lecture_id: str
    lecture_title: str
    timestamp_ms: int
    duration_hint_ms: int


class RemediationResponse(BaseModel):
    found: bool
    concept: RemediationConcept | None = None
    target: RemediationTarget | None = None
    hops: int | None = None
    reason: str | None = None


async def compute_remediation(conn, question_id: str, student_id: str) -> RemediationResponse | None:
    """None means "no such question" (caller decides how to surface that —
    a 404 for the standalone endpoint, silently for POST /attempts where a
    bad question_id already 404'd earlier in that handler). Shared by
    GET /remediation and POST /attempts (docs/API.md: a wrong answer's
    response embeds this same shape) so the two never drift apart."""
    ctx = await conn.fetchrow(load("remediation_question_context.sql"), question_id)
    if ctx is None:
        return None
    if ctx["concept_id"] is None:
        return RemediationResponse(found=False)

    concept_id = ctx["concept_id"]
    concept_label = ctx["concept_label"]
    current_sequence = ctx["lecture_sequence"]

    candidates = await get_backward_prerequisites(conn, concept_id, max_depth=3)
    if candidates:
        rows = await conn.fetch(load("remediation_candidates.sql"), [c["id"] for c in candidates], student_id)
        by_id = {r["id"]: r for r in rows}
        hops_by_id = {c["id"]: c["hops"] for c in candidates}

        eligible: list[tuple[int, object]] = []
        for c in candidates:
            row = by_id.get(c["id"])
            if row is None:
                continue
            earlier = row["lecture_sequence"] < current_sequence
            unmastered = row["mastery"] is None or row["mastery"] < MASTERY_THRESHOLD
            if earlier and unmastered:
                eligible.append((hops_by_id[c["id"]], row))

        if eligible:
            # Among the shallowest hop level with any eligible candidate,
            # prefer the earliest lecture — fix the most foundational gap
            # first, not a downstream symptom of it. This tiebreak matters:
            # found while testing that LU Factorization has two direct
            # 1-hop prerequisites (Gaussian Elimination, l02, and Matrix
            # Multiplication, l03) — which one "won" depended on whatever
            # arbitrary order AGE happened to return rows in, not anything
            # meaningful, and wasn't reproducible run-to-run.
            min_hops = min(h for h, _ in eligible)
            hops, row = min((he for he in eligible if he[0] == min_hops), key=lambda he: he[1]["lecture_sequence"])
            return RemediationResponse(
                found=True,
                concept=RemediationConcept(id=concept_id, label=concept_label),
                target=RemediationTarget(
                    lecture_id=row["lecture_id"],
                    lecture_title=row["lecture_title"],
                    timestamp_ms=row["timestamp_ms"],
                    duration_hint_ms=DURATION_HINT_MS,
                ),
                hops=hops,
                reason=f"{concept_label} builds on {row['label']}, which you haven't shown mastery of yet.",
            )

    # No prerequisite gap within 3 hops — fall back to another moment the
    # same concept was covered, per docs/ARCHITECTURE.md.
    revisits = await get_revisited_in(conn, concept_id)
    if revisits:
        revisit = revisits[0]
        title_row = await conn.fetchrow(load("lecture_title.sql"), revisit["lecture_id"])
        return RemediationResponse(
            found=True,
            concept=RemediationConcept(id=concept_id, label=concept_label),
            target=RemediationTarget(
                lecture_id=revisit["lecture_id"],
                lecture_title=title_row["title"] if title_row else revisit["lecture_id"],
                timestamp_ms=revisit["timestamp_ms"],
                duration_hint_ms=DURATION_HINT_MS,
            ),
            hops=0,
            reason=f"Here's another moment where {concept_label} came up — it might help to go over it again.",
        )

    return RemediationResponse(found=False)


@router.get("/remediation")
async def get_remediation(request: Request, question_id: str, student_id: str = DEMO_STUDENT_ID) -> RemediationResponse:
    """The differentiator (docs/ARCHITECTURE.md): given a failed question,
    walk DEPENDS_ON backward breadth-first (depth cap 3) for the nearest
    prerequisite introduced in an earlier lecture that the student hasn't
    shown mastery of. Falls back to REVISITED_IN on the concept itself if
    nothing qualifies. Pure graph traversal — no LLM, no RocketRide."""
    async with request.app.state.pool.acquire() as conn:
        result = await compute_remediation(conn, question_id, student_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No question with id {question_id!r}.")
    return result
