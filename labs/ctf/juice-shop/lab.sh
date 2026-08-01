#!/bin/sh

set -eu

LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$LAB_DIR/compose.yaml"
PROJECT_NAME=${MILKSU_LAB_PROJECT_ID:-milksu-ctf-juice-shop}
PORT=${MILKSU_CTF_PORT:-3000}

case "$PROJECT_NAME" in
  ''|*[!a-z0-9_-]*)
    echo "MILKSU_LAB_PROJECT_ID must contain only lowercase letters, digits, underscores, and hyphens" >&2
    exit 2
    ;;
esac

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
Usage: ./lab.sh <pull|start|stop|reset|clean|status|logs|health|judge> [challenge]

Commands:
  pull               Download the pinned multi-architecture image.
  start              Start the lab and wait for its health check.
  stop               Stop the lab without discarding challenge state.
  reset              Discard challenge state and start a clean lab.
  clean              Remove the lab container, network and local volumes.
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
  clean)
    require docker
    compose down --volumes --remove-orphans
    ;;
  status)
    require docker
    if [ -z "$(compose ps --status running --quiet)" ]; then
      echo "managed lab project has no running containers" >&2
      exit 1
    fi
    compose ps --all
    ;;
  logs)
    require docker
    compose logs --follow
    ;;
  health)
    require docker
    if [ -z "$(compose ps --status running --quiet)" ]; then
      echo "managed lab project has no running containers" >&2
      exit 1
    fi
    require curl
    curl --fail --silent --show-error --output /dev/null "$BASE_URL/"
    printf 'healthy: %s\n' "$BASE_URL"
    ;;
  judge)
    challenge=${2:-Confidential Document}
    require docker
    compose exec --no-TTY juice-shop /nodejs/bin/node -e '
      const challengeName = process.argv[1];
      (async () => {
        const response = await fetch("http://127.0.0.1:3000/api/Challenges/");
        if (!response.ok) throw new Error(`judge endpoint returned ${response.status}`);
        const payload = await response.json();
        const challenge = payload.data.find((item) => item.name === challengeName);
        if (!challenge) {
          console.error(`unknown challenge: ${challengeName}`);
          process.exit(2);
        }
        if (challenge.solved === true) {
          console.log(`solved: ${challengeName}`);
          process.exit(0);
        }
        console.log(`not solved: ${challengeName}`);
        process.exit(1);
      })().catch((error) => {
        console.error(error.message);
        process.exit(2);
      });
    ' "$challenge"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
