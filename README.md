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

Defaults can be overridden with `MONGO_CONTAINER`, `MONGO_DB`, `EYRI_DATABASE_PATH`, and `CONTAINER_RUNTIME`.
