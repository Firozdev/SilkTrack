# SilkTrack

China Sourcing & Shipment Management App. Spec: `docs/requirements.md`. Rules: `CLAUDE.md`.

## Local setup (macOS)

```bash
cp .env.example .env          # fill in passwords and AUTH_SECRET (openssl rand -base64 32)
npm install                   # also runs `prisma generate`
npm run db:up                 # PostgreSQL 17 in Docker
npm run db:migrate            # apply migrations
npm run db:seed               # first ADMIN from SEED_ADMIN_* + default settings
npm run dev                   # http://localhost:3000
```

Create more users (until the user-management screen exists):

```bash
npm run user:create -- --email rahim@example.com --name "Rahim" --role CS --password 'secret123'
npm run user:create -- --email li@example.com --name "Li" --role PURCHASE --password 'secret123'
```

PURCHASE users default to `Asia/Shanghai` and Simplified Chinese; others to `Asia/Dhaka` and English.

## Checks

```bash
npm test          # unit tests (vitest)
npm run typecheck
npm run lint
npm run build
```

## Where things are

- `prisma/schema.prisma` – data model for all modules
- `src/auth.ts` – login (Auth.js credentials, JWT sessions)
- `src/proxy.ts` – sends signed-out visitors to /login
- `src/lib/session.ts` – `requireUser()` / `requirePermission()` for pages and actions
- `src/lib/permissions.ts` – what each role may do; `redactForRole()` hides selling price/profit from PURCHASE
- `src/lib/audit.ts` – audit-log helpers

## Branches

- `develop` – day-to-day work (your Mac)
- `main` – stable, tested code
- `production` – what the VPS runs. Release: merge `develop` → `main` → `production`, then deploy.

## Production (VPS)

Docker Compose runs PostgreSQL, the app and Caddy (`docker-compose.prod.yml`). The database is not exposed to the internet.

```bash
# once
git clone -b production https://github.com/Firozdev/SilkTrack.git silktrack && cd silktrack
cp .env.production.example .env      # fill in passwords, AUTH_SECRET, AUTH_URL, SITE_ADDRESS

# every release
./scripts/deploy.sh                  # pull production, build, migrate, restart
```

- HTTPS: set `SITE_ADDRESS` to your domain (DNS A record → server IP) and `AUTH_URL=https://…`, then `./scripts/deploy.sh`.
- Backups: `scripts/backup.sh` (database + uploads, 14 days) runs daily from cron.
- Admin commands on the server use the `tools` container, e.g.:
  ```bash
  T="docker compose -f docker-compose.prod.yml --env-file .env run --rm tools"
  $T npm run user:create -- --email li@example.com --name "Li" --role PURCHASE --password '…'
  $T npm run user:password -- --email admin@silktrack.local --password '…'
  $T npm run user:allow-selling -- --email li@example.com
  ```
