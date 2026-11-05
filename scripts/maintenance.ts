import { pool, transaction } from "../db/index";
await transaction(async (db) => {
  await db.query(
    "DELETE FROM api_error_metrics WHERE hour<now()-interval '1 year'",
  );
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query("DELETE FROM login_attempts WHERE reset_at<now()");
  await db.query("DELETE FROM idempotency_requests WHERE expires_at<now()");
  await db.query(
    "UPDATE import_jobs SET staged_data='{}',external_references='{}',purged_at=now(),status=CASE WHEN status IN('queued','processing') THEN 'failed' ELSE status END,error_message=CASE WHEN status IN('queued','processing') THEN 'Import staging expired' ELSE error_message END WHERE expires_at<now() AND (locked_until IS NULL OR locked_until<now()) AND purged_at IS NULL",
  );
  await db.query(
    "UPDATE sms_logs SET recipient_mobile_snapshot=NULL,message_snapshot=NULL WHERE requested_at<now()-interval '90 days'",
  );
  await db.query(
    "UPDATE outbox_messages SET payload_snapshot=NULL WHERE created_at<now()-interval '90 days' AND state NOT IN('queued','retry_wait','processing')",
  );
  await db.query(
    "DELETE FROM audit_logs WHERE occurred_at<now()-interval '1 year'",
  );
});
console.log(
  "Expired sessions, import staging, message snapshots, and audit records processed.",
);
await pool.end();
