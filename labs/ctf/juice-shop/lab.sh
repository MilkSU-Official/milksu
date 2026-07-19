#!/bin/sh

set -eu

LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$LAB_DIR/compose.yaml"
PROJECT_NAME=milksu-ctf-juice-shop
PORT=${MILKSU_CTF_PORT:-3000}

case "$PORT" in
  ''|*[!0-9]*)
    echo "MILKSU_CTF_PORT must be a numeric local port" >&2
    exit 2
    ;;
esac

if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "MILKSU_CTF_PORT must be between 1024 and 65535" >&2
  exit 2
fi

BASE_URL="http://127.0.0.1:$PORT"

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 2
  fi
}

usage() {
  cat <<'EOF'
Usage: ./lab.sh <pull|start|stop|reset|status|logs|health|judge> [challenge]

Commands:
  pull               Download the pinned multi-architecture image.
  start              Start the lab and wait for its health check.
  stop               Stop the lab without discarding challenge state.
  reset              Discard challenge state and start a clean lab.
  status             Show the local container status.
  logs               Follow container logs.
  health             Check only the loopback target.
  judge [challenge]  Exit 0 if a named Juice Shop challenge is solved.

Default challenge: Confidential Document
EOF
}

command=${1:-}

case "$command" in
  pull)
    require docker
    compose pull
    ;;
  start)
    require docker
    compose up --detach --wait --wait-timeout 120 --pull never
    printf 'Juice Shop is ready at %s\n' "$BASE_URL"
    ;;
  stop)
    require docker
    compose stop
    ;;
  reset)
    require docker
    compose down --volumes --remove-orphans
    compose up --detach --wait --wait-timeout 120 --pull never
    printf 'Juice Shop was reset at %s\n' "$BASE_URL"
    ;;
  status)
    require docker
    compose ps --all
    ;;
  logs)
    require docker
    compose logs --follow
    ;;
  health)
    require curl
    curl --fail --silent --show-error --output /dev/null "$BASE_URL/"
    printf 'healthy: %s\n' "$BASE_URL"
    ;;
  judge)
    require curl
    require jq
    challenge=${2:-Confidential Document}
    response=$(curl --fail --silent --show-error "$BASE_URL/api/Challenges/")
    match=$(printf '%s' "$response" | jq --compact-output --arg name "$challenge" \
      '.data[] | select(.name == $name)' | head -n 1)

    if [ -z "$match" ]; then
      printf 'unknown challenge: %s\n' "$challenge" >&2
      exit 2
    fi

    if [ "$(printf '%s' "$match" | jq --raw-output '.solved')" = "true" ]; then
      printf 'solved: %s\n' "$challenge"
      exit 0
    fi

    printf 'not solved: %s\n' "$challenge"
    exit 1
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
