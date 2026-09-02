#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="${PROJECT_DIR:-/opt/3dprinta/current}"
backup_dir="${BACKUP_DIR:-/var/backups/3dprinta}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_dir}/${timestamp}"

case "$backup_dir" in
  ""|/|/var|/var/backups) printf 'Unsafe BACKUP_DIR: %s\n' "$backup_dir" >&2; exit 1 ;;
esac

umask 077
mkdir -p "$destination"
cd "$project_dir"

docker compose --project-name 3dprinta --env-file .env.production exec -T db pg_dump -U 3dprinta -d 3dprinta --format=custom > "${destination}/database.dump"
docker run --rm -v 3dprinta_model-files:/source:ro -v "${destination}:/backup" alpine:3.20 tar -czf /backup/model-files.tar.gz -C /source .
sha256sum "${destination}/database.dump" "${destination}/model-files.tar.gz" > "${destination}/SHA256SUMS"

find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -mtime "+${retention_days}" -exec rm -rf -- {} +
printf 'Backup created: %s\n' "$destination"
