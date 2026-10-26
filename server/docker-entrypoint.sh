#!/bin/sh
# Container entrypoint for the Qualigrafo API.
#   serve (default)  apply pending database migrations, then start the API
#   anything else    run it as a command, e.g. "npm run create-admin -- --email ..." via docker compose run / exec
set -e

if [ "$1" = "serve" ]; then
  if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
    echo "Applying database migrations..."
    npx prisma migrate deploy
  fi
  # exec: the API becomes the child of tini and receives SIGTERM directly (graceful shutdown).
  exec node --import tsx src/index.ts
fi

exec "$@"
