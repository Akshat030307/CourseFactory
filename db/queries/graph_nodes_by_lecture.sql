-- The base set for GET /courses/{id}/graph?lecture_id= — concepts introduced
-- in that lecture. graph_queries.py then asks AGE for their one-hop
-- neighbors and re-runs graph_nodes.sql with the combined id list.
SELECT id FROM concepts WHERE course_id = $1 AND introduced_in = $2;
