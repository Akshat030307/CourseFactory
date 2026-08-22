-- No "rejected" state in the schema — a rejected question is just wrong
-- and gone, not something worth re-surfacing later. Deleting is the honest
-- action; attempts/schedule cascade (ON DELETE CASCADE) but none should
-- exist yet for a question that was never approved.
DELETE FROM questions WHERE id = $1;
