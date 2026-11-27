#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/opt/3dprinta
shared="$root/shared"
control="$shared/restore"
flags="$control/flags"
job="${1:-}"
name="${2:-}"
recover=false
if [[ "$job" == --recover ]]; then recover=true; job="$name"; name=''; fi
[[ "$job" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || exit 2
work="$control/work/$job"
candidate="sidzen_restore_${job//-/}"
previous="sidzen_previous_${job//-/}"
release="$(readlink -f "$root/current")"
[[ "$release" == "$root/releases/"* && -f "$release/compose.yaml" ]] || exit 2
export SHOP_IMAGE_TAG="$(basename "$release")" COMPOSE_PARALLEL_LIMIT=1
compose=(docker compose --project-name 3dprinta --env-file "$shared/.env.production" --file "$release/compose.yaml")
if [[ -f "$shared/compose.override.yaml" ]]; then compose+=(--file "$shared/compose.override.yaml"); fi
if [[ -f "$release/.compose-proxy-networks.yaml" ]]; then compose+=(--file "$release/.compose-proxy-networks.yaml"); fi
db=3dprinta-db-1
status_script="$release/scripts/restore-status.py"
phase=preparing

update_status() {
  python3 "$status_script" "$job" "$name" "$1" "$2"
}
set_phase() {
  python3 - "$work/phase" "$1" <<'STATE'
import os, pathlib, sys
target = pathlib.Path(sys.argv[1]); temporary = target.with_suffix('.new')
with open(temporary, 'w', encoding='utf-8') as output:
    output.write(sys.argv[2] + '\n'); output.flush(); os.fsync(output.fileno())
os.replace(temporary, target)
directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(directory)
finally: os.close(directory)
STATE
  phase="$1"
}
set_maintenance() {
  python3 - "$flags" "$1" <<'FLAG'
import os, pathlib, sys
directory = pathlib.Path(sys.argv[1]); flag = directory / 'maintenance'
if sys.argv[2] == 'on':
    with open(flag, 'w') as output:
        os.fchmod(output.fileno(), 0o644); output.flush(); os.fsync(output.fileno())
else:
    flag.unlink(missing_ok=True)
fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(fd)
finally: os.close(fd)
FLAG
}
sql() {
  docker exec -i "$db" psql -X -U 3dprinta -d "$1" -v ON_ERROR_STOP=1 -Atqc "$2" < /dev/null
}
terminate_connections() {
  sql postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('3dprinta','$candidate','$previous') AND pid <> pg_backend_pid()" > /dev/null
}
volume_snapshot() {
  local volume="$1" output="$2"
  docker run --rm --network none --volume "3dprinta_${volume}:/source:ro" alpine:3.20 tar -czf - -C /source . > "$output"
}
volume_restore() {
  local volume="$1" source="$2"
  docker run --rm --network none --volume "3dprinta_${volume}:/target" --volume "$source:/restore.tar.gz:ro" alpine:3.20 \
    sh -ec 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /restore.tar.gz -C /target; sync'
}
start_services() {
  "${compose[@]}" up -d --no-deps --no-build app marketplace-worker < /dev/null
  for attempt in $(seq 1 40); do
    if curl -fsS --connect-timeout 2 --max-time 4 http://127.0.0.1:3000/api/health/ | \
      python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == "ok" and d["database"] == "ok"' 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}
rollback() {
  local saved_phase='' previous_exists='' active_exists='' candidate_exists=''
  [[ ! -f "$work/name" ]] || name="$(< "$work/name")"
  [[ ! -f "$work/phase" ]] || saved_phase="$(< "$work/phase")"
  update_status recovering "$saved_phase"
  if [[ "$saved_phase" == committed ]]; then
    start_services || return 1
    previous_exists="$(sql postgres "SELECT EXISTS (SELECT FROM pg_database WHERE datname = '$previous')")" || return 1
    if [[ "$previous_exists" == t ]]; then sql postgres "DROP DATABASE \"$previous\"" || return 1; fi
    set_maintenance off || return 1
    update_status succeeded complete || return 1
    return
  fi
  if [[ -f "$flags/maintenance" ]]; then
    "${compose[@]}" stop -t 45 app marketplace-worker < /dev/null || return 1
    terminate_connections || return 1
    previous_exists="$(sql postgres "SELECT EXISTS (SELECT FROM pg_database WHERE datname = '$previous')")" || return 1
    active_exists="$(sql postgres "SELECT EXISTS (SELECT FROM pg_database WHERE datname = '3dprinta')")" || return 1
    if [[ "$previous_exists" == t ]]; then
      if [[ "$active_exists" == t ]]; then
        sql postgres 'DROP DATABASE "3dprinta"' || return 1
      fi
      sql postgres "ALTER DATABASE \"$previous\" RENAME TO \"3dprinta\"" || return 1
    fi
    if [[ "$saved_phase" == prepared || "$saved_phase" == swapping || "$saved_phase" == validating ]]; then
      volume_restore model-files "$work/previous-model.tar.gz" || return 1
      volume_restore product-images "$work/previous-products.tar.gz" || return 1
    fi
    start_services || return 1
    set_maintenance off || return 1
  fi
  candidate_exists="$(sql postgres "SELECT EXISTS (SELECT FROM pg_database WHERE datname = '$candidate')")" || return 1
  if [[ "$candidate_exists" == t ]]; then sql postgres "DROP DATABASE \"$candidate\"" || return 1; fi
  update_status failed "${saved_phase:-preparing}" || return 1
}

exec 9>"$root/deploy.lock"
if ! flock -n 9; then
  if [[ "$recover" != true ]]; then update_status failed busy; fi
  exit 1
fi

if [[ "$recover" == true ]]; then
  if [[ ! -d "$work" ]]; then
    if [[ -f "$flags/maintenance" ]]; then update_status attention recovery; exit 1; fi
    update_status failed interrupted
    exit 0
  fi
  if ! rollback; then update_status attention recovery; exit 1; fi
  rm -rf -- "$work"
  exit 0
fi

[[ "$name" =~ ^sidzen-[0-9]{8}T[0-9]{6}Z\.tar\.age$ ]] || exit 2
[[ ! -e "$work" ]] || exit 2
install -d -m 0700 "$control/work" "$work" "$work/archive"
printf '%s\n' "$name" > "$work/name"
set_phase preparing
update_status running preparing
on_error() {
  local result=$?
  trap - ERR
  if [[ "$result" -ne 0 ]]; then
    if rollback; then rm -rf -- "$work"; else update_status attention recovery || true; fi
  fi
  exit "$result"
}
trap on_error ERR

for container in 3dprinta-app-1 3dprinta-marketplace-worker-1; do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" == healthy ]]
done
bash "$release/scripts/stage-backup-restore.sh" "$name" "$work/archive"
sql postgres "CREATE DATABASE \"$candidate\" TEMPLATE template0"
docker exec -i "$db" pg_restore -U 3dprinta --no-owner --no-privileges --exit-on-error -d "$candidate" < "$work/archive/database.dump"

# Apply only repository migrations to the isolated candidate database.
docker exec -e "SIDZEN_RESTORE_DATABASE=$candidate" 3dprinta-marketplace-worker-1 node -e '
const {spawnSync}=require("node:child_process");
const url=new URL(process.env.DATABASE_URL); url.pathname="/"+process.env.SIDZEN_RESTORE_DATABASE;
const run=spawnSync("./node_modules/.bin/prisma",["migrate","deploy"],{stdio:"inherit",env:{...process.env,DATABASE_URL:url.toString()}});
process.exit(run.status ?? 1);'

# The current deployment keeps its infrastructure and encryption keys. A copy
# made with different keys cannot safely decrypt its stored integration data.
tar -xOzf "$work/archive/configuration.tar.gz" opt/3dprinta/shared/.env.production | \
  docker exec -i 3dprinta-marketplace-worker-1 node -e '
const dotenv=require("dotenv"); let s=""; process.stdin.setEncoding("utf8");
process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
const previous=dotenv.parse(s); const a=previous.INTEGRATION_ENCRYPTION_KEY||previous.AUTH_SECRET;
const b=process.env.INTEGRATION_ENCRYPTION_KEY||process.env.AUTH_SECRET;
if(!a||!b||a!==b)process.exit(1);});'

set_phase maintenance
update_status running maintenance
set_maintenance on
[[ "$(curl -sS --resolve sidzen.shop:443:127.0.0.1 --connect-timeout 3 --max-time 8 -o /dev/null -w '%{http_code}' https://sidzen.shop/api/health/)" == 503 ]]
"${compose[@]}" stop -t 45 app marketplace-worker < /dev/null

# Never replay financial/provider side effects whose state has changed since
# the snapshot. These tables include all payment, delivery and message jobs.
for table in Order OrderItem Payment Shipment FiscalReceipt YooKassaSettlement OzonDeliveryJob CdekDeliveryJob FivePostDeliveryJob TelegramOrderJob TelegramOrderStatusJob OrderNotification MarketplaceSyncRun ReviewAiJob ProductCategoryAiJob; do
  query="SELECT md5(COALESCE(string_agg(md5((to_jsonb(t) - 'updatedAt' - 'nextAttemptAt' - 'availableAt' - 'lockedUntil' - 'leaseUntil')::text), '' ORDER BY md5((to_jsonb(t) - 'updatedAt' - 'nextAttemptAt' - 'availableAt' - 'lockedUntil' - 'leaseUntil')::text)), '')) FROM \"$table\" t"
  live_digest="$(sql 3dprinta "$query")"
  backup_digest="$(sql "$candidate" "$query")"
  if [[ "$live_digest" != "$backup_digest" ]]; then
    set_phase external_changes
    printf 'Payment, order or delivery data changed after the selected backup.\n' >&2
    false
  fi
done
integration_query="SELECT md5(COALESCE(string_agg(md5(jsonb_build_object('key', t.key, 'value', t.value)::text), '' ORDER BY t.key), '')) FROM \"SiteSetting\" t WHERE (t.key LIKE 'integrations.%' AND t.key NOT LIKE 'integrations.fivepost-token.%') OR t.key IN ('notifications.telegram.orders', 'notifications.smtp.spaceweb', 'catalog.category-ai.deepseek', 'reviews.deepseek.moderation')"
live_digest="$(sql 3dprinta "$integration_query")"
backup_digest="$(sql "$candidate" "$integration_query")"
if [[ "$live_digest" != "$backup_digest" ]]; then
  set_phase external_changes
  printf 'Integration settings changed after the selected backup.\n' >&2
  false
fi
uncertain_query="SELECT (EXISTS (SELECT FROM \"Payment\" WHERE status IN ('PENDING','AUTHORIZED') AND payload IS NOT NULL AND \"externalId\" IS NULL) OR EXISTS (SELECT FROM \"FiscalReceipt\" WHERE status IN ('SENDING','QUEUED') OR (status='PENDING' AND attempts>0)) OR EXISTS (SELECT FROM \"YooKassaSettlement\" WHERE status IN ('SENDING','QUEUED') OR (status='PENDING' AND attempts>0)) OR EXISTS (SELECT FROM \"OzonDeliveryJob\" WHERE (status='PENDING' AND attempts>0) OR (\"cancelRequestedAt\" IS NOT NULL AND status <> 'CANCELED')) OR EXISTS (SELECT FROM \"CdekDeliveryJob\" WHERE status IN ('SENDING','CANCELING','ACCEPTED') OR (status='PENDING' AND attempts>0)) OR EXISTS (SELECT FROM \"FivePostDeliveryJob\" WHERE status IN ('SENDING','CANCELING') OR (status='PENDING' AND attempts>0)) OR EXISTS (SELECT FROM \"TelegramOrderJob\" WHERE status IN ('RUNNING','UNCERTAIN')) OR EXISTS (SELECT FROM \"TelegramOrderStatusJob\" WHERE status IN ('RUNNING','UNCERTAIN')) OR EXISTS (SELECT FROM \"MarketplaceSyncRun\" WHERE status='RUNNING') OR EXISTS (SELECT FROM \"ReviewAiJob\" WHERE status='RUNNING') OR EXISTS (SELECT FROM \"ProductCategoryAiJob\" WHERE status='RUNNING'))"
if [[ "$(sql 3dprinta "$uncertain_query")" != f ]]; then
  set_phase external_changes
  printf 'An external operation has an unresolved result.\n' >&2
  false
fi

# Keep a verified off-site copy of the exact pre-restore state before touching it.
bash "$release/scripts/backup.sh"
exec 8>/var/backups/3dprinta/.backup.lock
flock -n 8
volume_snapshot model-files "$work/previous-model.tar.gz"
volume_snapshot product-images "$work/previous-products.tar.gz"
sync -f "$work/previous-model.tar.gz"
sync -f "$work/previous-products.tar.gz"
set_phase prepared
update_status running switching
terminate_connections
set_phase swapping
sql postgres "ALTER DATABASE \"3dprinta\" RENAME TO \"$previous\""
sql postgres "ALTER DATABASE \"$candidate\" RENAME TO \"3dprinta\""
volume_restore model-files "$work/archive/model-files.tar.gz"
volume_restore product-images "$work/archive/product-images.tar.gz"
set_phase validating

# The independent privacy ledger is always the current one, never the archived
# copy. Replay it with the store offline before accepting any traffic.
"${compose[@]}" run --rm --no-deps --entrypoint ./node_modules/.bin/tsx marketplace-worker \
  scripts/replay-privacy-erasures.ts --confirm-offline-restore < /dev/null
start_services
set_phase committed
sql postgres "DROP DATABASE \"$previous\""
set_maintenance off
update_status succeeded complete
rm -rf -- "$work"
printf 'Restore completed.\n'
