import { readdir, rm } from "node:fs/promises";
import path from "node:path";
// Next.js copies loaded .env files into standalone output; runtime secrets are injected by the host.
const root = path.resolve(".next/standalone");
async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const file = path.join(directory, entry.name);
    if (entry.name === ".env" || entry.name.startsWith(".env."))
      await rm(file, { force: true });
    else if (entry.isDirectory() && entry.name !== "node_modules")
      await clean(file);
  }
}
await clean(root);
console.log("Build output checked for environment files.");
