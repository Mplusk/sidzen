#!/usr/bin/env bash
# One-time base provisioning is idempotent and runs from the CI deploy job.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { printf 'Root is required for Docker provisioning.\n' >&2; exit 2; }
if ! command -v docker > /dev/null; then
  . /etc/os-release
  [[ "$ID" == ubuntu && "${VERSION_CODENAME:-}" == noble ]] || { printf 'Expected Ubuntu 24.04.\n' >&2; exit 2; }
  export DEBIAN_FRONTEND=noninteractive
  export NEEDRESTART_MODE=l
  apt-get update
  apt-get install -y ca-certificates curl
  install -d -m 0755 /etc/apt/keyrings /etc/docker
  curl --fail --silent --show-error --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  if [[ ! -e /etc/docker/daemon.json ]]; then
    printf '%s\n' '{"log-driver":"local","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
  fi
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker version --format '{{.Server.Version}}'
docker compose version
