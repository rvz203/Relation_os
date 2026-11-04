import { pool, transaction } from "../db/index";
await transaction(async (db) => {
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query("DELETE FROM login_attempts WHERE reset_at<now()");
  await db.query("DELETE FROM idempotency_requests WHERE expires_at<now()");
  await db.query("DELETE FROM import_jobs WHERE expires_at<now()");
  await db.query(
    "UPDATE outbox_messages SET payload_snapshot=NULL WHERE created_at<now()-interval '90 days' AND state NOT IN('queued','retry_wait','processing')",
  );
  await db.query(
    "DELETE FROM audit_logs WHERE occurred_at<now()-interval '1 year'",
  );
});
console.log(
  "Expired sessions, imports, message bodies, and audit records processed.",
);
await pool.end();
