# Russian VPS deployment

The shop is hosted on `92.63.101.127`. The authoritative DNS A records for
`sidzen.shop`, `www.sidzen.shop`, `сидзэн.рф` and `www.сидзэн.рф` must point to this address. The Russian-domain aliases redirect to `sidzen.shop`.
Leave other
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
For this specific ISPmanager host, the release script also installs the separate
`deploy/nginx/ispmanager-sidzen-idn.conf` route with an Nginx validation and
reload; an existing independently changed alias route is not overwritten.

GitHub Actions builds the three application images on its runner, tags them by
commit SHA, and uploads them with the matching source archive. Production loads
these prebuilt images instead of building Next.js on the memory-constrained VPS.
It activates the release only after application, database, worker and backup
entrypoint checks. Old releases and shop-only image caches are cleaned only
after success; unrelated projects and persistent data volumes are preserved.
Before an image import, unused shop-only images (including orphaned migrators)
are removed while preserving every image of the current rollback release and
any image used by a container. Import requires enough room for unpacked layers,
compressed blobs and at least 512 MiB for database writes. Insufficient space
rejects the update before the working shop containers are changed.

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

The cron job at 03:20 server time invokes `/usr/local/sbin/3dprinta-backup`.
Local archives under `/var/backups/3dprinta` include a PostgreSQL dump, uploaded
models and product images, the privacy ledger, and shop-specific configuration.
Up to 12 days of backups are kept, with a margin for the daily rotation.

To enable Yandex Disk uploads, install `age` and `rclone` and configure
`/opt/3dprinta/shared/backup` with mode `0700`. Store the authorized `rclone`
configuration as `yandex-rclone.conf` with mode `0600` and a remote named
`sidzen-backup`. `remote-path` contains that remote and the dedicated backup
folder. `age.recipient` contains the public encryption key. Keep the private
recovery key outside the VPS and Yandex Disk. The job uploads only the encrypted
archive, checks the uploaded hash, and rotates its own old backups in the folder.

To recover, decrypt with `age --decrypt -i RECOVERY_KEY ARCHIVE.tar.age`, extract
the tar into an empty directory, and run `sha256sum --check SHA256SUMS` there.
`release.txt` identifies the application revision. Review `configuration.tar.gz`
before installing the server-specific settings. Restore `database.dump` with
`pg_restore` into PostgreSQL and the other three archives into the matching
Docker volumes. Preserve the stored ownership and application secrets.

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
