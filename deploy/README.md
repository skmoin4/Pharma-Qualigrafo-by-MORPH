# Installing Qualigrafo (Docker)

One installation per customer. Three containers: **web** (Caddy: HTTPS, web client, `/api` proxy — the only one with
open ports), **api** (Node.js; applies database migrations at start), **db** (PostgreSQL 18, internal only).

## 1. Requirements

| | |
|---|---|
| Server | Linux x86-64, 2 CPU, 4 GB RAM, 20 GB disk + space for documents |
| Software | Docker Engine 24+ with the Compose plugin (`docker compose version`) |
| Network | A DNS name for the server (e.g. `qualigrafo.customer.com`); ports 80 and 443 open to users |
| Certificate | One of: Let's Encrypt (public DNS, ports reachable from the internet), a certificate from your IT, or Caddy's internal CA |
| E-mail (optional) | An SMTP relay for reminders, notifications and security alerts |

## 2. Install

```bash
cd /opt/qualigrafo/deploy            # the release, unpacked
cp .env.example .env && chmod 600 .env
openssl rand -hex 24                 # -> POSTGRES_PASSWORD
openssl rand -hex 32                 # -> JWT_SECRET
nano .env                            # DOMAIN, TLS_MODE, secrets, APP_TIMEZONE, SMTP ...
```

HTTPS (`TLS_MODE`):

- `custom` — your IT's certificate: copy the full chain to `deploy/certs/cert.pem` and the private key to
  `deploy/certs/key.pem` (readable by the container; never commit them).
- `auto` — Let's Encrypt: `DOMAIN` must resolve to this server from the internet, ports 80 and 443 reachable, set `ACME_EMAIL`.
- `internal` — Caddy's own CA (tests, closed networks): distribute its root certificate to the users' browsers:
  `docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./qualigrafo-root.crt`.

Start, then create the first administrator (a one-time temporary password is printed; it must be changed at the first sign-in):

```bash
docker compose up -d --build
docker compose ps                    # db, api: healthy; web: running
docker compose exec api npm run create-admin -- --email head.qa@customer.com --name "Full Name" --company "Customer Ltd"
```

Open `https://<DOMAIN>`, sign in, set your password, then:

1. **Users & access → System & validation → Run installation check.** Every check must be *Pass* (warnings: review and
   justify, e.g. SMTP not configured). Download the **IQ record (PDF)**, sign it and keep it with your validation
   records. The *code fingerprint* must equal the one in the validation pack of this release.
2. **Users & access → E-mail & reminders:** send a test e-mail; switch on the daily reminders and set the time.
   **Users & access → Backups:** check the time and run *Back up now* once; it must end *Verified*.
3. **Requirement library:** load or import your approved requirements; then create users and the first project.

### After the first start

Create the **first administrator** on the server, then a **second account** for a colleague:

```bash
docker compose run --rm api npm run create-admin -- --email head.qa@customer.com --name "Full Name" --company "Customer Ltd"
```

A second administrator or Owner / QA account is not optional: requirement-library versions are approved under the
**four-eyes rule**, so whoever prepares a version cannot approve it. With a single account the library can never be
approved and projects would start without requirements.

## 3. Update to a new release

1. Back up: Users & access → Backups → *Back up now* (wait for *Verified*); copy the set off the server.
2. Replace the release files (keep `deploy/.env`, `deploy/certs`), set `QUALIGRAFO_VERSION` in `.env`.
3. `docker compose up -d --build` — database migrations are applied automatically when the api container starts.
4. Run the installation check again and compare the fingerprint with the new release's validation pack.

## 4. Operations

| Task | Command |
|---|---|
| Status / health | `docker compose ps` · `https://<DOMAIN>/api/health` (API + database, version) · `/api/health/live` |
| Logs | `docker compose logs -f api` (one JSON line per request / error, with its request id) · `docker compose logs -f web` (access log, JSON) · daily files in the api volume under `/data/logs`, kept `LOG_KEEP_DAYS` days |
| Monitoring | In the application: **Users & access → Monitoring** — health, background jobs, errors, interruptions, alerts, log tail |
| Restart / stop | `docker compose restart` · `docker compose down` (data stays in the volumes) |
| Reset a user's password | In the application: Users & access → user → Reset password |

