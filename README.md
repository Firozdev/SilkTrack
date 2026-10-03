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
