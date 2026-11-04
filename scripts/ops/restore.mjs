import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { databaseEnv } from "./database-env.mjs";
if (
  process.env.RESTORE_ACK !== "I_HAVE_STOPPED_SMS" ||
  !process.env.BACKUP_PASSWORD ||
  !process.argv[2]
)
  throw new Error(
    "Set DATABASE_URL, BACKUP_PASSWORD, RESTORE_ACK=I_HAVE_STOPPED_SMS and pass the backup path.",
  );
const decrypt = spawn(
  "openssl",
  [
    "enc",
    "-d",
    "-aes-256-cbc",
    "-pbkdf2",
    "-pass",
    "env:BACKUP_PASSWORD",
    "-in",
    process.argv[2],
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const restore = spawn(
  "pg_restore",
  [
    "--dbname",
    databaseEnv().PGDATABASE,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--exit-on-error",
  ],
  { env: databaseEnv(), stdio: ["pipe", "inherit", "inherit"] },
);
const exit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Restore subprocess failed")),
    );
  });
await Promise.all([
  pipeline(decrypt.stdout, restore.stdin),
  exit(decrypt),
  exit(restore),
]);
const sql =
  "UPDATE users SET sms_enabled=false; UPDATE outbox_messages SET state='unknown',error_code='RESTORE_RECONCILIATION_REQUIRED' WHERE state='processing';";
const stop = spawn("psql", ["--set", "ON_ERROR_STOP=1", "-c", sql], {
  env: databaseEnv(),
  stdio: "inherit",
});
await exit(stop);
console.log(
  "Restore finished with SMS disabled. Reconcile provider messages before enabling the worker.",
);
