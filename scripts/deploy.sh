#!/usr/bin/env bash
set -euo pipefail

revision="${1:?Pass the commit SHA to deploy}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
image_archive="${2:?Pass the image archive path to deploy}"
expected_archive="/tmp/hod-images-${revision}.tar.gz"
[[ "$image_archive" == "$expected_archive" ]] || {
  echo 'Invalid image archive path' >&2
  exit 1
}
test -s "$image_archive" || { echo 'Missing Docker image archive' >&2; exit 1; }
trap 'rm -f -- "$image_archive"' EXIT

cd /opt/HOD
test -f .env || { echo 'Missing /opt/HOD/.env' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo 'Tracked files were edited on the server; refusing to overwrite them' >&2
  exit 1
}

docker image prune --all --force
docker builder prune --all --force

git fetch origin main
latest="$(git rev-parse FETCH_HEAD)"
if [[ "$revision" != "$latest" ]]; then
  echo "Skipping outdated commit $revision; main is now $latest"
  exit 0
fi

git checkout --detach "$revision"
docker load --input "$image_archive"
docker compose config --quiet
if ! docker compose --parallel 1 up -d --no-build; then
  docker compose ps --all
  docker compose logs --tail=100 migrate backend worker nginx
  exit 1
fi

for attempt in {1..30}; do
  worker_id="$(docker compose ps -q worker)"
  if curl --fail --silent http://127.0.0.1:8080/health/ready >/dev/null \
    && curl --fail --silent http://127.0.0.1:8080/ >/dev/null \
    && [[ -n "$worker_id" ]] \
    && [[ "$(docker inspect -f '{{.State.Running}}' "$worker_id")" == true ]]; then
    docker compose ps --all
    echo "Deployed $revision"
    exit 0
  fi
  sleep 5
done

docker compose ps --all
docker compose logs --tail=100 migrate backend worker nginx
echo 'Deployment did not become ready' >&2
exit 1
