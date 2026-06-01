#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${CONTAINER_RUNTIME:-}" ]]; then
  if command -v docker >/dev/null 2>&1; then
    CONTAINER_RUNTIME="docker"
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_RUNTIME="podman"
  else
    CONTAINER_RUNTIME="docker"
  fi
fi
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"
MONGO_DB="${MONGO_DB:-eyri}"
MONGO_CONTAINER="${MONGO_CONTAINER:-${1:-}}"
MONGO_VOLUME="${MONGO_VOLUME:-}"
MONGO_IMAGE="${MONGO_IMAGE:-docker.io/library/mongo:7}"
DENO_IMAGE="${DENO_IMAGE:-docker.io/denoland/deno:2.5.4}"
CREATED_MONGO_CONTAINER=""

BIND_MOUNT_SUFFIX=""
if [[ "$CONTAINER_RUNTIME" == *podman* ]]; then
  BIND_MOUNT_SUFFIX=",Z"
fi

find_mongo_container() {
  local container

  container="$(
    "$CONTAINER_RUNTIME" ps --format '{{.Names}}' \
      | grep -E '(^|[-_])eyri_db($|[-_])' \
      | head -n 1 || true
  )"
  if [[ -n "$container" ]]; then
    printf '%s\n' "$container"
    return
  fi

  "$CONTAINER_RUNTIME" ps --format '{{.Names}}' \
    | grep -Ei 'mongo|eyri.*db' \
    | head -n 1 || true
}

if ! command -v "$CONTAINER_RUNTIME" >/dev/null 2>&1; then
  echo "$CONTAINER_RUNTIME is required to dump from the Mongo container." >&2
  exit 1
fi

volume_exists() {
  "$CONTAINER_RUNTIME" volume inspect "$1" >/dev/null 2>&1
}

volume_mountpoint() {
  "$CONTAINER_RUNTIME" volume inspect "$1" --format '{{.Mountpoint}}'
}

find_old_mongo_volume() {
  local candidates=(
    "${COMPOSE_PROJECT_NAME}_eyri-mongo-data"
    "eyri_eyri-mongo-data"
    "eyri-mongo-data"
  )
  local volume

  for volume in "${candidates[@]}"; do
    if volume_exists "$volume"; then
      printf '%s\n' "$volume"
      return
    fi
  done

  "$CONTAINER_RUNTIME" volume ls --format '{{.Name}}' \
    | grep -E '(^|_)eyri-mongo-data$' \
    | head -n 1 || true
}

