# Built from the repo root (docker-compose.prod.yml: `context: ., dockerfile: deploy/web.Dockerfile`).
# Two stages: build the SPA with Node, then hand the built dist/ straight to
# Caddy — no separate static-file container, Caddy serves it directly (see
# deploy/Caddyfile).
FROM node:20-slim AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
