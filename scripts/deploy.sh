#!/usr/bin/env bash
set -euo pipefail

revision="${1:?Pass the commit SHA to deploy}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }

cd /opt/HOD
test -f .env || { echo 'Missing /opt/HOD/.env' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo 'Tracked files were edited on the server; refusing to overwrite them' >&2
  exit 1
}

docker image prune --all --force

git fetch origin main
latest="$(git rev-parse FETCH_HEAD)"
if [[ "$revision" != "$latest" ]]; then
  echo "Skipping outdated commit $revision; main is now $latest"
  exit 0
fi

git checkout main
git pull --ff-only origin main
[[ "$(git rev-parse HEAD)" == "$revision" ]] || {
  echo 'Checked out revision does not match the requested revision' >&2
  exit 1
}

docker compose config --quiet
if ! docker compose --parallel 1 up -d --build; then
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
    docker image prune --all --force
    docker builder prune --force --filter 'until=168h'
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
