import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

POLL_INTERVAL_SECONDS = 0.5


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    pool = websocket.app.state.pool
    seq = 0
    subscriptions: dict[str, asyncio.Task] = {}

    async def send(type_: str, job_id: str, payload: dict) -> None:
        nonlocal seq
        seq += 1
        await websocket.send_json({"type": type_, "job_id": job_id, "seq": seq, "payload": payload})

    async def poll_job(job_id: str) -> None:
        # X5: node.*/cost.update stand-ins. This project never routes work
        # through a RocketRide pipeline (every stage found direct API calls
        # more reliable — see CLAUDE.md), so there's no real per-node
        # RocketRide execution to surface; docs/API.md anticipated exactly
        # this ("if it doesn't, the gateway emits equivalent events").
        # `message` (jobs.message) carries the node-level text, `cost_cents`
        # the running total — both already written by scripts/ingest.py.
        last_progress = (None, None, None)
        last_cost = None
        while True:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT status, stage, pct, message, error, cost_cents, lecture_id FROM jobs WHERE id = $1",
                    job_id,
                )
            if row is None:
                await send("job.failed", job_id, {"stage": None, "error": "job not found"})
                return
            if row["status"] == "failed":
                await send("job.failed", job_id, {"stage": row["stage"], "error": row["error"]})
                return
            if (row["stage"], row["pct"], row["message"]) != last_progress:
                last_progress = (row["stage"], row["pct"], row["message"])
                await send("job.progress", job_id, {"stage": row["stage"], "pct": row["pct"], "message": row["message"]})
            if row["cost_cents"] != last_cost:
                last_cost = row["cost_cents"]
                await send("cost.update", job_id, {"cents": row["cost_cents"]})
            if row["status"] == "done":
                await send("job.complete", job_id, {"lecture_id": row["lecture_id"]})
                return
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            job_id = msg.get("job_id") or (msg.get("payload") or {}).get("job_id")

            if msg_type == "subscribe" and job_id and job_id not in subscriptions:
                subscriptions[job_id] = asyncio.create_task(poll_job(job_id))
            elif msg_type == "cancel" and job_id:
                task = subscriptions.pop(job_id, None)
                if task:
                    task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        for task in subscriptions.values():
            task.cancel()
