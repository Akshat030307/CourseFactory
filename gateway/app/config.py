import os

from dotenv import load_dotenv

load_dotenv()


DATABASE_URL: str = os.environ["DATABASE_URL"]
PUBLIC_HOST: str = os.environ.get("PUBLIC_HOST", "http://localhost:5173")
# One hardcoded student, one instructor — see CLAUDE.md "Things not to do".
DEMO_STUDENT_ID: str = os.environ.get("DEMO_STUDENT_ID", "s1")

OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_EMBED: str = os.environ.get("OPENAI_MODEL_EMBED", "text-embedding-3-small")
