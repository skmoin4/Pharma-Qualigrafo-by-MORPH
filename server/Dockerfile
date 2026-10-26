# Qualigrafo API (Phase 3 / P2). Node 24 on Debian slim; runs as the unprivileged "node" user.
# The TypeScript sources run through tsx (as in development), so the image keeps the lock file's dev tools
# (tsx, prisma CLI for migrations). Build: docker build -t qualigrafo-api ./server
FROM node:24-bookworm-slim

# OpenSSL for the Prisma schema engine (migrations), CA certificates for SMTP / HTTPS, tini as PID 1 (signals, zombies),
# PostgreSQL 18 client tools (pg_dump / pg_restore for backups) from the PostgreSQL project's repository — Debian's own
# client is older than the database server and cannot dump it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=/data/storage \
    VALIDATION_DIR=/data/validation \
    BACKUP_DIR=/backups \
    PG_BIN_DIR=/usr/lib/postgresql/18/bin \
    TRUST_PROXY=uniquelocal \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
# --include=dev: NODE_ENV=production would skip tsx and the prisma CLI, which the container needs at runtime.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force

COPY . .
# prisma.config.ts needs a DATABASE_URL to load; generating the client never connects to it.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
 && chmod +x docker-entrypoint.sh \
 && mkdir -p /data/storage /data/validation /backups \
 && chown -R node:node /data /backups /app/src/generated

USER node
EXPOSE 4000
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
CMD ["serve"]
