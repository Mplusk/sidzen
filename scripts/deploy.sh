#!/usr/bin/env bash
set -Eeuo pipefail

project_root="/opt/3dprinta"
release_sha="$(git rev-parse HEAD)"
archive="${project_root}/incoming/${release_sha}.tar.gz"

install -d -m 0750 "${project_root}/incoming"
git archive --format=tar.gz --output="$archive" "$release_sha"
exec bash scripts/deploy-release.sh "$release_sha"
