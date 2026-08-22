UPDATE questions SET approved = true, approved_by = $2, approved_at = now() WHERE id = $1;
