# Russian VPS deployment

The shop is hosted on `92.63.101.127`. The authoritative DNS A records for
`3dprinta.shop` and `www.3dprinta.shop` must point to this address. Leave other
domains and mail records unchanged.

Run `scripts/provision-container-runtime.sh` as root on Ubuntu 24.04. It installs
Docker and daily shop backups without changing SSH authentication or removing
ISPmanager. Authorize a deployment SSH key separately. Keep secrets only in
`/opt/3dprinta/shared/.env.production`, with mode `0600`.

The existing ISPmanager Nginx keeps port 80. Install
`deploy/nginx/ispmanager-shop.conf` into `/etc/nginx/conf.d/`, validate the Nginx
configuration and reload it. Copy `deploy/compose-ispmanager.yaml` to
`/opt/3dprinta/shared/compose.override.yaml`. This routes shop HTTP through
loopback port 8080; Caddy terminates public HTTPS on port 443. The deployment
script retains this host-specific overlay for every release and rollback.

GitHub Actions builds the three application images on its runner, tags them by
commit SHA, and uploads them with the matching source archive. Production loads
these prebuilt images instead of building Next.js on the memory-constrained VPS.
It activates the release only after application, database, worker and backup
entrypoint checks. Old releases and shop-only image caches are cleaned only
after success; unrelated projects and persistent data volumes are preserved.

CI secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY` and verified
`DEPLOY_KNOWN_HOSTS`. Never commit their values.

Before first application startup, restore the PostgreSQL backup and uploaded
product/model volumes. Preserve `AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY`
from the previous environment so existing sessions and encrypted integration
settings remain usable. Confirm database health after PostgreSQL initialization
has finished, not during its temporary initialization server.

Set `PERSONAL_DATA_RF_STORAGE_CONFIRMED=true` only after verifying that the actual
database and backup storage are in Russia. This infrastructure setting does not
replace the operator's other personal-data compliance obligations. Do not enable
it on the previous foreign server. Keep the previous installation unchanged
until DNS cutover and the migrated database/files have been verified; prevent
parallel writes during the final cutover snapshot.

Daily backups run through `/usr/local/sbin/3dprinta-backup`; the executable is a
symlink to the active release's backup script. Archives are stored under
`/var/backups/3dprinta` on the VPS and retained for 14 days. Additional independent
Russian backup storage requires separate configuration.

For manual Compose operations on the active release, select its immutable image
tag and the persistent host overlay explicitly:

```sh
cd /opt/3dprinta/current
export SHOP_IMAGE_TAG="$(basename "$(readlink -f /opt/3dprinta/current)")"
docker compose --env-file .env.production -f compose.yaml \
  -f /opt/3dprinta/shared/compose.override.yaml ps
```

The automated deployment sets this tag itself. Do not rebuild images or run
Compose without the host overlay on the production VPS.
