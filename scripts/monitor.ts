import { setTimeout } from "node:timers/promises";
import { pool } from "../db/index";
import { monitorOnce } from "../lib/server/monitoring";
const once = process.argv.includes("--once");
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
do {
  try {
    const changes = await monitorOnce();
    if (changes.length)
      console.log(
        "Operational incident changes:",
        changes.map((c) => c.code + ":" + c.active).join(", "),
      );
  } catch (error) {
    console.error(
      "Monitor failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
  if (!once && !stop) await setTimeout(60000);
} while (!once && !stop);
await pool.end();
