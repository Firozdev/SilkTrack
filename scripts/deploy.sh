#!/usr/bin/env bash
# Deploy the latest "production" branch on the VPS: pull, build, migrate, restart.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-production}"
# Optional extra compose file from .env (e.g. deploy/docker-compose.npm.yml behind an existing proxy: no Caddy).
EXTRA="$(grep -E '^COMPOSE_EXTRA=' .env | cut -d= -f2- | tr -d '"' || true)"
COMPOSE="docker compose -f docker-compose.prod.yml ${EXTRA:+-f $EXTRA} --env-file .env"
WEB="app caddy"
[ -n "$EXTRA" ] && WEB="app"

git fetch origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
echo "Deploying $(git log -1 --format='%h %s')"

$COMPOSE build app migrate
$COMPOSE up -d postgres
$COMPOSE run --rm migrate
$COMPOSE up -d $WEB
$COMPOSE ps
