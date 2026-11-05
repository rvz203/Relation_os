import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { pool, query } from "../db/index";
import { decrypt } from "../lib/server/core";
const source = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1"].includes(source.hostname),
  "Recovery exercise requires a local source",
);
const database = "relationship_recovery_" + randomBytes(6).toString("hex"),
  folder = await mkdtemp(path.join(tmpdir(), "relationship-recovery-"));
const target = new URL(source);
target.pathname = "/" + database;
const env = {
  ...process.env,
  BACKUP_PASSWORD: randomBytes(32).toString("hex"),
};
const run = promisify(execFile);
let recovery: pg.Pool | undefined,
  created = false;
try {
  const [original] = await query(
    "SELECT (SELECT count(*)::int FROM users) owners,(SELECT count(*)::int FROM people) people,(SELECT count(*)::int FROM relationships) relationships",
  );
  await run(process.execPath, ["scripts/ops/backup.mjs", folder], { env });
  await pool.query("CREATE DATABASE " + database);
  created = true;
  await run(
    process.execPath,
    ["scripts/ops/restore.mjs", path.join(folder, (await readdir(folder))[0])],
    {
      env: {
        ...env,
        DATABASE_URL: target.toString(),
        RESTORE_ACK: "I_HAVE_STOPPED_SMS",
      },
    },
  );
  recovery = new pg.Pool({ connectionString: target.toString() });
  const restored = (
    await recovery.query(
      "SELECT (SELECT count(*)::int FROM users) owners,(SELECT count(*)::int FROM people) people,(SELECT count(*)::int FROM relationships) relationships",
    )
  ).rows[0];
  assert.deepEqual(restored, original);
  assert.equal(
    (
      await recovery.query(
        "SELECT count(*)::int n FROM users WHERE sms_enabled",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await recovery.query(
        "SELECT count(*)::int n FROM outbox_messages WHERE state='processing'",
      )
    ).rows[0].n,
    0,
  );
  const encrypted = (
    await recovery.query(
      "SELECT address FROM people WHERE address IS NOT NULL AND address<>'' LIMIT 1",
    )
  ).rows[0];
  if (encrypted) assert.ok(decrypt(encrypted.address));
  console.log(
    "PASS encrypted backup/isolated restore: owner/person/relationship counts preserved, private data decrypts, SMS disabled, no processing messages. Recovery database removed after verification.",
  );
} finally {
  await recovery?.end();
  if (created) await pool.query("DROP DATABASE " + database);
  await rm(folder, { recursive: true, force: true });
  await pool.end();
}
