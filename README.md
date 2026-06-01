# Stock Manager for Telegram

## Stack
- Stooq API
- TypeScript
- grammY
- SQLite

## Mongo Migration

Run once while the old Mongo container is still available:

```sh
scripts/migrate-mongo-to-sqlite.sh <mongo-container-name>
```

Defaults can be overridden with `MONGO_CONTAINER`, `MONGO_DB`, `EYRI_DATABASE_PATH`, `CONTAINER_RUNTIME`, and `DENO_IMAGE`.

When the app runs in Podman Compose, migrate directly into the app data volume:

```sh
CONTAINER_RUNTIME=podman \
MONGO_CONTAINER=eyri-mongo-migration \
MONGO_DB=eyri \
EYRI_DATABASE_PATH="$(podman volume inspect eyri_eyri-data --format '{{.Mountpoint}}')/eyri.sqlite" \
scripts/migrate-mongo-to-sqlite.sh
```
