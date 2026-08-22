# apache/age ships Apache AGE but not pgvector (confirmed during F2 research —
# no combined official image exists). Layer pgvector on top ourselves.
# PG16_latest doesn't exist on Docker Hub (checked during F1) — the real stable
# PG16 tag is release_PG16_1.6.0.
FROM apache/age:release_PG16_1.6.0

# The base image already has PGDG's apt repo configured (that's where its own
# postgresql-16 package comes from), and PGDG publishes a prebuilt pgvector
# package — so install it directly instead of compiling from source (which hit
# an SSL CA trust issue cloning over git in this environment).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
