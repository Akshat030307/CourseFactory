SELECT kind, lang, path FROM tracks WHERE lecture_id = $1 ORDER BY kind, lang;
