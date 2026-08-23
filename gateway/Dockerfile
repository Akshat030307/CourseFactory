# Built from the repo root (docker-compose.prod.yml: `context: ., dockerfile: gateway/Dockerfile`),
# not from gateway/ itself — the gateway spawns scripts/ingest.py as a
# subprocess (gateway/app/routes/upload.py) and reads db/queries/*.sql at
# runtime (gateway/app/queries.py), so both need to exist as siblings of
# gateway/ inside the image, matching the same relative layout the app
# code already assumes on a bare-metal checkout.
#
# Also doubles as the image for the telegram-bot service in
# docker-compose.prod.yml (different `command:`, same image) — it needs a
# strict subset of what's installed here, and building a second image just
# to skip ffmpeg/tesseract isn't worth the extra Dockerfile to maintain at
# this scale.
FROM python:3.11-slim

# ffmpeg + tesseract: scripts/ingest.py's real dependencies (audio/frame
# extraction, OCR) — see CLAUDE.md rule 2, these are "local tools that just
# work," not something to reimplement or skip in the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY gateway/requirements.txt gateway/requirements.txt
COPY scripts/requirements.txt scripts/requirements.txt
RUN pip install --no-cache-dir -r gateway/requirements.txt -r scripts/requirements.txt

COPY gateway gateway
COPY db db
COPY scripts scripts

# Real mount points in production (docker-compose.prod.yml volumes) — created
# here so StaticFiles has somewhere to serve from even before the first
# upload, matching local dev's already-existing lectures/ and media/ dirs.
RUN mkdir -p lectures media

WORKDIR /app/gateway
EXPOSE 8000

# No --reload (that's a dev-only file-watcher, wrong in a container you
# redeploy by rebuilding) and no exposed port mapping here — only Caddy's
# compose service publishes to the host; the gateway is reached over the
# internal Docker network.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
