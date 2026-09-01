#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="${PROJECT_DIR:-/opt/3dprinta}"
cd "$project_dir"

git fetch origin main
git checkout main
git pull --ff-only origin main
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d --remove-orphans
docker compose --env-file .env.production ps
