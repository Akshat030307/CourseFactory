from functools import lru_cache
from pathlib import Path

QUERIES_DIR = Path(__file__).resolve().parents[2] / "db" / "queries"


@lru_cache
def load(name: str) -> str:
    return (QUERIES_DIR / name).read_text()
