#!/usr/bin/env bash
# This test provisions an entirely separate store on a disposable CI runner.
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${CI_RESTORE_ISOLATED:-}" == true && "$(id -u)" == 0 ]]
[[ ! -e /opt/3dprinta && -z "$(docker ps -aq --filter label=com.docker.compose.project=3dprinta)" ]]

repository="${GITHUB_WORKSPACE:?}"
revision="$(git -c "safe.directory=$repository" -C "$repository" rev-parse HEAD)"
root=/opt/3dprinta
release="$root/releases/$revision"
remote=/opt/sidzen-restore-fixture-remote
install -d -m 0755 "$release" "$root/shared" "$root/incoming" "$root/shared/restore/flags" "$root/shared/restore/api" "$remote" /var/backups/3dprinta /tmp/sidzen-restore-bin
git -c "safe.directory=$repository" -C "$repository" archive HEAD | tar -xf - -C "$release"
ln -s "$release" "$root/current"
cat > "$root/shared/.env.production" <<'ENVIRONMENT'
POSTGRES_PASSWORD=isolated-test-password
DATABASE_URL=postgresql://3dprinta:isolated-test-password@db:5432/3dprinta
AUTH_SECRET=isolated-test-secret
INTEGRATION_ENCRYPTION_KEY=isolated-test-encryption-key
NEXT_PUBLIC_SITE_URL=https://sidzen.shop
PERSONAL_DATA_RF_STORAGE_CONFIRMED=true
ENVIRONMENT
chmod 0600 "$root/shared/.env.production"
ln -s "$root/shared/.env.production" "$release/.env.production"
install -d -m 0700 "$root/shared/backup"
age-keygen -o "$root/shared/backup/restore.agekey" > /dev/null 2>&1
age-keygen -y "$root/shared/backup/restore.agekey" > "$root/shared/backup/age.recipient"
printf '[sidzen-backup]\ntype = local\n' > "$root/shared/backup/yandex-rclone.conf"
printf 'sidzen-backup:%s\n' "$remote" > "$root/shared/backup/remote-path"

python3 - "$release/deploy/caddy/Caddyfile" "$root/shared/restore/Caddyfile" <<'CADDY'
from pathlib import Path
import sys
site = Path(sys.argv[1]).read_text().split('\nwww.sidzen.shop {', 1)[0]
assert site.startswith('sidzen.shop {')
Path(sys.argv[2]).write_text(site.replace('sidzen.shop {', ':8080 {', 1) + '\n')
CADDY
cat > "$release/compose.yaml" <<'COMPOSE'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: 3dprinta
      POSTGRES_DB: 3dprinta
      POSTGRES_PASSWORD: isolated-test-password
    volumes:
      - postgres-data:/var/lib/postgresql/data
  app:
    image: node:22-alpine
    command: ["node", "-e", "require('http').createServer((q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({status:'ok',database:'ok'}))}).listen(3000,'0.0.0.0')"]
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - model-files:/app/private-uploads
      - product-images:/app/public/uploads/products
      - privacy-ledger:/app/privacy-ledger
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)})"]
      interval: 2s
      timeout: 3s
      retries: 20
  marketplace-worker:
    image: sidzen-restore-qa:latest
    env_file: .env.production
    command: ["sleep", "infinity"]
    volumes:
      - model-files:/app/private-uploads
      - product-images:/app/public/uploads/products
      - privacy-ledger:/app/privacy-ledger
    healthcheck:
      test: ["CMD", "true"]
      interval: 2s
      timeout: 3s
      retries: 20
  proxy:
    image: caddy:2-alpine
    ports: ["127.0.0.1:18080:8080"]
    volumes:
      - /opt/3dprinta/shared/restore/Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/3dprinta/shared/restore/flags:/run/sidzen-restore:ro
volumes:
  postgres-data:
  model-files:
  product-images:
  privacy-ledger:
COMPOSE
cat > /tmp/sidzen-restore-bin/curl <<'CURL'
#!/usr/bin/env bash
if [[ "$*" == *'--resolve sidzen.shop:443:127.0.0.1'* ]]; then
  exec /usr/bin/curl -sS --connect-timeout 3 --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/health/
fi
exec /usr/bin/curl "$@"
CURL
cat > /tmp/sidzen-restore-bin/docker <<'DOCKER'
#!/usr/bin/env bash
if [[ -f /tmp/sidzen-restore-fail-replay && "$*" == *'scripts/replay-privacy-erasures.ts'* ]]; then
  rm -f /tmp/sidzen-restore-fail-replay
  exit 1
