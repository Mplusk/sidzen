#!/usr/bin/env bash
set -Eeuo pipefail

release_sha="${1:-}"
project_root="/opt/3dprinta"
release_root="${project_root}/releases"
incoming_root="${project_root}/incoming"
shared_env="${project_root}/shared/.env.production"
current_link="${project_root}/current"
legacy_release="/opt/3dprinta-legacy"
artifact="${incoming_root}/${release_sha}.tar.gz"
staging_release="${release_root}/${release_sha}.staging"
final_release="${release_root}/${release_sha}"
compose_project="3dprinta"
health_url="http://127.0.0.1:3000/api/health/"

if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Invalid release SHA: %s\n' "$release_sha" >&2
  exit 2
fi

if [[ ! -f "$artifact" ]]; then
  printf 'Release archive does not exist: %s\n' "$artifact" >&2
  exit 2
fi

if [[ ! -f "$shared_env" ]]; then
  printf 'Production environment does not exist: %s\n' "$shared_env" >&2
  exit 2
fi

exec 9>"${project_root}/deploy.lock"
if ! flock -n 9; then
  printf 'Another production deployment is already running.\n' >&2
  exit 3
fi

previous_release=""
if [[ -L "$current_link" ]]; then
  previous_release="$(readlink -f "$current_link")"
fi

compose_for() {
  local release_dir="$1"
  docker compose \
    --project-name "$compose_project" \
    --env-file "$shared_env" \
    --file "${release_dir}/compose.yaml" \
    "${@:2}"
}

rollback() {
  local reason="$1"
  printf 'Deployment failed during %s.\n' "$reason" >&2

  if [[ -n "$previous_release" && -f "${previous_release}/compose.yaml" ]]; then
    printf 'Rolling back to %s.\n' "$previous_release" >&2
    ln -sfn "$shared_env" "${previous_release}/.env.production"
    compose_for "$previous_release" build
    compose_for "$previous_release" up -d --remove-orphans
  else
    printf 'No previous release is available for automatic rollback.\n' >&2
  fi

  exit 1
}

wait_for_health() {
  local attempt
  local response

  for attempt in $(seq 1 40); do
    response="$(curl --silent --show-error --fail --max-time 5 "$health_url" 2>/dev/null || true)"
    if [[ "$response" == *'"status":"ok"'* && "$response" == *'"database":"ok"'* ]]; then
      return 0
    fi
    sleep 3
  done

  return 1
}

cleanup_successful_deploy() {
  local old_release

  while IFS= read -r -d '' old_release; do
    rm -rf -- "$old_release"
  done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d ! -name "$release_sha" -print0)

  find "$incoming_root" -mindepth 1 -maxdepth 1 -type f -name '*.tar.gz' -delete

  if [[ -d "$legacy_release" ]]; then
    rm -rf -- "$legacy_release"
  fi

  docker builder prune --all --force
  docker image prune --all --force
  docker container prune --force
}

if [[ "$previous_release" == "$final_release" ]]; then
  if wait_for_health; then
    printf 'Release %s is already active and healthy. Cleaning residual caches.\n' "$release_sha"
    cleanup_successful_deploy
    compose_for "$final_release" ps
    exit 0
  fi

  printf 'Release %s is already active but unhealthy; refusing to overwrite rollback sources.\n' "$release_sha" >&2
  exit 1
fi

install -d -m 0750 "$release_root" "$incoming_root"
rm -rf -- "$staging_release"
install -d -m 0750 "$staging_release"

if tar -tzf "$artifact" | grep -Eq '(^|/)\.\.(/|$)|^/'; then
  printf 'Unsafe path found in release archive.\n' >&2
  exit 2
fi

tar -xzf "$artifact" -C "$staging_release"
if [[ ! -f "${staging_release}/compose.yaml" || ! -f "${staging_release}/Dockerfile" ]]; then
  printf 'Release archive is incomplete.\n' >&2
  exit 2
fi

ln -sfn "$shared_env" "${staging_release}/.env.production"
rm -rf -- "$final_release"
mv "$staging_release" "$final_release"

printf 'Building release %s.\n' "$release_sha"
if ! compose_for "$final_release" build --pull; then
  rollback "image build"
fi

printf 'Starting release %s.\n' "$release_sha"
if ! compose_for "$final_release" up -d --remove-orphans; then
  rollback "container start or migration"
fi

if ! wait_for_health; then
  compose_for "$final_release" logs --tail=200 app >&2 || true
  rollback "health check"
fi

temporary_link="${project_root}/.current-${release_sha}"
rm -f -- "$temporary_link"
ln -s "$final_release" "$temporary_link"
mv -Tf "$temporary_link" "$current_link"

printf 'Release %s is healthy. Removing caches and previous versions.\n' "$release_sha"
cleanup_successful_deploy
compose_for "$final_release" ps
printf 'Deployment completed: %s\n' "$release_sha"
