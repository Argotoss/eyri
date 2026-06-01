#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
MONGO_DB="${MONGO_DB:-eyri}"
MONGO_CONTAINER="${MONGO_CONTAINER:-${1:-}}"
SQLITE_PATH="${EYRI_DATABASE_PATH:-data/eyri.sqlite}"
DENO_IMAGE="${DENO_IMAGE:-docker.io/denoland/deno:2.5.4}"

if [[ "$SQLITE_PATH" = /* ]]; then
  SQLITE_ABS_PATH="$SQLITE_PATH"
else
  SQLITE_ABS_PATH="$ROOT_DIR/$SQLITE_PATH"
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

if [[ -z "$MONGO_CONTAINER" ]]; then
  MONGO_CONTAINER="$(find_mongo_container)"
fi

if [[ -z "$MONGO_CONTAINER" ]]; then
  cat >&2 <<'USAGE'
Could not find a running Mongo container.

Usage:
  scripts/migrate-mongo-to-sqlite.sh <mongo-container-name>

Environment:
  MONGO_CONTAINER       Mongo container name, instead of the positional arg
  MONGO_DB              Mongo database name (default: eyri)
  EYRI_DATABASE_PATH    SQLite DB path (default: data/eyri.sqlite)
  CONTAINER_RUNTIME     docker or podman (default: docker)
USAGE
  exit 1
fi

if ! command -v "$CONTAINER_RUNTIME" >/dev/null 2>&1; then
  echo "$CONTAINER_RUNTIME is required to dump from the Mongo container." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

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
    -v "$ROOT_DIR:/app" \
    -v "$TMP_DIR:/dump" \
    -v "$SQLITE_DIR:/sqlite" \
    -w /app \
    -e "EYRI_DATABASE_PATH=/sqlite/$SQLITE_FILE" \
    "$DENO_IMAGE" \
    run -A scripts/load-mongo-json-to-sqlite.ts \
      --users=/dump/users.json \
      --prices=/dump/prices.json
fi

echo "Migration complete."