fi
if [[ -f /tmp/sidzen-restore-kill-after-swap && "$*" == *'3dprinta_model-files:/target'* ]]; then
  rm -f /tmp/sidzen-restore-kill-after-swap
  /usr/bin/docker "$@"
  kill -KILL "$PPID"
  exit 1
fi
exec /usr/bin/docker "$@"
DOCKER
chmod 0755 /tmp/sidzen-restore-bin/curl /tmp/sidzen-restore-bin/docker
export PATH="/tmp/sidzen-restore-bin:$PATH"
cd "$release"
compose=(docker compose --project-name 3dprinta --env-file .env.production --file compose.yaml)
"${compose[@]}" up -d db
ready=false
for attempt in $(seq 1 60); do
  if docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -Atqc 'SELECT 1' >/dev/null 2>&1; then
    sleep 3
    if docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -Atqc 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  fi
  sleep 1
done
[[ "$ready" == true ]]
"${compose[@]}" run --rm --no-deps --entrypoint ./node_modules/.bin/prisma marketplace-worker migrate deploy
"${compose[@]}" up -d --wait --wait-timeout 90 app marketplace-worker proxy
docker run --rm --volume 3dprinta_privacy-ledger:/data alpine:3.20 sh -c 'chown 1001:1001 /data; chmod 0700 /data'
docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -v ON_ERROR_STOP=1 -c \
  "INSERT INTO \"Product\" (id,name,slug,sku,\"basePrice\",\"updatedAt\") VALUES ('fixture','snapshot','fixture','fixture',100,now())"
docker run --rm --volume 3dprinta_model-files:/data alpine:3.20 sh -c 'printf snapshot > /data/fixture.txt'
bash "$release/scripts/backup.sh"
source_backup="$(find "$remote" -maxdepth 1 -type f -name 'sidzen-*.tar.age' -printf '%f\n' | head -1)"
[[ -n "$source_backup" ]]
[[ -s "$remote/$source_backup.hmac" ]]
rm -f -- "$remote/$source_backup.hmac"
python3 "$release/scripts/attest-existing-backups.py"
[[ -s "$remote/$source_backup.hmac" ]]
printf 'PASS: an older encrypted copy was authenticated against its local original.\n'
tampered=sidzen-20000101T000000Z.tar.age
cp "$remote/$source_backup" "$remote/$tampered"
cp "$remote/$source_backup.hmac" "$remote/$tampered.hmac"
printf 'tampered' >> "$remote/$tampered"
install -d -m 0700 "$root/shared/restore/tampered-test"
if bash "$release/scripts/stage-backup-restore.sh" "$tampered" "$root/shared/restore/tampered-test"; then
  printf 'Tampered encrypted backup was unexpectedly accepted.\n' >&2
  exit 1
fi
[[ -z "$(ls -A "$root/shared/restore/tampered-test")" ]]
rm -f -- "$remote/$tampered" "$remote/$tampered.hmac"
printf 'PASS: a modified encrypted archive was rejected before extraction.\n'
sleep 2

