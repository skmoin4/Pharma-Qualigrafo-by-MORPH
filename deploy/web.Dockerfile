# Qualigrafo web client + HTTPS reverse proxy (Phase 3 / P2): the built React client served by Caddy, which also
# terminates TLS and forwards /api to the API container. Build context: repository root
#   docker build -f deploy/web.Dockerfile -t qualigrafo-web .
FROM node:24-bookworm-slim AS build
WORKDIR /web
COPY qualigrafo/package.json qualigrafo/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY qualigrafo/ ./
RUN npm run build

FROM caddy:2.10-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/caddy/tls /etc/caddy/tls
COPY --from=build /web/dist /srv
