import { spawn } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { databaseEnv } from "./database-env.mjs";
if (!process.env.BACKUP_PASSWORD) throw new Error("Set BACKUP_PASSWORD");
const directory = path.resolve(process.argv[2] ?? "private/backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = path.join(
  directory,
  "relationship-os-" +
    new Date().toISOString().replace(/[:.]/g, "-") +
    ".dump.enc",
);
const dump = spawn("pg_dump", ["--format=custom"], {
  env: databaseEnv(),
  stdio: ["ignore", "pipe", "inherit"],
});
const cipher = spawn(
  "openssl",
  ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-pass", "env:BACKUP_PASSWORD"],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const exit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Backup subprocess failed")),
    );
  });
try {
  await Promise.all([
    pipeline(dump.stdout, cipher.stdin),
    pipeline(cipher.stdout, createWriteStream(file, { mode: 0o600 })),
    exit(dump),
    exit(cipher),
  ]);
  console.log("Encrypted backup created:", file);
} catch (error) {
  dump.kill();
  cipher.kill();
  await unlink(file).catch(() => {});
  throw error;
}
