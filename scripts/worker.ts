import { setTimeout } from "node:timers/promises";
import { pool, query } from "../db/index";
import { generateReminders, processOneMessage } from "../lib/server/messaging";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const once = process.argv.includes("--once");
do {
  try {
    await generateReminders();
    for (let i = 0; i < 100 && !stopping; i++) {
      if (!(await processOneMessage())) break;
    }
    await query(
      "INSERT INTO worker_health(name,last_seen_at) VALUES('scheduler',now()) ON CONFLICT(name) DO UPDATE SET last_seen_at=now()",
    );
  } catch (error) {
    console.error(
      "Worker iteration failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
  if (!once && !stopping) await setTimeout(30000);
} while (!once && !stopping);
await pool.end();
