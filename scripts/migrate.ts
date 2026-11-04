import { readFile, readdir } from "node:fs/promises";
import { pool, transaction } from "../db/index";
await transaction(async (db) => {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('relationship-os:migrations'))",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rowCount
    )
      continue;
    await db.query(await readFile("db/migrations/" + name, "utf8"));
    await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    console.log("Applied", name);
  }
});
await pool.end();
