# SilkTrack production image (Next.js standalone + Prisma 7, no query engine needed).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# One-off container that applies database migrations.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/app/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "server.js"]