set_fixture() {
  docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -v ON_ERROR_STOP=1 -c "UPDATE \"Product\" SET name='$1' WHERE id='fixture'" > /dev/null
  docker run --rm --volume 3dprinta_model-files:/data alpine:3.20 sh -c "printf '%s' '$1' > /data/fixture.txt"
}
assert_fixture() {
  [[ "$(docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -Atqc "SELECT name FROM \"Product\" WHERE id='fixture'")" == "$1" ]]
  [[ "$(docker run --rm --volume 3dprinta_model-files:/data:ro alpine:3.20 cat /data/fixture.txt)" == "$1" ]]
  [[ ! -e "$root/shared/restore/flags/maintenance" ]]
}

set_fixture before_rollback_test
touch /tmp/sidzen-restore-fail-replay
if bash "$release/scripts/restore-production.sh" "$(cat /proc/sys/kernel/random/uuid)" "$source_backup"; then
  printf 'Restore unexpectedly succeeded after the injected replay failure.\n' >&2
  exit 1
fi
[[ ! -f /tmp/sidzen-restore-fail-replay ]]
python3 -c 'import json; s=json.load(open("/opt/3dprinta/shared/restore/status.json")); assert s["status"] == "failed" and s["phase"] == "validating"'
assert_fixture before_rollback_test
printf 'PASS: failure after switching restores the previous database and uploaded files.\n'

install -m 0644 "$release/deploy/sidzen-restore-control.service" /etc/systemd/system/sidzen-restore-control.service
systemctl daemon-reload
systemctl set-environment PATH="$PATH"
systemctl start sidzen-restore-control.service
for attempt in $(seq 1 20); do [[ -S "$root/shared/restore/api/control.sock" ]] && break; sleep 1; done
start_controlled_restore() {
  python3 - "$source_backup" <<'CONTROL'
import json, socket, sys, uuid
path = '/opt/3dprinta/shared/restore/api/control.sock'
def request(data):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(45); connection.connect(path)
        connection.sendall(json.dumps(data).encode() + b'\n')
        answer = b''
        while not answer.endswith(b'\n'):
            block = connection.recv(65536)
            if not block: raise RuntimeError('Missing controller response')
            answer += block
        return json.loads(answer)
listing = request({'action': 'list'})
assert any(item['name'] == sys.argv[1] for item in listing['backups'])
assert request({'action': 'start', 'id': str(uuid.uuid4()), 'name': '../../etc/passwd'})['error'] == 'invalid'
result = request({'action': 'start', 'id': str(uuid.uuid4()), 'name': sys.argv[1]})
assert result['status'] == 'queued', result
CONTROL
}
wait_for_restore() {
  for attempt in $(seq 1 160); do
    result="$(python3 -c 'import json; print(json.load(open("/opt/3dprinta/shared/restore/status.json"))["status"])')"
    [[ "$result" == succeeded || "$result" == failed || "$result" == attention ]] && return
    sleep 3
  done
  return 1
}

sleep 2
set_fixture before_interruption_test
touch /tmp/sidzen-restore-kill-after-swap
start_controlled_restore
wait_for_restore
[[ "$result" == failed && ! -e /tmp/sidzen-restore-kill-after-swap ]]
python3 -c 'import json; s=json.load(open("/opt/3dprinta/shared/restore/status.json")); assert s["phase"] == "swapping"'
assert_fixture before_interruption_test
printf 'PASS: an interrupted restore is rolled back after the controller restarts it.\n'

sleep 2
start_controlled_restore
wait_for_restore
[[ "$result" == succeeded ]]
assert_fixture snapshot
printf 'PASS: controller restored the database and files from the encrypted test backup.\n'

docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -v ON_ERROR_STOP=1 -c \
  "INSERT INTO \"User\" (id,email,\"passwordHash\",\"updatedAt\") VALUES ('fixture-admin','admin@example.test','test-hash',now()); INSERT INTO \"Role\" (id,code,name) VALUES ('fixture-admin-role','superadmin','Test') ON CONFLICT (code) DO NOTHING; INSERT INTO \"UserRole\" (\"userId\",\"roleId\") SELECT 'fixture-admin',id FROM \"Role\" WHERE code='superadmin'" > /dev/null
set_fixture preserve_admin
if bash "$release/scripts/restore-production.sh" "$(cat /proc/sys/kernel/random/uuid)" "$source_backup"; then
  printf 'Restore unexpectedly accepted changed administrator access.\n' >&2
  exit 1
fi
python3 -c 'import json; s=json.load(open("/opt/3dprinta/shared/restore/status.json")); assert s["status"] == "failed" and s["phase"] == "admin_changes"'
assert_fixture preserve_admin
[[ "$(docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -Atqc "SELECT count(*) FROM \"User\" WHERE id='fixture-admin'")" == 1 ]]
docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -v ON_ERROR_STOP=1 -c "DELETE FROM \"User\" WHERE id='fixture-admin'" > /dev/null
printf 'PASS: changed administrator access stops the restore without losing current data.\n'

docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -v ON_ERROR_STOP=1 -c \
  "INSERT INTO \"Order\" (id,number,\"customerName\",\"customerEmail\",\"customerPhone\",subtotal,total,\"updatedAt\") VALUES ('fixture-order','fixture-order','Test','qa@example.test','',1,1,now())" > /dev/null
set_fixture do_not_replace
if bash "$release/scripts/restore-production.sh" "$(cat /proc/sys/kernel/random/uuid)" "$source_backup"; then
  printf 'Restore unexpectedly accepted changed order data.\n' >&2
  exit 1
fi
python3 -c 'import json; s=json.load(open("/opt/3dprinta/shared/restore/status.json")); assert s["status"] == "failed" and s["phase"] == "external_changes"'
assert_fixture do_not_replace
[[ "$(docker exec 3dprinta-db-1 psql -U 3dprinta -d 3dprinta -Atqc "SELECT count(*) FROM \"Order\" WHERE id='fixture-order'")" == 1 ]]
printf 'PASS: changed orders stop the restore without losing current data.\n'
