import { Database } from "@db/sqlite";

const DEFAULT_DATABASE_PATH = "data/eyri.sqlite";

let database: Database | null = null;

function getDatabasePath() {
  return Deno.env.get("EYRI_DATABASE_PATH") ?? DEFAULT_DATABASE_PATH;
}

function getParentDirectory(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1 ? "." : path.slice(0, separatorIndex);
}

export async function getDatabase() {
  if (database) {
    return database;
  }

  const path = getDatabasePath();
  await Deno.mkdir(getParentDirectory(path), { recursive: true });

  database = new Database(path);
  return database;
}
