# SIDZEN deployment

Every application and relay release is activated by `.github/workflows/ci.yml`.
Do not hot-patch running containers or manually activate copied release bundles.

1. `verify` runs type checks, lint, unit tests, isolated PostgreSQL/API scenarios,
   the production build and HTTP smoke checks, including guest/account favorites.
2. `publish` builds the shop, migrator, worker and Telegram relay. It publishes
   private GHCR images and a manifest with content digests, source checksum and
   the exact Git revision. No production environment or customer data is in the
   build context. Large image tarballs are no longer copied over SSH.
3. `deploy` uploads the small source archive/manifest to the Russian VPS, pulls
   each image by digest, validates the revision and uses the existing migration,
   proxy, health, rollback and scoped cleanup procedure. Host-specific Compose
   overrides and Telegram transport settings are preserved.
4. `deploy_telegram` uploads only Telegram deployment files to 132.243.234.163.
   It provisions Docker if absent and runs only the restricted Telegram relay.
   There is no shop, database, customer upload directory or bot token there.

Registry authentication uses the job's expiring `GITHUB_TOKEN`, with write access
only in `publish` and read access in deployment jobs. On servers, Docker auth is
kept in a private temporary directory and removed on exit. No permanent registry
password is written to the host's default Docker config.

In `Mplusk/sidzen`, the registry prefix is `ghcr.io/mplusk/sidzen`.
The first push runs verification and publishes images but skips both production
deployments until the repository variable `PRODUCTION_DEPLOY_ENABLED` is set to
`true`. Before setting it, configure the production secrets and verify the SSH
identity and pinned host keys on both hosts. Then run the CI workflow manually
and verify the deployed revision and health checks. Keep the old repository and
registry images until the new deployment and rollback have been verified.

The required production secrets are `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_PRIVATE_KEY` and `DEPLOY_KNOWN_HOSTS`. The same CI public key is
authorized once on the Telegram host with forwarding and PTY disabled. Its host
key is pinned in `deploy/telegram-relay/known_hosts`; do not replace it with an
unchecked `ssh-keyscan` result. The server's root password is never stored in Git
or in workflow source.

The Russian VPS may host other services/domains. Each service must have its own
Compose project, volumes and private application network; only its web entry
joins the shared reverse proxy. SIDZEN cleanup is limited to its own unused image
tags and Compose project. Never run global Docker/container/volume prune.
The app's `fetch-cache` volume retains cached public map tiles across releases;
the runner creates the cache directory with ownership for uid 1001. Keep this
volume alongside `image-cache` when applying host-specific Compose overrides.
This deployment manages only the Telegram relay on its shared host. New shop
domains and their routing belong on the Russian host.

To change a deployed release, commit/revert the source and let CI publish a new
revision. A failed image pull does not stop the working application. Failed shop
or relay startup restores the previous runtime, with the legacy Telegram systemd
service retained until the first Docker release is healthy. Database backups and
their retention stay on the Russian VPS under the existing policy.
