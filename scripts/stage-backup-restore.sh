#!/usr/bin/env bash
set -Eeuo pipefail

name="${1:-}"
destination="${2:-}"
directory=/opt/3dprinta/shared/backup
[[ "$name" =~ ^sidzen-[0-9]{8}T[0-9]{6}Z\.tar\.age$ ]] || { printf 'Invalid backup name.\n' >&2; exit 2; }
[[ -d "$destination" && ! -L "$destination" && -z "$(ls -A -- "$destination")" ]] || { printf 'Expected an empty staging directory.\n' >&2; exit 2; }
[[ -f "$directory/yandex-rclone.conf" && -f "$directory/remote-path" && -f "$directory/restore.agekey" ]] || { printf 'Backup access or recovery key is missing.\n' >&2; exit 2; }
remote="$(< "$directory/remote-path")"
[[ "$remote" == sidzen-backup:?* && "$remote" != *$'\n'* && "$remote" != *$'\r'* ]] || { printf 'Invalid backup destination.\n' >&2; exit 2; }
exec 7>/var/backups/3dprinta/.backup.lock
flock -n 7 || { printf 'Backup or another restore is in progress.\n' >&2; exit 1; }

options=(--config "$directory/yandex-rclone.conf" --contimeout 15s --timeout 2m --retries 3)
file="${remote%/}/${name}"
size="$(rclone "${options[@]}" lsjson --stat "$file" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Size"])')"
free="$(df -PB1 "$destination" | awk 'NR == 2 {print $4}')"
[[ "$size" =~ ^[0-9]{1,12}$ && "$free" =~ ^[0-9]+$ ]] && (( size > 0 && size + 536870912 < free ))
encrypted="$(mktemp "${destination%/*}/.restore-encrypted.XXXXXX")"
signature="$(mktemp "${destination%/*}/.restore-signature.XXXXXX")"
trap 'rm -f -- "$encrypted" "$signature"' EXIT
rclone "${options[@]}" cat "$file" > "$encrypted"
[[ "$(wc -c < "$encrypted")" -eq "$size" ]]
rclone "${options[@]}" cat "${file}.hmac" | head -c 256 > "$signature"
python3 "$(dirname "$0")/backup-auth.py" verify "$directory/restore.agekey" "$encrypted" "$signature"
age --decrypt -i "$directory/restore.agekey" < "$encrypted" |
  python3 "$(dirname "$0")/extract-restore-backup.py" "$destination"
