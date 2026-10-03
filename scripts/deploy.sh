#!/usr/bin/env bash
# Deploy the latest "production" branch on the VPS: pull, build, migrate, restart.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-production}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"

git fetch origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
echo "Deploying $(git log -1 --format='%h %s')"

$COMPOSE build app migrate
$COMPOSE up -d postgres
$COMPOSE run --rm migrate
$COMPOSE up -d app caddy
$COMPOSE ps
