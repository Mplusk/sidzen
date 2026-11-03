#!/usr/bin/env bash
set -Eeuo pipefail

release_sha="${1:-}"
project_root="/opt/3dprinta"
release_root="${project_root}/releases"
incoming_root="${project_root}/incoming"
shared_env="${project_root}/shared/.env.production"
current_link="${project_root}/current"
backup_entrypoint="/usr/local/sbin/3dprinta-backup"
artifact="${incoming_root}/${release_sha}.tar.gz"
staging_release="${release_root}/${release_sha}.staging"
final_release="${release_root}/${release_sha}"
compose_project="3dprinta"
health_url="http://127.0.0.1:3000/api/health/"
nginx_alias_target="/etc/nginx/conf.d/sidzen-idn.conf"
nginx_alias_state=""
nginx_alias_committed=false

cleanup_nginx_alias() {
  if [[ -n "$nginx_alias_state" && -d "$nginx_alias_state" ]]; then
    if [[ "$nginx_alias_committed" != true && -f "$nginx_alias_state/changed" ]]; then
      if ! bash "${final_release}/scripts/nginx-shop-idn.sh" restore "${final_release}/deploy/nginx/ispmanager-sidzen-idn.conf" "$nginx_alias_target" "" "$nginx_alias_state"; then
        printf 'Nginx alias rollback requires operator attention; backup retained at %s.\n' "$nginx_alias_state" >&2
        return
      fi
    fi
    rm -r -- "$nginx_alias_state"
  fi
}
trap cleanup_nginx_alias EXIT

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
  local overlay=()
  if [[ -f "${project_root}/shared/compose.override.yaml" ]]; then
    overlay+=(--file "${project_root}/shared/compose.override.yaml")
  fi
  if [[ -f "${release_dir}/.compose-proxy-networks.yaml" ]]; then
    overlay+=(--file "${release_dir}/.compose-proxy-networks.yaml")
  fi
  # CI streams this script into `bash -s` over SSH. Compose run otherwise
  # consumes the remaining script through stdin and bash exits successfully
  # before starting containers or activating the release.
  SHOP_IMAGE_TAG="$(basename "$release_dir")" COMPOSE_PARALLEL_LIMIT=1 docker compose \
    --project-name "$compose_project" \
    --env-file "$shared_env" \
    --file "${release_dir}/compose.yaml" \
    "${overlay[@]}" \
    "${@:2}" < /dev/null
}

rollback() {
  local reason="$1"
  printf 'Deployment failed during %s.\n' "$reason" >&2

  if [[ -n "$previous_release" && -f "${previous_release}/compose.yaml" ]]; then
    printf 'Rolling back to %s.\n' "$previous_release" >&2
    ln -sfn "$shared_env" "${previous_release}/.env.production"
    python3 "${final_release}/scripts/preserve-proxy-config.py" "$final_release" "$previous_release"
    if [[ "${DEPLOY_PREBUILT_IMAGES:-false}" != true ]]; then
      compose_for "$previous_release" build
    fi
    compose_for "$previous_release" up -d --no-build --remove-orphans
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
  local current_image_ids
  current_image_ids="$(release_image_ids "$final_release")"

  while IFS= read -r -d '' old_release; do
    rm -rf -- "$old_release"
  done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d ! -name "$release_sha" -print0)

  find "$incoming_root" -mindepth 1 -maxdepth 1 -type f -name '*.tar.gz' -delete

  # The host also serves other projects. Never globally delete their stopped
  # containers, rollback images or shared build caches. Old shop runtime caches
  # disappear with the replaced containers/releases; prune only our images.
  docker container prune --force --filter label=com.docker.compose.project=3dprinta
  cleanup_unused_shop_images "$current_image_ids"
}

release_image_ids() {
  local release_dir="$1"
  local service_image
  for service_image in app migrate marketplace-worker; do
    docker image inspect --format '{{.Id}}' "3dprinta-${service_image}:$(basename "$release_dir")" 2>/dev/null || true
  done
}

cleanup_unused_shop_images() {
  local protected_ids="$1"
  local old_image
  # Include orphaned migrators and failed releases, not just images that had
  # containers before this deploy. Keep rollback images and ALL used images.
  while IFS= read -r old_image; do
    if [[ -n "$old_image" ]] && ! grep -Fxq "$old_image" <<< "$protected_ids" && [[ -z "$(docker ps -aq --filter "ancestor=$old_image")" ]]; then
      # Registry and local release tags can refer to the same unused image.
      # Remove only this shop's tags; never force-remove another project's tag.
      while IFS= read -r reference; do
        case "$reference" in
          3dprinta-app:*|3dprinta-migrate:*|3dprinta-marketplace-worker:*|ghcr.io/cossomoj/sidzen-app:*|ghcr.io/cossomoj/sidzen-migrate:*|ghcr.io/cossomoj/sidzen-marketplace-worker:*) docker image rm "$reference" || true ;;
        esac
      done < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$old_image" 2>/dev/null || true)
      docker image rm "$old_image" || true
    fi
  done < <(docker image ls --quiet --no-trunc --filter label=com.3dprinta.project=shop | sort -u)
}

require_disk_space() {
  local required_kb="$1"
  local available_kb
  available_kb="$(df -Pk "$project_root" | awk 'NR == 2 { print $4 }')"
  if [[ "$available_kb" -lt "$required_kb" ]]; then
    printf 'Insufficient disk space: %s KiB available, %s KiB needed. Existing shop containers remain unchanged.\n' "$available_kb" "$required_kb" >&2
    exit 1
  fi
}

