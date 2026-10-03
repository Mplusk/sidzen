#!/usr/bin/env bash
# Run as root on a fresh Ubuntu 24.04 server. Never prints generated secrets.
set -Eeuo pipefail
umask 077
if [[ $EUID -ne 0 ]]; then printf 'Run as root.\n' >&2; exit 1; fi
source /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then printf 'Ubuntu 24.04 is required.\n' >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl openssl cron python3
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker cron
if ! id deploy >/dev/null 2>&1; then useradd --create-home --shell /bin/bash deploy; fi
usermod -aG docker deploy
install -d -m 0750 -o deploy -g deploy /opt/3dprinta /opt/3dprinta/incoming /opt/3dprinta/releases /opt/3dprinta/shared /var/backups/3dprinta
if [[ ! -f /opt/3dprinta/shared/.env.production ]]; then
  db_password="$(openssl rand -hex 32)"
  auth_secret="$(openssl rand -hex 32)"
  integration_key="$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 16)"
  printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgresql://3dprinta:%s@db:5432/3dprinta?schema=public\nAUTH_SECRET=%s\nINTEGRATION_ENCRYPTION_KEY=%s\nNEXT_PUBLIC_SITE_URL=https://3dprinta.shop\nUPLOAD_DIR=/app/private-uploads\nBOOTSTRAP_ADMIN_EMAIL=admin@3dprinta.shop\nBOOTSTRAP_ADMIN_PASSWORD=%s\nPAYMENT_PROVIDER=manual\nDELIVERY_PROVIDER=manual\nYOOKASSA_ALLOW_TEST=false\n' "$db_password" "$db_password" "$auth_secret" "$integration_key" "$admin_password" > /opt/3dprinta/shared/.env.production
  chown deploy:deploy /opt/3dprinta/shared/.env.production
  chmod 0600 /opt/3dprinta/shared/.env.production
fi
if [[ ! -f /opt/3dprinta/shared/admin-access.txt ]]; then
  printf 'Site: https://3dprinta.shop\nAdmin: https://3dprinta.shop/admin/\nEmail: admin@3dprinta.shop\n' > /opt/3dprinta/shared/admin-access.txt
  awk -F= '/^BOOTSTRAP_ADMIN_PASSWORD=/{ print "Password: " $2 }' /opt/3dprinta/shared/.env.production >> /opt/3dprinta/shared/admin-access.txt
  chown deploy:deploy /opt/3dprinta/shared/admin-access.txt
  chmod 0600 /opt/3dprinta/shared/admin-access.txt
fi
ln -sfn /opt/3dprinta/current/scripts/backup.sh /usr/local/sbin/3dprinta-backup
printf '20 3 * * * deploy /usr/local/sbin/3dprinta-backup >> /opt/3dprinta/shared/backup.log 2>&1\n' > /etc/cron.d/3dprinta-backup
chmod 0644 /etc/cron.d/3dprinta-backup
docker version --format '{{.Server.Version}}'
docker compose version
printf 'Server provisioned. Production secrets are stored in /opt/3dprinta/shared/.env.production.\n'
