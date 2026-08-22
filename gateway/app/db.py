import json
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from app.config import DATABASE_URL


async def _setup_connection(conn: asyncpg.Connection) -> None:
    # Runs once per pooled connection, not per query — avoids leaving
    # search_path altered mid-pool-lifetime for whichever request happens to
    # reuse a connection after a graph query. ag_catalog first is required
    # for cypher() (see graph_queries.py) and is harmless for plain table
    # access since none of our app tables collide with AGE's internal ones —
    # same ordering db/schema.sql itself uses while running create_graph().
    await conn.execute("LOAD 'age'")
    await conn.execute('SET search_path = ag_catalog, "$user", public')

    # asyncpg doesn't decode json/jsonb on its own (confirmed directly —
    # questions.options came back as a raw str, not a list) — register once
    # per connection rather than json.loads-ing at every call site.
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(DATABASE_URL, setup=_setup_connection)
    try:
        yield
    finally:
        await app.state.pool.close()
