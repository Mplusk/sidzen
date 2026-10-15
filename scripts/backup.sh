#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="${PROJECT_DIR:-/opt/3dprinta/current}"
backup_dir="${BACKUP_DIR:-/var/backups/3dprinta}"
# Delete at 12 days with a daily rotation margin, so automated copies never
# intentionally remain for more than the published 14-day ceiling.
retention_days="${BACKUP_RETENTION_DAYS:-12}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days > 12 )); then retention_days=12; fi
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_dir}/${timestamp}"

case "$backup_dir" in
  ""|/|/var|/var/backups) printf 'Unsafe BACKUP_DIR: %s\n' "$backup_dir" >&2; exit 1 ;;
esac

umask 077
mkdir -p "$destination"
# Rotate even if creating today's backup later fails. Never let a failed dump
# silently extend the lifetime of older personal-data copies.
find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime "+${retention_days}" -exec rm -rf -- {} +
cd "$project_dir"

docker compose --project-name 3dprinta --env-file .env.production exec -T db pg_dump -U 3dprinta -d 3dprinta --format=custom < /dev/null > "${destination}/database.dump"
docker run --rm -v 3dprinta_model-files:/source:ro -v "${destination}:/backup" alpine:3.20 tar -czf /backup/model-files.tar.gz -C /source .
docker run --rm -v 3dprinta_product-images:/source:ro -v "${destination}:/backup" alpine:3.20 tar -czf /backup/product-images.tar.gz -C /source .
docker run --rm -v 3dprinta_privacy-ledger:/source:ro -v "${destination}:/backup" alpine:3.20 tar -czf /backup/privacy-ledger.tar.gz -C /source .
sha256sum "${destination}/database.dump" "${destination}/model-files.tar.gz" "${destination}/product-images.tar.gz" "${destination}/privacy-ledger.tar.gz" > "${destination}/SHA256SUMS"

printf 'Backup created: %s\n' "$destination"
