#!/usr/bin/env bash
set -Eeuo pipefail
revision="${1:-}"
registry_prefix="${2:-}"
registry_user="${3:-}"
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$registry_prefix" =~ ^ghcr\.io/[a-z0-9-]+/sidzen$ && "$registry_user" =~ ^[A-Za-z0-9-]+$ ]] || exit 2
root=/opt/sidzen-telegram-relay
release="${root}/releases/${revision}"
validated="$(python3 "${release}/scripts/registry-release-manifest.py" "${release}/images.json" "$revision" "$registry_prefix" telegram-relay)"
relay_image="$(tail -n 1 <<< "$validated" | cut -f2)"
bash "${release}/scripts/provision-docker-host.sh" < /dev/null
IFS= read -r registry_token
[[ -n "$registry_token" ]] || exit 2
registry_auth="$(mktemp -d "${root}/.registry-auth.XXXXXX")"
chmod 0700 "$registry_auth"
trap 'rm -rf -- "$registry_auth"' EXIT
printf '%s' "$registry_token" | docker --config "$registry_auth" login ghcr.io --username "$registry_user" --password-stdin > /dev/null
unset registry_token
docker --config "$registry_auth" pull "$relay_image" < /dev/null
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$relay_image")" == "$revision" ]] || exit 2
previous="$(readlink -f "${root}/current" 2>/dev/null || true)"
legacy_active=false
if systemctl is-active --quiet sidzen-telegram-relay.service; then legacy_active=true; fi
printf 'RELAY_IMAGE=%s\n' "$relay_image" > "${release}/.env"
chmod 0600 "${release}/.env"
relay_compose() {
  docker compose --project-name sidzen-telegram-relay --env-file "${1}/.env" --file "${1}/deploy/telegram-relay/compose.yaml" "${@:2}" < /dev/null
}
relay_compose "$release" config --quiet
if [[ "$legacy_active" == true ]]; then systemctl stop sidzen-telegram-relay.service; fi
if ! relay_compose "$release" up -d --wait --wait-timeout 60; then
  relay_compose "$release" stop || true
  if [[ -n "$previous" && -f "${previous}/.env" ]]; then relay_compose "$previous" up -d --wait --wait-timeout 60; fi
  if [[ "$legacy_active" == true ]]; then systemctl start sidzen-telegram-relay.service; fi
  exit 1
fi
if [[ "$legacy_active" == true ]]; then systemctl disable sidzen-telegram-relay.service; fi
ln -sfn "$release" "${root}/current"
current_image="$(docker image inspect --format '{{.Id}}' "$relay_image")"
while IFS= read -r old_image; do
  if [[ -n "$old_image" && "$old_image" != "$current_image" && -z "$(docker ps -aq --filter "ancestor=$old_image")" ]]; then
    while IFS= read -r reference; do
      case "$reference" in
        ghcr.io/cossomoj/sidzen-telegram-relay:*) docker image rm "$reference" || true ;;
      esac
    done < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$old_image" 2>/dev/null || true)
    docker image rm "$old_image" || true
  fi
done < <(docker image ls --quiet --no-trunc --filter label=com.sidzen.component=telegram-relay | sort -u)
printf 'Telegram relay release is healthy: %s\n' "$revision"
