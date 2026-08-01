#!/bin/sh

set -eu

LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$LAB_DIR/compose.yaml"
PROJECT_NAME=${MILKSU_LAB_PROJECT_ID:-milksu-ctf-webgoat}
PORT=${MILKSU_CTF_PORT:-3000}
STATE_DIR=${MILKSU_LAB_STATE_DIR:-}

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

case "$STATE_DIR" in
  /*) ;;
  *)
    echo "MILKSU_LAB_STATE_DIR must be an absolute private directory" >&2
    exit 2
    ;;
esac

if [ ! -d "$STATE_DIR" ] || [ -L "$STATE_DIR" ]; then
  echo "MILKSU_LAB_STATE_DIR is not a usable private directory" >&2
  exit 2
fi

BASE_URL="http://127.0.0.1:$PORT"
ACCESS_FILE="$STATE_DIR/access.json"

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 2
  fi
}

health() {
  if [ -z "$(compose ps --status running --quiet)" ]; then
    echo "managed lab project has no running containers" >&2
    exit 1
  fi
  require curl
  response=$(curl --fail --silent --show-error "$BASE_URL/WebGoat/actuator/health")
  compact=$(printf '%s' "$response" | tr -d '[:space:]')
  case "$compact" in
    *'"status":"UP"'*) ;;
    *)
      echo "WebGoat health response is not UP" >&2
      exit 2
      ;;
  esac
  printf 'healthy: %s\n' "$BASE_URL"
}

create_access() {
  require curl
  require openssl
  username="milksu_$(printf '%s' "$PROJECT_NAME" | sed 's/^milksu-lab-//')"
  password=$(openssl rand -hex 16)
  headers="$STATE_DIR/register.headers"
  body="$STATE_DIR/register.body"
  cookies="$STATE_DIR/register.cookies"
  status=$(curl \
    --silent \
    --show-error \
    --output "$body" \
    --dump-header "$headers" \
    --cookie-jar "$cookies" \
    --write-out '%{http_code}' \
    --data-urlencode "username=$username" \
    --data-urlencode "password=$password" \
    --data-urlencode "matchingPassword=$password" \
    --data-urlencode "agree=agree" \
    "$BASE_URL/WebGoat/register.mvc")
  if [ "$status" != "302" ]; then
    echo "WebGoat account registration returned HTTP $status" >&2
    rm -f "$headers" "$body" "$cookies"
    exit 2
  fi
  umask 077
  temporary="$STATE_DIR/.access.json.tmp"
  printf '{"username":"%s","password":"%s"}\n' "$username" "$password" >"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$ACCESS_FILE"
  rm -f "$headers" "$body" "$cookies"
}

usage() {
  cat <<'EOF'
Usage: ./lab.sh <pull|start|stop|reset|clean|status|logs|health|judge>

The WebGoat lesson oracle is evaluated by MilkSU against the pinned,
authenticated application progress endpoint. The lifecycle script never
accepts an Agent-provided completion claim.
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
    compose up --detach --wait --wait-timeout 240 --pull never
    health
    create_access
    printf 'WebGoat is ready at %s\n' "$BASE_URL"
    ;;
  stop)
    require docker
    compose stop
    ;;
  reset)
    require docker
    compose down --volumes --remove-orphans
    compose up --detach --wait --wait-timeout 240 --pull never
    health
    create_access
    printf 'WebGoat was reset at %s\n' "$BASE_URL"
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
    health
    ;;
  judge)
    echo "WebGoat completion is checked by the trusted MilkSU application oracle" >&2
    exit 2
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