verify_backup_entrypoint() {
  local release_dir="${1:-$final_release}"
  local backup_script="${current_link}/scripts/backup.sh"

  if [[ ! -x "${release_dir}/scripts/backup.sh" ]]; then
    printf 'Release backup script is missing or not executable.\n' >&2
    return 1
  fi

  if [[ ! -L "$backup_entrypoint" || "$(readlink "$backup_entrypoint")" != "$backup_script" || ( -n "$previous_release" && ! -x "$backup_entrypoint" ) ]]; then
    printf 'Backup cron entrypoint must be provisioned by root as a symlink to %s.\n' "$backup_script" >&2
    return 1
  fi
}

if [[ "$previous_release" == "$final_release" ]]; then
  if wait_for_health; then
    printf 'Release %s is already active and healthy. Cleaning residual caches.\n' "$release_sha"
    verify_backup_entrypoint
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
if [[ ! -f "${staging_release}/compose.yaml" || ! -f "${staging_release}/Dockerfile" || ! -x "${staging_release}/scripts/backup.sh" ]]; then
  printf 'Release archive is incomplete.\n' >&2
  exit 2
fi

if ! verify_backup_entrypoint "$staging_release"; then
  exit 2
fi

ln -sfn "$shared_env" "${staging_release}/.env.production"
rm -rf -- "$final_release"
mv "$staging_release" "$final_release"

python3 "${final_release}/scripts/preserve-proxy-config.py" "$previous_release" "$final_release"

if [[ "${DEPLOY_PREBUILT_IMAGES:-false}" == true ]]; then
  image_artifact="${incoming_root}/${release_sha}.images.tar.gz"
  if [[ "${DEPLOY_REQUIRE_LOCAL_IMAGES:-false}" != true && ! -f "$image_artifact" ]]; then
    printf 'Prebuilt image archive is missing.\n' >&2
    exit 2
  fi
  cleanup_unused_shop_images "$(release_image_ids "$previous_release"; release_image_ids "$final_release")"
  images_present=true
  for service_image in app migrate marketplace-worker; do
    if ! docker image inspect "3dprinta-${service_image}:${release_sha}" > /dev/null 2>&1; then images_present=false; fi
  done
  if [[ "${DEPLOY_REQUIRE_LOCAL_IMAGES:-false}" == true && "$images_present" != true ]]; then
    printf 'Registry release is missing a verified local image.\n' >&2
    exit 2
  fi
  if [[ "$images_present" != true ]]; then
    # Docker stores unpacked layers and compressed blobs. Reserve room for both
    # plus database writes BEFORE loading images or touching working containers.
    # OCI archives can contain compressed blobs inside the outer gzip archive.
    # Counting the outer tar alone underestimates their unpacked filesystem size.
    image_storage_bytes="$(python3 "${final_release}/scripts/estimate-image-space.py" "$image_artifact")"
    require_disk_space "$(( (image_storage_bytes + 1023) / 1024 + 524288 ))"
  fi
  if [[ "$images_present" != true ]] && ! (gzip -dc "$image_artifact" | docker image load); then
    rollback "prebuilt image import"
  fi
  require_disk_space 524288
  for service_image in app migrate marketplace-worker; do
    if ! docker image inspect "3dprinta-${service_image}:${release_sha}" > /dev/null 2>&1; then
      rollback "missing immutable image"
    fi
  done
else
  printf 'Building release %s.\n' "$release_sha"
  if ! compose_for "$final_release" build; then
    rollback "image build"
  fi
fi

printf 'Starting release %s.\n' "$release_sha"
if ! compose_for "$final_release" run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  rollback "proxy configuration validation"
fi
if [[ -f /etc/nginx/conf.d/3dprinta-shop.conf ]]; then
  nginx_alias_state="$(mktemp -d "${incoming_root}/.nginx-alias.XXXXXX")"
  if ! bash "${final_release}/scripts/nginx-shop-idn.sh" apply "${final_release}/deploy/nginx/ispmanager-sidzen-idn.conf" "$nginx_alias_target" "${previous_release}/deploy/nginx/ispmanager-sidzen-idn.conf" "$nginx_alias_state"; then
    rollback "Nginx alias configuration"
  fi
fi
if ! compose_for "$final_release" up -d --no-build --remove-orphans; then
  rollback "container start or migration"
fi

if ! wait_for_health; then
  compose_for "$final_release" logs --tail=200 app >&2 || true
  rollback "health check"
fi

worker_id="$(compose_for "$final_release" ps -q marketplace-worker)"
worker_healthy=false
for attempt in $(seq 1 20); do
  if [[ -n "$worker_id" && "$(docker inspect --format '{{.State.Health.Status}}' "$worker_id")" == "healthy" ]]; then
    worker_healthy=true
    break
  fi
  sleep 3
done
if [[ "$worker_healthy" != true ]]; then
  compose_for "$final_release" logs --tail=100 marketplace-worker >&2 || true
  rollback "marketplace worker health check"
fi

if ! verify_backup_entrypoint; then
  rollback "backup cron entrypoint check"
fi

temporary_link="${project_root}/.current-${release_sha}"
if ! (rm -f -- "$temporary_link" && ln -s "$final_release" "$temporary_link" && mv -Tf "$temporary_link" "$current_link"); then
  rollback "current release switch"
fi
nginx_alias_committed=true

printf 'Release %s is healthy. Removing caches and previous versions.\n' "$release_sha"
cleanup_successful_deploy
compose_for "$final_release" ps
printf 'Deployment completed: %s\n' "$release_sha"
