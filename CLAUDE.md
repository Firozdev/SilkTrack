# SilkTrack – China sourcing & shipment app

Internal web app to take customer product requests in Bangladesh, buy them in China,
consolidate them into weekly shipments, and deliver to the customer's home.

Full spec: docs/requirements.md. Read it before starting any module.

## Stack
- Next.js (App Router, TypeScript), Tailwind CSS
- PostgreSQL + Prisma
- Auth: email/password, 3 roles: ADMIN, CS (Bangladesh), PURCHASE (China)
- Local dev: PostgreSQL in Docker Compose; developer machine is a Mac mini
- Deploy: Docker Compose (app + postgres) behind Caddy on an Ubuntu VPS

## Rules
- Store money as Decimal, never float. Keep RMB and BDT side by side with the rate used.
- Every purchase, estimate and invoice saves the exchange rate at that moment.
- PURCHASE role must never see profit or margin, and sees BDT selling prices only if Admin enabled `canSetSellingPrice` for that user.
- Log changes to price, rate, weight, CBM and status (audit log).
- Build one module at a time; run migrations and tests before moving on.
- Show me the Prisma schema before running any migration that changes it.
- Never commit secrets; keep them in .env (and add .env.example).
- Explain what you changed in plain language at the end of each task.

## Build order
1. Project setup, schema, auth and roles
2. Exchange rates
3. Product requests
4. China purchasing
5. China warehouse receiving
6. Weekly shipments
7. Tracking
8. BD receiving and delivery
9. Bulk estimates and quotes
10. Notifications, dashboards and reports
