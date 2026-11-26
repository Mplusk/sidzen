#!/usr/bin/env bash
set -Eeuo pipefail
revision="${1:-}"
registry_prefix="${2:-}"
registry_user="${3:-}"
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$registry_prefix" =~ ^ghcr\.io/[a-z0-9-]+/sidzen$ && "$registry_user" =~ ^[A-Za-z0-9-]+$ ]] || exit 2
incoming=/opt/3dprinta/incoming

deployment_job() {
  local action="$1" run="$2" saved='' token
  [[ "$run" =~ ^[0-9]+-[0-9]+$ ]] || return 2
  local job="${revision}/${run}"
  local directory="${incoming}/.registry-deploy"
  local state="${directory}/state" log="${directory}/deploy.log"

  if [[ "$action" == status ]]; then
    if [[ -r "$state" ]]; then saved="$(< "$state")"; fi
    case "$saved" in
      "$job success") printf 'success\n' ;;
      "$job running") printf 'running\n' ;;
      "$job failed") printf 'failed\n'; tail -n 40 "$log" >&2 ;;
      *) printf 'pending\n' ;;
    esac
    return
  fi

  [[ "$action" == start ]] || return 2
  IFS= read -r token
  [[ -n "$token" ]] || return 2
  umask 077
  install -d -m 0700 "$directory"
  exec 8>"${directory}/lock"
  if ! flock -n 8; then
    if [[ -r "$state" && "$(< "$state")" == "$job "* ]]; then return 0; fi
    printf 'Another registry deployment is running on the VPS.\n' >&2
    return 1
  fi
  if [[ -r "$state" ]]; then saved="$(< "$state")"; fi
  if [[ "$saved" == "$job success" || "$saved" == "$job failed" ]]; then return 0; fi

  printf '%s running\n' "$job" > "${state}.tmp"
  mv -f -- "${state}.tmp" "$state"
  # The detached process keeps the lock and receives its token through a pipe.
  printf '%s\n' "$token" | setsid --fork bash -c '
    result=success
    bash "$1" "$2" "$3" "$4" || result=failed
    printf "%s %s\n" "$5" "$result" > "$6.tmp" && mv -f -- "$6.tmp" "$6"
  ' bash "$0" "$revision" "$registry_prefix" "$registry_user" "$job" "$state" > "$log" 2>&1
}

if [[ -n "${4:-}" ]]; then
  deployment_job "$4" "${5:-}"
  exit 0
fi

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
printf '%s' "$registry_token" | timeout --kill-after=5s 45s docker --config "$registry_auth" login ghcr.io --username "$registry_user" --password-stdin > /dev/null
unset registry_token
pull_image() {
  local reference="$1" attempt
  for attempt in 1 2 3; do
    if timeout --kill-after=10s 210s docker --config "$registry_auth" pull "$reference" < /dev/null; then
      return 0
    fi
    printf 'Registry pull attempt %s failed for %s.\n' "$attempt" "$reference" >&2
    if [[ "$attempt" != 3 ]]; then sleep 5; fi
  done
  return 1
}
while IFS=$'\t' read -r component reference; do
  [[ "$component" != source ]] || continue
  pull_image "$reference"
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference")"
  [[ "$image_revision" == "$revision" ]] || { printf 'Image revision mismatch.\n' >&2; exit 1; }
  docker image tag "$reference" "3dprinta-${component}:${revision}"
done <<< "$validated"
DEPLOY_PREBUILT_IMAGES=true DEPLOY_REQUIRE_LOCAL_IMAGES=true bash "${incoming}/${revision}.activate.sh" "$revision" < /dev/null
