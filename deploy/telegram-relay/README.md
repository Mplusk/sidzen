# Telegram-only egress

The shop/database remain on the Russian VPS. `TELEGRAM_PROXY_URL` is read only by
`src/lib/telegram/transport.ts`, in both the web app (connection checks/tests) and
the order worker. It is **not** HTTP_PROXY/HTTPS_PROXY and never changes global
fetch or the route used by other integrations.

The relay on 185.196.41.131 accepts only source 92.63.101.127 and only the exact
CONNECT destination `api.telegram.org:443`. There is no general forward proxy,
Bot API token, Telegram account configuration or database on the relay. Telegram
TLS is verified end-to-end on the shop VPS. The relay never decrypts or logs bot
URLs, messages or tokens. Order messages contain only the existing opaque,
authenticated administrator link, with previews disabled, not buyer data.

For pre-existing images, `preload.mjs` can be mounted read-only alongside a
separate pinned Undici 7.30.1 installation at
`/opt/3dprinta/shared/telegram-runtime`. `compose.runtime.yaml` documents the
current host overlay (including its unchanged ISPmanager ports). Check the
existing overlay before merging: never overwrite unrelated host settings.
The preload forwards only Telegram calls lacking an explicit dispatcher; other
integrations pass through untouched. It remains compatible with the newer
native transport and does not modify files inside immutable container images.

The `Deploy Docker Telegram relay` GitHub Actions job publishes this service.
After verification, CI builds the image, pushes it to the private GHCR package,
and deploys its content digest. It installs Docker Engine and Compose from the
official Docker Ubuntu repository on the first run. Only relay configuration
and deployment scripts are uploaded to this host; shop images and the shop
database remain on the Russian VPS. See [CI/CD](../CI_CD.md).

`compose.yaml` retains the existing source-IP check and listening address with
host networking. It exposes no new Docker ports, has no Docker socket mount,
and runs as UID 10001 with a read-only filesystem, no capabilities, 64 MiB memory
and 32-process limits. Docker uses bounded logs and restart-unless-stopped.
The previous systemd service stops only after the image is available; on failed
container health the job restarts it. After successful migration the old unit is
disabled. Do not disable or overwrite the host's firewall or unrelated services.

Set `TELEGRAM_PROXY_URL=http://185.196.41.131:18443` in the shop's protected
production environment and recreate only app/worker using the current immutable
release tag and the existing host Compose overlay (see RUSSIAN_VPS.md). Verify
getMe/getChat before enabling notifications. A test message must contain no buyer
data. Never create a real customer order merely to test connectivity.

Acceptance checks: Telegram HTTPS succeeds through the proxy from the shop;
CONNECT to any other host is denied; another source IP is denied; app and worker
are healthy. Keep ambiguous send results UNCERTAIN rather than automatically
duplicating a possibly delivered message. Rollback: disable notifications, remove
TELEGRAM_PROXY_URL and recreate app/worker; stop only this relay service.
