#!/usr/bin/env bash
set -Eeuo pipefail
revision="${1:-}"
registry_prefix="${2:-}"
registry_user="${3:-}"
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$registry_prefix" =~ ^ghcr\.io/[a-z0-9-]+/sidzen$ && "$registry_user" =~ ^[A-Za-z0-9-]+$ ]] || exit 2
incoming=/opt/3dprinta/incoming
validated="$(python3 "${incoming}/${revision}.manifest-validator.py" "${incoming}/${revision}.images.json" "$revision" "$registry_prefix" app migrate marketplace-worker)"
source_hash="$(head -n 1 <<< "$validated" | cut -f2)"
printf '%s  %s\n' "$source_hash" "${incoming}/${revision}.tar.gz" | sha256sum --check --status
available_kb="$(df -Pk "$incoming" | awk 'NR == 2 {print $4}')"
[[ "$available_kb" -ge 1572864 ]] || { printf 'Insufficient disk space for image pulls.\n' >&2; exit 1; }
IFS= read -r registry_token
[[ -n "$registry_token" ]] || exit 2
registry_auth="$(mktemp -d "${incoming}/.registry-auth.XXXXXX")"
chmod 0700 "$registry_auth"
trap 'rm -rf -- "$registry_auth"' EXIT
printf '%s' "$registry_token" | docker --config "$registry_auth" login ghcr.io --username "$registry_user" --password-stdin > /dev/null
unset registry_token
while IFS=$'\t' read -r component reference; do
  [[ "$component" != source ]] || continue
  docker --config "$registry_auth" pull "$reference" < /dev/null
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference")"
  [[ "$image_revision" == "$revision" ]] || { printf 'Image revision mismatch.\n' >&2; exit 1; }
  docker image tag "$reference" "3dprinta-${component}:${revision}"
done <<< "$validated"
DEPLOY_PREBUILT_IMAGES=true DEPLOY_REQUIRE_LOCAL_IMAGES=true bash "${incoming}/${revision}.activate.sh" "$revision" < /dev/null
