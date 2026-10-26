#!/usr/bin/env bash
# Test of the Docker deployment (Phase 3 / P2), run by CI (needs Docker, Node 24, Chrome, npm ci in qualigrafo/):
#   1. all browser suites against the production stack (Caddy HTTPS + CSP, API in production mode, PostgreSQL)
#   2. a fresh installation: deploy-smoke.mjs (first administrator, headers, client address, IQ in production)
#   3. restart: data and code fingerprint kept
# Uses Caddy's internal CA (TLS_MODE=internal) and throw-away secrets. Never run it against a real installation:
# step 1 wipes the database with the test fixtures and step 2 deletes the volumes.
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose -f docker-compose.yml"
CA="${RUNNER_TEMP:-/tmp}/caddy-root.crt"
SUITES="e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 e2e9 e2e10 e2e11 e2e12 e2e13 e2e14 e2e15 e2e16 e2e17"
export NODE_EXTRA_CA_CERTS="$CA" E2E_IGNORE_HTTPS_ERRORS=1 BASE=https://localhost/ HTTP_BASE=http://localhost/ COMPOSE_FILE="$PWD/docker-compose.yml"

cat > .env <<EOF
DOMAIN=localhost
TLS_MODE=internal
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
APP_TIMEZONE=Asia/Riyadh
QUALIGRAFO_VERSION=ci
EOF

start() {
  $DC up -d --build --wait --wait-timeout 300
  for _ in $(seq 1 30); do $DC cp web:/data/caddy/pki/authorities/local/root.crt "$CA" 2>/dev/null && break; sleep 2; done
  curl --fail -sS --cacert "$CA" https://localhost/api/health && echo
}

fail=0
echo "== 1. browser suites against the production stack"
start
for s in $SUITES; do
  extra=""; [ "$s" = e2e15 ] && extra="-- --projects 100"   # load-test projects (OQ-UI-15)
  $DC exec -T -e NODE_ENV=development api npm run --silent fixtures:load $extra > /dev/null
  log="${RUNNER_TEMP:-/tmp}/$s.log"
  (cd ../qualigrafo && node "scripts/$s.mjs") > "$log" 2>&1 || fail=1
  echo "$s: $(grep -c '^PASS' "$log" || true) pass, $(grep -c '^FAIL' "$log" || true) fail"
  grep -E '^FAIL|Error' "$log" || true
done

echo "== 2. fresh installation"
$DC down -v
start
(cd ../qualigrafo && node scripts/deploy-smoke.mjs) || fail=1

echo "== 3. restart: data kept"
$DC down
start
(cd ../qualigrafo && node scripts/deploy-smoke.mjs --after-restart) || fail=1

exit $fail