Settings changed in `.env` take effect with `docker compose up -d`. Changing `JWT_SECRET` signs everybody out.

## 5. Monitoring and alerts

**Users & access → Monitoring** shows the health of the installation (version, database round trip, memory, free
space, requests and response times), the background jobs (e-mail delivery, reminders, backups, watchdog), the errors
the server recorded — grouped and counted, acknowledged or resolved with a note — and any interruption during which
the application was not running.

Administrators are e-mailed when a background job stops running, when the application was not reachable, when a new
error appears or when free space runs low; the same subject is sent at most once per hour. Switch the alerts on the
same page and check the path with *Send test alert* (e-mail must be configured, see `SMTP_HOST` in `.env`).

For an external uptime or monitoring tool set `METRICS_TOKEN` in `.env` (e.g. `openssl rand -hex 24`) and read:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://<DOMAIN>/api/metrics
```

It answers in Prometheus text format (up, uptime, database latency, requests by status class, p50 / p95, open errors,
memory, free space, background-job age and failures, backup age). Without the token the endpoint does not exist.
A plain uptime check can use `https://<DOMAIN>/api/health` (API + database) or `/api/health/live` (process only).

Log settings in `.env`: `LOG_LEVEL` (debug / info / warn / error), `LOG_FORMAT` (`json` for a log collector),
`LOG_DIR` (daily files; empty = container log only) and `LOG_KEEP_DAYS`. Request lines hold method, path, status,
duration, user and client address — never request bodies, passwords or tokens.

## 6. Backup and restore

Qualigrafo backs itself up: **Users & access → Backups** — daily at the set time (default 02:00 site time), keeping
the newest 14 sets. Each set (`qualigrafo-YYYYMMDD-HHMMSS-mmm`) holds the database dump, every stored file and a
SHA-256 manifest; after each backup a **test restore** loads it into a temporary database and checks records,
migrations and every file. Administrators are e-mailed when a backup or a test restore fails, and the installation
check (IQ-18) warns when no verified backup is younger than 48 hours.

Off-site copies are your IT's job: point `BACKUP_VOLUME` in `.env` at separate storage (e.g. a NAS mount) and/or copy
the backup folder off the server with your backup software. Copy whole set folders; unchanged files are hard links
to the previous set, so copying with link preservation (`rsync -aH`) saves space.

Restore after a loss (on the same or a new installation of the same or a newer release; test it regularly):

```bash
docker compose stop api
docker compose run --rm api npm run backup:restore -- --name qualigrafo-20261022-020000-000 --confirm-wipe
#   or a set copied back from off-site storage into the backup folder; list them with:
#   docker compose run --rm api ls /backups
docker compose up -d
```

The command checks the set's checksums, replaces the database content, adds the files, checks the restored records
against the manifest and applies the migrations of the installed release. Then run the installation check.

## 7. Security notes

- Only the web container publishes ports; the database is reachable only inside the Docker network.
- The API trusts the client address forwarded by Caddy (`TRUST_PROXY=uniquelocal`); Caddy replaces any
  `X-Forwarded-For` sent by clients, so the sign-in lockout and the logs use the real address.
- Responses carry HSTS, a strict Content-Security-Policy (no inline scripts, no eval), `X-Frame-Options: DENY`,
  `nosniff` and `no-referrer`. The containers run as unprivileged users (api) and with no admin API (Caddy).
- Keep `.env` and `certs/` readable by root only.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Browser certificate warning | `TLS_MODE=custom`: chain complete in `cert.pem`? `internal`: root certificate installed on the client? |
| `auto` certificate not issued | DNS points to the server, ports 80/443 reachable from the internet, `docker compose logs web` |
| api not healthy | `docker compose logs api` — invalid setting (printed at start) or database not reachable |
| Upload refused | `MAX_UPLOAD_MB` (API) and `MAX_REQUEST_MB` (proxy, larger) in `.env` |
