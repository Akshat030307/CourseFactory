# Demo database backups (Z1)

Dump files (`*.sql`) are gitignored — they're generated state, not source, same
reasoning as `media/` and `lectures/*.mp4`. This README stays tracked.

## Taking a backup

```bash
docker exec course-factory-postgres-1 pg_dump -U coursefactory -d coursefactory \
  --no-owner --no-privileges > db/backups/demo_ready_$(date +%Y%m%d_%H%M%S).sql
```

Take one right before the demo, after all four fixtures are confirmed `ready`
(see the query in `docs/TASKS.md`'s Z1 entry).

## Restoring

```bash
docker exec course-factory-postgres-1 psql -U coursefactory -d postgres \
  -c "DROP DATABASE coursefactory;" \
  -c "CREATE DATABASE coursefactory;"
cat db/backups/demo_ready_<timestamp>.sql | \
  docker exec -i course-factory-postgres-1 psql -U coursefactory -d coursefactory
```

Verified real (not assumed): dumped the live demo DB, restored it into a
throwaway scratch database, and diffed row counts against the source —
`lectures`/`segments`/`frames`/`chunks`/`concepts`/`questions`/
`contradictions`/`tracks` all matched exactly, zero errors during restore.

## The one real gap: Apache AGE doesn't survive a plain restore

The relational tables restore perfectly. The graph (`course_graph`, built by
G1/G2) does not — confirmed by actually running a Cypher query against a
restored copy, not assumed:

```
ERROR:  graph with oid 17394 does not exist
```

Cause: AGE ties a graph's internal identity to its schema's Postgres OID at
`create_graph()` time. `ag_catalog.ag_graph.graphid` round-trips fine as
*data* through `pg_dump`/`psql` (still reads `17394` after restore), but
`CREATE SCHEMA course_graph` during restore gets a **new** OID from
Postgres's own counter — there's no way to pin it via plain SQL — so the two
no longer match and every Cypher query 404s, even though the underlying
`Concept`/`DEPENDS_ON`/etc. rows are sitting right there, byte-identical,
readable with plain `SELECT`.

**Recovery if this happens:** after restoring the SQL dump above, rebuild the
graph from the (now-restored) relational data:

```bash
python scripts/build_graph.py --course-id 18.06
```

This re-derives concepts/edges via `create_graph()` itself, so the OID
linkage is correct again. It re-calls OpenAI/Groq (13 concepts, a few cents,
~1-2 minutes) — cheap enough to eat mid-demo if it ever actually comes to
that, and cheaper than a remediation flow that silently 404s in front of a
judge. This has not been re-verified end-to-end against a restored database
(would mean spending real API calls against a throwaway copy just to prove
it) — flagging as a known, reasoned-through gap rather than a tested one.
