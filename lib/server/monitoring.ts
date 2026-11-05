import { pool, query, transaction, type DB } from "@/db";
import { encrypt } from "./core";
export async function healthReport(user: string, db: DB = pool) {
  const [queue] = await query(
    `SELECT extract(epoch FROM(now()-(min(coalesce(next_attempt_at,scheduled_at)) FILTER(WHERE state IN('queued','retry_wait')))))::int oldest_ready_seconds,count(*) FILTER(WHERE state='unknown')::int unknown,count(*) FILTER(WHERE state='failed')::int failed FROM outbox_messages WHERE user_id=$1 AND (state IN('unknown','failed') OR (state IN('queued','retry_wait') AND coalesce(next_attempt_at,scheduled_at)<=now()))`,
    [user],
    db,
  );
  const [heartbeat] = await query(
    "SELECT last_seen_at,extract(epoch FROM(now()-last_seen_at))::int age_seconds FROM worker_health WHERE name='scheduler'",
    [],
    db,
  );
  const [apiErrors] = await query(
    "SELECT coalesce(sum(error_count),0)::int n FROM api_error_metrics WHERE hour>=date_trunc('hour',now())-interval '1 hour'",
    [],
    db,
  );
  const [provider] = await query(
    "SELECT * FROM provider_health WHERE name='sms'",
    [],
    db,
  );
  const [alerts] = await query(
    "SELECT count(*)::int n FROM operational_alerts WHERE user_id=$1 AND is_active",
    [user],
    db,
  );
  return {
    queue_age_seconds: Math.max(0, queue.oldest_ready_seconds ?? 0),
    unknown: queue.unknown,
    failed: queue.failed,
    worker_last_seen_at: heartbeat?.last_seen_at ?? null,
    worker_age_seconds: heartbeat?.age_seconds ?? null,
    active_alerts: alerts.n,
    api_errors_recent: apiErrors.n,
    sms_balance: provider?.balance ?? null,
    sms_balance_checked_at: provider?.checked_at ?? null,
    sms_mode: process.env.SMS_MODE ?? "sandbox",
    credit_status:
      (process.env.SMS_MODE ?? "sandbox") === "sandbox"
        ? "sandbox"
        : (provider?.status ?? "not_configured"),
  };
}
export async function monitorOnce(
  userFilter?: string,
  deliver: typeof fetch = fetch,
) {
  if (
    (process.env.SMS_MODE ?? "sandbox") !== "sandbox" &&
    process.env.SMS_BALANCE_URL?.startsWith("https://")
  ) {
    let status = "unknown",
      balance: number | null = null;
    try {
      const response = await fetch(process.env.SMS_BALANCE_URL, {
        headers: {
          Authorization: "Bearer " + (process.env.SMS_API_TOKEN ?? ""),
        },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const body = await response.json();
        if (typeof body.balance === "number" && Number.isFinite(body.balance)) {
          balance = body.balance;
          status =
            body.balance <= Number(process.env.SMS_LOW_BALANCE_THRESHOLD ?? 0)
              ? "low"
              : "healthy";
        }
      }
    } catch {}
    await query(
      "INSERT INTO provider_health(name,status,balance) VALUES('sms',$1,$2) ON CONFLICT(name) DO UPDATE SET status=$1,balance=$2,checked_at=now()",
      [status, balance],
    );
  }
  const changed: { code: string; user_id: string; active: boolean }[] = [];
  for (const u of await query(
    "SELECT id FROM users WHERE ($1::uuid IS NULL OR id=$1)",
    [userFilter ?? null],
  )) {
    const report = await healthReport(u.id);
    for (const condition of [
      {
        code: "WORKER_STALE",
        active:
          report.worker_age_seconds === null || report.worker_age_seconds > 600,
        detail: "پردازشگر بیش از ۱۰ دقیقه heartbeat معتبر ندارد.",
      },
      {
        code: "QUEUE_DELAY",
        active: report.queue_age_seconds > 600,
        detail: "پیام آماده بیش از ۱۰ دقیقه در صف مانده است.",
      },
      {
        code: "API_ERRORS",
        active: report.api_errors_recent >= 5,
        detail: "چند خطای داخلی API در بازه اخیر ثبت شده است.",
      },
      {
        code: "SMS_LOW_BALANCE",
        active: report.credit_status === "low",
        detail: "اعتبار درگاه پیامک کم است.",
      },
      {
        code: "SMS_UNKNOWN",
        active: report.unknown > 0,
        detail:
          "نتیجه بعضی پیام‌ها نامشخص است؛ پیش از ارسال دوباره استعلام بگیرید.",
      },
    ]) {
      await transaction(async (db) => {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [u.id]);
        const [old] = await query(
          "SELECT * FROM operational_alerts WHERE user_id=$1 AND code=$2",
          [u.id, condition.code],
          db,
        );
        if (old?.is_active === condition.active || (!old && !condition.active))
          return;
        await db.query(
          "INSERT INTO operational_alerts(user_id,code,is_active,detail) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,code) DO UPDATE SET is_active=$3,detail=$4,ops_pending=true,updated_at=now()",
          [u.id, condition.code, condition.active, condition.detail],
        );
        if (condition.active)
          await db.query(
            "INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)",
            [u.id, "هشدار عملیات", encrypt(condition.detail)],
          );
        changed.push({
          code: condition.code,
          user_id: u.id,
          active: condition.active,
        });
      });
    }
  }
  // The optional operations destination receives incident metadata only, never contact/SMS content.
  if (process.env.OPS_ALERT_URL?.startsWith("https://")) {
    const pending = await query(
      "SELECT id,user_id,code,is_active active,updated_at::text updated_at FROM operational_alerts WHERE ops_pending AND ($1::uuid IS NULL OR user_id=$1)",
      [userFilter ?? null],
    );
    if (pending.length) {
      const response = await deliver(process.env.OPS_ALERT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.OPS_ALERT_TOKEN
            ? { Authorization: "Bearer " + process.env.OPS_ALERT_TOKEN }
            : {}),
        },
        body: JSON.stringify({
          application: "relationship-os",
          incidents: pending,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error("Operations destination rejected incident delivery");
      for (const incident of pending)
        await query(
          "UPDATE operational_alerts SET ops_pending=false WHERE id=$1 AND updated_at=$2 AND is_active=$3",
          [incident.id, incident.updated_at, incident.active],
        );
    }
  }
  return changed;
}