find_sqlite_path() {
  if [[ -n "${EYRI_DATABASE_PATH:-}" ]]; then
    if [[ "$EYRI_DATABASE_PATH" = /* ]]; then
      printf '%s\n' "$EYRI_DATABASE_PATH"
    else
      printf '%s/%s\n' "$ROOT_DIR" "$EYRI_DATABASE_PATH"
    fi
    return
  fi

  local candidates=(
    "${COMPOSE_PROJECT_NAME}_eyri-data"
    "eyri_eyri-data"
    "eyri-data"
  )
  local volume

  for volume in "${candidates[@]}"; do
    if volume_exists "$volume"; then
      printf '%s/eyri.sqlite\n' "$(volume_mountpoint "$volume")"
      return
    fi
  done

  printf '%s/data/eyri.sqlite\n' "$ROOT_DIR"
}

SQLITE_ABS_PATH="$(find_sqlite_path)"
SQLITE_PATH="${EYRI_DATABASE_PATH:-$SQLITE_ABS_PATH}"

if [[ -z "$MONGO_CONTAINER" && -z "$MONGO_VOLUME" ]]; then
  MONGO_CONTAINER="$(find_mongo_container)"
fi

if [[ -z "$MONGO_CONTAINER" && -z "$MONGO_VOLUME" ]]; then
  MONGO_VOLUME="$(find_old_mongo_volume)"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  if [[ -n "$CREATED_MONGO_CONTAINER" ]]; then
    "$CONTAINER_RUNTIME" rm -f "$CREATED_MONGO_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

container_is_running() {
  local container="$1"

  [[ "$("$CONTAINER_RUNTIME" inspect "$container" --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]
}

wait_for_mongo() {
  local container="$1"

  for _ in $(seq 1 60); do
    if "$CONTAINER_RUNTIME" exec "$container" mongosh "$MONGO_DB" --quiet --eval "db.runCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Mongo did not become ready in container '$container'." >&2
  "$CONTAINER_RUNTIME" logs --tail=80 "$container" >&2 || true
  exit 1
}

if [[ -n "$MONGO_CONTAINER" ]] && ! container_is_running "$MONGO_CONTAINER"; then
  echo "Mongo container '$MONGO_CONTAINER' is not running." >&2
  echo "Pass MONGO_VOLUME=<old-compose-volume> instead, or start the container first." >&2
  exit 1
fi

if [[ -z "$MONGO_CONTAINER" ]]; then
  if [[ -z "$MONGO_VOLUME" ]]; then
    cat >&2 <<'USAGE'
Could not find a running Mongo container.

Default behavior:
  Uses the old Compose volume '${COMPOSE_PROJECT_NAME}_eyri-mongo-data' when it exists.

Usage with an existing running Mongo container:
  scripts/migrate-mongo-to-sqlite.sh <mongo-container-name>

Usage with a non-standard old Compose volume:
  MONGO_VOLUME=<old-mongo-volume> scripts/migrate-mongo-to-sqlite.sh

Environment:
  MONGO_CONTAINER       Running Mongo container name, instead of the positional arg
  MONGO_VOLUME          Old Mongo /data/db volume; starts a temporary Mongo container
  MONGO_DB              Mongo database name (default: eyri)
  MONGO_IMAGE           Mongo image for temporary container (default: docker.io/library/mongo:7)
  EYRI_DATABASE_PATH    SQLite DB path (default: data/eyri.sqlite)
  CONTAINER_RUNTIME     docker or podman (default: docker)
  DENO_IMAGE            Deno image for loader fallback (default: docker.io/denoland/deno:2.5.4)
USAGE
    exit 1
  fi

  MONGO_CONTAINER="eyri-mongo-migration-$$"
  CREATED_MONGO_CONTAINER="$MONGO_CONTAINER"
  echo "Starting temporary Mongo container '$MONGO_CONTAINER' from volume '$MONGO_VOLUME'..."
  "$CONTAINER_RUNTIME" run -d \
    --name "$MONGO_CONTAINER" \
    -v "$MONGO_VOLUME:/data/db" \
    "$MONGO_IMAGE" >/dev/null
  wait_for_mongo "$MONGO_CONTAINER"
fi

dump_collection() {
  local collection="$1"
  local output="$2"

  "$CONTAINER_RUNTIME" exec "$MONGO_CONTAINER" mongosh "$MONGO_DB" --quiet --eval "
    const docs = db.getCollection('${collection}').find({}).toArray();
    print(EJSON.stringify(docs));
  " >"$output"
}

echo "Dumping Mongo database '$MONGO_DB' from container '$MONGO_CONTAINER'..."
dump_collection user "$TMP_DIR/users.json"
dump_collection price "$TMP_DIR/prices.json"

mkdir -p "$(dirname "$SQLITE_ABS_PATH")"

echo "Loading dump into SQLite database '$SQLITE_PATH'..."
if command -v deno >/dev/null 2>&1; then
  (
    cd "$ROOT_DIR"
    EYRI_DATABASE_PATH="$SQLITE_ABS_PATH" deno run -A \
      scripts/load-mongo-json-to-sqlite.ts \
      --users="$TMP_DIR/users.json" \
      --prices="$TMP_DIR/prices.json"
  )
else
  SQLITE_DIR="$(dirname "$SQLITE_ABS_PATH")"
  SQLITE_FILE="$(basename "$SQLITE_ABS_PATH")"

  "$CONTAINER_RUNTIME" run --rm \
    -v "$ROOT_DIR:/app:ro${BIND_MOUNT_SUFFIX}" \
    -v "$TMP_DIR:/dump:ro${BIND_MOUNT_SUFFIX}" \
    -v "$SQLITE_DIR:/sqlite${BIND_MOUNT_SUFFIX}" \
    -w /app \
    -e "EYRI_DATABASE_PATH=/sqlite/$SQLITE_FILE" \
    "$DENO_IMAGE" \
    run -A scripts/load-mongo-json-to-sqlite.ts \
      --users=/dump/users.json \
      --prices=/dump/prices.json
fi

echo "Migration complete."
