#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="${PROJECT_DIR:-/opt/3dprinta/current}"
shared_dir="${BACKUP_SHARED_DIR:-/opt/3dprinta/shared}"
backup_dir="${BACKUP_DIR:-/var/backups/3dprinta}"
# Delete at 12 days with a daily rotation margin, so automated copies never
# intentionally remain for more than the published 14-day ceiling.
retention_days="${BACKUP_RETENTION_DAYS:-12}"
if [[ ! "$retention_days" =~ ^[1-9][0-9]?$ ]] || (( retention_days > 12 )); then retention_days=12; fi
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_dir}/${timestamp}"
offsite_config="${shared_dir}/backup/yandex-rclone.conf"

case "$backup_dir" in
  ""|/|/var|/var/backups) printf 'Unsafe BACKUP_DIR: %s\n' "$backup_dir" >&2; exit 1 ;;
esac

umask 077
mkdir -p "$backup_dir"
exec 9>"${backup_dir}/.backup.lock"
if ! flock -n 9; then
  printf 'Another SIDZEN backup is running.\n' >&2
  exit 1
fi
staging="$(mktemp -d "${backup_dir}/.creating.XXXXXX")"
encrypted=''
signature=''
cleanup() {
  if [[ -d "$staging" ]]; then rm -rf -- "$staging"; fi
  if [[ -n "$encrypted" ]]; then rm -f -- "$encrypted"; fi
  if [[ -n "$signature" ]]; then rm -f -- "$signature"; fi
}
trap cleanup EXIT
# Rotate even if creating today's backup later fails. Never let a failed dump
# silently extend the lifetime of older personal-data copies.
find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime "+${retention_days}" -exec rm -rf -- {} +
cd "$project_dir"

compose=(docker compose --project-name 3dprinta --env-file .env.production)
"${compose[@]}" exec -T db pg_dump -U 3dprinta -d 3dprinta --format=custom < /dev/null > "${staging}/database.dump"
"${compose[@]}" exec -T db pg_restore --list < "${staging}/database.dump" > /dev/null

for volume in model-files product-images privacy-ledger; do
  docker volume inspect "3dprinta_${volume}" > /dev/null
  docker run --rm --network none --volume "3dprinta_${volume}:/source:ro" alpine:3.20 tar -czf - -C /source . > "${staging}/${volume}.tar.gz"
done

settings=("${shared_dir#/}/.env.production")
for path in "${shared_dir}/compose.override.yaml" "${shared_dir}/telegram-runtime" \
  /etc/nginx/conf.d/3dprinta-shop.conf /etc/nginx/conf.d/sidzen-idn.conf /etc/cron.d/3dprinta-backup; do
  if [[ -e "$path" ]]; then settings+=("${path#/}"); fi
done
tar -czf "${staging}/configuration.tar.gz" -C / "${settings[@]}"
printf '%s\n' "$(basename "$(pwd -P)")" > "${staging}/release.txt"
(
  cd "$staging"
  sha256sum database.dump model-files.tar.gz product-images.tar.gz privacy-ledger.tar.gz configuration.tar.gz release.txt > SHA256SUMS
  sha256sum --check --status SHA256SUMS
)
mv -T -- "$staging" "$destination"

printf 'Backup created: %s\n' "$destination"

if [[ -f "$offsite_config" ]]; then
  recipient="$(< "${shared_dir}/backup/age.recipient")"
  remote="$(< "${shared_dir}/backup/remote-path")"
  if [[ ! "$recipient" =~ ^age1[0-9a-z]{58}$ || "$remote" != sidzen-backup:?* ]]; then
    printf 'Invalid encryption recipient or Yandex Disk destination.\n' >&2
    exit 1
  fi
  encrypted="$(mktemp "${backup_dir}/.encrypted.XXXXXX")"
  tar -cf - -C "$destination" . | age -r "$recipient" > "$encrypted"

  rclone_options=(--config "$offsite_config" --contimeout 15s --timeout 2m --retries 3 --low-level-retries 4)
  remote_file="${remote%/}/sidzen-${timestamp}.tar.age"
  rclone "${rclone_options[@]}" copyto --immutable --checksum "$encrypted" "$remote_file"
  local_hash="$(md5sum "$encrypted" | cut -d ' ' -f 1)"
  remote_hash="$(rclone "${rclone_options[@]}" md5sum "$remote_file" | cut -d ' ' -f 1)"
  if [[ "$local_hash" != "$remote_hash" ]]; then
    printf 'Yandex Disk checksum mismatch for sidzen-%s.tar.age.\n' "$timestamp" >&2
    exit 1
  fi
  printf 'Encrypted backup uploaded and verified: sidzen-%s.tar.age\n' "$timestamp"

  if [[ -f "${shared_dir}/backup/restore.agekey" ]]; then
    signature="$(mktemp "${backup_dir}/.signature.XXXXXX")"
    python3 "${project_dir}/scripts/backup-auth.py" sign "${shared_dir}/backup/restore.agekey" "$encrypted" "sidzen-${timestamp}.tar.age" > "$signature"
    rclone "${rclone_options[@]}" copyto --immutable --checksum "$signature" "${remote_file}.hmac"
    signature_hash="$(md5sum "$signature" | cut -d ' ' -f 1)"
    remote_signature_hash="$(rclone "${rclone_options[@]}" md5sum "${remote_file}.hmac" | cut -d ' ' -f 1)"
    [[ "$signature_hash" == "$remote_signature_hash" ]]
  fi

  rclone "${rclone_options[@]}" delete --max-depth 1 --min-age "${retention_days}d" \
    --include '/sidzen-????????T??????Z.tar.age' --include '/sidzen-????????T??????Z.tar.age.hmac' --yandex-hard-delete "$remote"
fi
