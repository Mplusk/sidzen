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

Deploy the two files to `/opt/sidzen-telegram-relay/relay.py` (0644) and
`/etc/systemd/system/sidzen-telegram-relay.service` (0644), then run
`systemd-analyze verify /etc/systemd/system/sidzen-telegram-relay.service`,
`systemctl daemon-reload` and `systemctl enable --now sidzen-telegram-relay`.
The service runs as a restricted dynamic user, with memory/concurrency/time
limits. Do not disable or overwrite the host's existing firewall or services.

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
