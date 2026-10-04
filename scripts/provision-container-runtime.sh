#!/usr/bin/env bash
# Root-only runtime preparation; preserves existing ISPmanager/Nginx services.
# Does not create SSH keys, users, or modify authentication permissions.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { printf 'Ubuntu 24.04 required.\n' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl openssl cron python3
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker cron
install -d -m 0700 /var/lib/3dprinta
if [[ $(awk '/MemTotal/ {print $2}' /proc/meminfo) -lt 1500000 ]] && [[ ! -f /var/lib/3dprinta/swapfile ]]; then
  fallocate -l 2G /var/lib/3dprinta/swapfile
  chmod 0600 /var/lib/3dprinta/swapfile
  mkswap /var/lib/3dprinta/swapfile >/dev/null
  swapon /var/lib/3dprinta/swapfile
  grep -Fq '/var/lib/3dprinta/swapfile ' /etc/fstab || printf '/var/lib/3dprinta/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
install -d -m 0750 /opt/3dprinta /opt/3dprinta/incoming /opt/3dprinta/releases /opt/3dprinta/shared /var/backups/3dprinta
ln -sfn /opt/3dprinta/current/scripts/backup.sh /usr/local/sbin/3dprinta-backup
printf '20 3 * * * root /usr/local/sbin/3dprinta-backup >> /opt/3dprinta/shared/backup.log 2>&1\n' > /etc/cron.d/3dprinta-backup
chmod 0644 /etc/cron.d/3dprinta-backup
docker version --format '{{.Server.Version}}'
docker compose version
printf 'Container runtime ready; existing panel services preserved.\n'
