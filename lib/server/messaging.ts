import { createHmac, timingSafeEqual } from "node:crypto";
import { DateTime } from "luxon";
import { query, transaction, lockOwner, pool, type DB } from "@/db";
import {
  decrypt,
  encrypt,
  fail,
  hash,
  mobile,
  owned,
  audit,
  AppError,
} from "./core";
import { occurrences, localToday, zonedInstant } from "@/lib/calendar";
import { actionDetail } from "./dates-actions";
import {
  applyDeliveryResult,
  notification,
  type DeliveryResult,
} from "./delivery";
import type { Owner } from "./auth";
export type Payload = {
  to: string;
  text: string;
  person_id?: string;
  title: string;
};
export type SendResult = DeliveryResult;
export async function flowerPayload(
  user: string,
  id: string,
  db: DB = pool,
): Promise<Payload> {
  const a = await actionDetail(user, id, db),
    f = await owned(db, "florists", user, a.florist_id, true),
    to = mobile(f.mobile);
  if (!to) fail("شماره گلفروش معتبر نیست.");
  const [occasion] = a.important_date_id
    ? await query(
        "SELECT title FROM important_dates WHERE user_id=$1 AND id=$2",
        [user, a.important_date_id],
        db,
      )
    : [];
  return {
    to,
    person_id: a.person_id,
    title: a.title,
    text: `سفارش گل شماره ${a.id.slice(0, 8)}\nگیرنده: ${a.person_name}\nمناسبت: ${occasion?.title ?? a.title}\nتاریخ تحویل: ${a.delivery_date}${a.delivery_local_time ? " ساعت " + a.delivery_local_time : ""}\nبودجه: ${Number(a.budget_amount).toLocaleString("fa-IR")} ${a.currency === "IRT" ? "تومان" : "ریال"}\nنشانی: ${a.delivery_address}\nمتن کارت: ${a.card_message || "بدون متن"}\nتوضیحات تحویل: ${a.flower_notes || "مطابق سفارش"}\nلطفاً برای هماهنگی با سفارش‌دهنده تماس بگیرید.`,
  };
}
function sign(value: string) {
  return createHmac("sha256", process.env.DATA_ENCRYPTION_KEY!)
    .update(value)
    .digest("base64url");
}
export async function smsPreview(user: Owner, id: string) {
  const a = await actionDetail(user.id, id);
  if (a.action_type !== "flower" || a.status !== "pending")
    fail("پیش‌نمایش فقط برای سفارش گل باز است.");
  const payload = await flowerPayload(user.id, id),
    body = Buffer.from(
      JSON.stringify({
        user: user.id,
        id,
        version: a.version,
        fingerprint: hash(JSON.stringify(payload)),
        exp: Date.now() + 600000,
      }),
    ).toString("base64url");
  return {
    ...payload,
    preview_token: body + "." + sign(body),
    expires_in: 600,
    mode: process.env.SMS_MODE ?? "sandbox",
    scheduled_at: a.calculated_sms_at,
    send_started:
      !!a.sms_accepted_at ||
      ["processing", "accepted", "delivered", "unknown"].includes(a.sms_state),
  };
}
export async function queueSendNow(
  user: Owner,
  id: string,
  token: string,
  db: DB,
) {
  await lockOwner(db, user.id);
  const [body, sig] = String(token).split("."),
    expected = body ? sign(body) : "";
  if (
    !sig ||
    !/^[A-Za-z0-9_-]{43}$/.test(sig) ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    fail("پیش‌نمایش معتبر نیست؛ دوباره بررسی کنید.");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    fail("پیش‌نمایش معتبر نیست.");
  }
  const a = await actionDetail(user.id, id, db),
    payload = await flowerPayload(user.id, id, db),
    fingerprint = hash(JSON.stringify(payload));
  if (
    claims.user !== user.id ||
    claims.id !== id ||
    claims.version !== a.version ||
    claims.exp < Date.now() ||
    claims.fingerprint !== fingerprint
  )
    fail("پیش‌نمایش منقضی یا تغییر کرده است.", 409, "STALE_PREVIEW");
  await owned(db, "people", user.id, a.person_id, true);
  if (a.status !== "pending") fail("اقدام بسته شده است.", 409);
  if (!user.sms_enabled) fail("پیامک در تنظیمات غیرفعال است.");
  const [m] = await query(
    "SELECT * FROM outbox_messages WHERE user_id=$1 AND dedupe_key=$2 FOR UPDATE",
    [user.id, `flower:${id}:initial_sms`],
    db,
  );
  if (!m) fail("برنامه ارسال پیدا نشد.", 404);
  if (
    a.sms_accepted_at ||
    ["processing", "accepted", "delivered", "unknown"].includes(m.state)
  )
    fail(
      "پیام قبلاً آغاز شده یا نتیجه آن نامشخص است. ابتدا وضعیت را بررسی کنید.",
      409,
      "SEND_STARTED",
    );
  await db.query(
    "UPDATE outbox_messages SET state='queued',scheduled_at=now(),deadline_at=now()+interval '24 hours',next_attempt_at=NULL,payload_snapshot=$3,preview_fingerprint=$4,error_code=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",
    [user.id, m.id, encrypt(JSON.stringify(payload)), fingerprint],
  );
  await audit(db, user.id, "manual_send_queued", "action", id);
  return {
    ok: true,
    message_id: m.id,
    state: "queued",
    mode: process.env.SMS_MODE ?? "sandbox",
  };
}
export async function providerSend(
  payload: Payload,
  reference: string,
): Promise<SendResult> {
  try {
    if (!mobile(payload.to))
      return { state: "failed", error_code: "INVALID_RECIPIENT" };
  } catch {
    return { state: "failed", error_code: "INVALID_RECIPIENT" };
  }
  if (payload.text.length > Number(process.env.SMS_MAX_CHARACTERS ?? 2000))
    return { state: "failed", error_code: "MESSAGE_TOO_LONG" };
  if ((process.env.SMS_MODE ?? "sandbox") === "sandbox")
    return { state: "accepted", provider_id: "sandbox:" + reference };
  const url = process.env.SMS_API_URL;
  if (!url?.startsWith("https://") || !process.env.SMS_API_TOKEN)
    return { state: "failed", error_code: "PROVIDER_NOT_CONFIGURED" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SMS_API_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reference,
      },
      body: JSON.stringify({
        to: payload.to,
        text: payload.text,
        client_reference: reference,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429)
      return { state: "retry_wait", error_code: "RATE_LIMITED" };
    if (res.status === 408)
      return { state: "unknown", error_code: "PROVIDER_TIMEOUT" };
    if (res.status >= 400 && res.status < 500)
      return { state: "failed", error_code: "PROVIDER_REJECTED" };
    if (!res.ok) return { state: "unknown", error_code: "PROVIDER_UNCERTAIN" };
    const body = await res.json();
    if (body.status === "rejected")
      return { state: "failed", error_code: "PROVIDER_REJECTED" };
    if (body.status === "accepted" && body.id)
      return { state: "accepted", provider_id: String(body.id) };
    return { state: "unknown", error_code: "INVALID_PROVIDER_RESPONSE" };
  } catch {
    return { state: "unknown", error_code: "TIMEOUT_OR_NETWORK" };
  }
}
export async function generateReminders(userFilter?: string) {
  const users = await query(
    "SELECT id FROM users WHERE ($1::uuid IS NULL OR id=$1)",
    [userFilter ?? null],
  );
  for (const u of users)
    await transaction(async (db) => {
      await lockOwner(db, u.id);
      const reminders = await query(
        `SELECT r.*,coalesce(r.person_id,a.person_id,d.person_id) target_person_id,p.is_active person_active,a.status action_status,d.is_active date_active FROM reminders r LEFT JOIN actions a ON a.id=r.action_id AND a.user_id=r.user_id LEFT JOIN important_dates d ON d.id=r.important_date_id AND d.user_id=r.user_id LEFT JOIN people p ON p.id=coalesce(r.person_id,a.person_id,d.person_id) AND p.user_id=r.user_id WHERE r.user_id=$1 AND r.is_enabled`,
        [u.id],
        db,
      );
      for (const r of reminders) {
        if (
          !r.person_active ||
          (r.action_id && r.action_status !== "pending") ||
          (r.important_date_id && !r.date_active)
        )
          continue;
        let times: { at: string; occurrence: string }[] = [];
        if (r.schedule_mode === "per_occurrence") {
          const d = await owned(
              db,
              "important_dates",
              u.id,
              r.important_date_id,
              true,
            ),
            today = localToday(r.timezone);
          times = occurrences(
            d as any,
            DateTime.fromISO(today)
              .minus({ days: Math.abs(r.offset_days) + 2 })
              .toISODate()!,
            DateTime.fromISO(today)
              .plus({ days: 400 + Math.abs(r.offset_days) })
              .toISODate()!,
          ).map((day) => ({
            at: zonedInstant(
              DateTime.fromISO(day).plus({ days: r.offset_days }).toISODate()!,
              r.local_time,
              r.timezone,
            ),
            occurrence: day,
          }));
        } else
          times = [
            {
              at: new Date(r.scheduled_at).toISOString(),
              occurrence: DateTime.fromJSDate(r.scheduled_at)
                .setZone(r.timezone)
                .toISODate()!,
            },
          ];
        for (const t of times) {
          const deadline = DateTime.fromISO(t.at)
            .plus({ hours: Number(process.env.REMINDER_GRACE_HOURS ?? 24) })
            .toISO()!;
          await db.query(
            `INSERT INTO outbox_messages(user_id,dedupe_key,reminder_id,occurrence_date,channel,schedule_version,scheduled_at,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,dedupe_key) DO UPDATE SET state='queued',schedule_version=$6,scheduled_at=$7,deadline_at=$8,error_code=NULL,preview_fingerprint=NULL,payload_snapshot=NULL WHERE outbox_messages.schedule_version<>$6 AND outbox_messages.state IN('queued','cancelled','expired','retry_wait')`,
            [
              u.id,
              `reminder:${r.id}:${t.occurrence}:${r.channel}`,
              r.id,
              t.occurrence,
              r.channel,
              r.version,
              t.at,
              deadline,
            ],
          );
        }
      }
    });
}
async function reserveMessage(
  userFilter?: string,
): Promise<Record<string, any> | null> {
  const expired = await query(
    "SELECT id,user_id FROM outbox_messages WHERE state='processing' AND locked_until<now() AND ($1::uuid IS NULL OR user_id=$1)",
    [userFilter ?? null],
  );
  // Recovery records the interrupted attempt, then leaves reconciliation to the provider/owner.
  for (const m of expired)
    await transaction(async (db) => {
      await lockOwner(db, m.user_id);
      const [latest] = await query(
        "SELECT state,locked_until FROM outbox_messages WHERE id=$1",
        [m.id],
        db,
      );
      if (
        latest?.state === "processing" &&
        new Date(latest.locked_until) < new Date()
      )
        await applyDeliveryResult(db, m.user_id, m.id, {
          state: "unknown",
          error_code: "LEASE_EXPIRED",
        });
    });
  return transaction(async (db) => {
    const [candidate] = await query(
      "SELECT id,user_id FROM outbox_messages WHERE state IN('queued','retry_wait') AND scheduled_at<=now() AND (next_attempt_at IS NULL OR next_attempt_at<=now()) AND ($1::uuid IS NULL OR user_id=$1) ORDER BY scheduled_at,id LIMIT 1",
      [userFilter ?? null],
      db,
    );
    if (!candidate) return null;
    await lockOwner(db, candidate.user_id);
    const [m] = await query(
      "SELECT * FROM outbox_messages WHERE id=$1 AND state IN('queued','retry_wait') FOR UPDATE SKIP LOCKED",
      [candidate.id],
      db,
    );
    if (!m) return { skipped: true };
    const stop = async (state: string, reason: string) => {
      await db.query(
        "UPDATE outbox_messages SET state=$2,error_code=$3,updated_at=now() WHERE id=$1",
        [m.id, state, reason],
      );
      await notification(
        db,
        m.user_id,
        m.id,
        "نیاز به بررسی برنامه ارسال",
        reason === "DEADLINE_PASSED"
          ? "موعد ارسال گذشته است؛ برنامه نیاز به بررسی دستی دارد."
          : "برنامه ارسال متوقف شد: " + reason,
        m.action_id ?? m.reminder_id,
      );
      return { skipped: true };
    };
    if (m.deadline_at && new Date(m.deadline_at) < new Date())
      return stop("expired", "DEADLINE_PASSED");
    const [u] = await query("SELECT * FROM users WHERE id=$1", [m.user_id], db);
    if (m.channel === "sms" && !u.sms_enabled)
      return stop("cancelled", "SMS_DISABLED");
    try {
      let payload: Payload,
        recipientKind = "user",
        recipientId = m.user_id;
      if (m.action_id) {
        const a = await owned(db, "actions", m.user_id, m.action_id),
          p = await owned(db, "people", m.user_id, a.person_id);
        if (
          a.status !== "pending" ||
          !p.is_active ||
          a.version !== m.schedule_version
        )
          return stop("cancelled", "STALE_SCHEDULE");
        const [f] = await query(
          "SELECT f.id,f.is_active FROM flower_details d JOIN florists f ON f.id=d.florist_id AND f.user_id=d.user_id WHERE d.user_id=$1 AND d.action_id=$2",
          [m.user_id, m.action_id],
          db,
        );
        if (!f?.is_active) return stop("cancelled", "FLORIST_INACTIVE");
        payload = await flowerPayload(m.user_id, m.action_id, db);
        recipientKind = "florist";
        recipientId = f.id;
        if (
          m.preview_fingerprint &&
          hash(JSON.stringify(payload)) !== m.preview_fingerprint
        )
          return stop("cancelled", "STALE_PREVIEW");
      } else {
        const r = await owned(db, "reminders", m.user_id, m.reminder_id);
        if (!r.is_enabled || r.version !== m.schedule_version)
          return stop("cancelled", "STALE_SCHEDULE");
        let personId = r.person_id;
        if (r.action_id) {
          const a = await owned(db, "actions", m.user_id, r.action_id);
          if (a.status !== "pending") return stop("cancelled", "ACTION_CLOSED");
          personId = a.person_id;
        }
        if (r.important_date_id) {
          const d = await owned(
            db,
            "important_dates",
            m.user_id,
            r.important_date_id,
          );
          if (!d.is_active) return stop("cancelled", "DATE_INACTIVE");
          personId = d.person_id;
        }
        const p = await owned(db, "people", m.user_id, personId);
        if (!p.is_active) return stop("cancelled", "PERSON_ARCHIVED");
        let to = "";
        if (m.channel === "sms") {
          const recipient = r.recipient_person_id
            ? await owned(db, "people", m.user_id, r.recipient_person_id, true)
            : (
                await query(
                  "SELECT * FROM people WHERE user_id=$1 AND is_self",
                  [m.user_id],
                  db,
                )
              )[0];
          to = mobile(recipient?.mobile) ?? "";
          if (!to) return stop("failed", "RECIPIENT_MOBILE_REQUIRED");
          if (r.recipient_person_id) {
            recipientKind = "person";
            recipientId = r.recipient_person_id;
          }
        }
        payload = {
          to,
          text: decrypt(r.message),
          title: "یادآوری رابطه",
          person_id: personId,
        };
      }
      await db.query(
        "UPDATE outbox_messages SET state='processing',payload_snapshot=$2,recipient_kind=$3,recipient_id=$4,attempt_count=attempt_count+1,locked_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
        [m.id, encrypt(JSON.stringify(payload)), recipientKind, recipientId],
      );
      if (m.channel === "sms")
        await db.query(
          "INSERT INTO sms_logs(user_id,outbox_message_id,attempt_no,provider,send_status,recipient_mobile_snapshot,message_snapshot) VALUES($1,$2,$3,$4,'processing',$5,$6)",
          [
            m.user_id,
            m.id,
            m.attempt_count + 1,
            process.env.SMS_MODE ?? "sandbox",
            encrypt(payload.to),
            encrypt(payload.text),
          ],
        );
      return { ...m, payload, attempt_count: m.attempt_count + 1 };
    } catch (error) {
      if (error instanceof AppError) return stop("failed", error.code);
      throw error;
    }
  });
}
export async function processOneMessage(
  userFilter?: string,
  send: (p: Payload, id: string) => Promise<SendResult> = providerSend,
) {
  const m = await reserveMessage(userFilter);
  if (!m) return false;
  if (m.skipped) return true;
  if (m.channel === "in_app") {
    await transaction(async (db) => {
      await lockOwner(db, m.user_id);
      await notification(
        db,
        m.user_id,
        m.id,
        m.payload.title,
        m.payload.text,
        m.reminder_id,
      );
      await applyDeliveryResult(db, m.user_id, m.id, { state: "accepted" });
    });
    return true;
  }
  let result: SendResult;
  try {
    result = await send(m.payload, m.id);
  } catch {
    result = { state: "unknown", error_code: "TIMEOUT_OR_NETWORK" };
  }
  if (result.state === "retry_wait" && m.attempt_count >= 4)
    result = { state: "failed", error_code: "RETRIES_EXHAUSTED" };
  const delays = (process.env.SMS_RETRY_MINUTES ?? "1,5,15")
      .split(",")
      .map(Number),
    delay = delays[Math.min(m.attempt_count - 1, 2)] ?? 15;
  const next =
    result.state === "retry_wait"
      ? DateTime.now()
          .plus({ minutes: delay, seconds: Math.floor(Math.random() * 10) })
          .toISO()
      : null;
  await transaction((db) =>
    applyDeliveryResult(db, m.user_id, m.id, result, next),
  );
  return true;
}
export async function reconcileMessage(user: string, id: string) {
  const m = await owned(pool, "outbox_messages", user, id);
  if (!["unknown", "accepted"].includes(m.state))
    fail("این پیام نیاز به استعلام ندارد.");
  if ((process.env.SMS_MODE ?? "sandbox") === "sandbox")
    return { state: m.state, notice: "Sandbox رسید تحویل مخابراتی ندارد." };
  const url = process.env.SMS_API_URL;
  if (!url?.startsWith("https://")) fail("سرویس استعلام تنظیم نشده است.");
  let result;
  try {
    const res = await fetch(
      url + "/" + encodeURIComponent(m.provider_message_id ?? m.id),
      {
        headers: { Authorization: `Bearer ${process.env.SMS_API_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return { state: m.state };
    result = await res.json();
  } catch {
    return { state: m.state };
  }
  if (["accepted", "delivered", "failed"].includes(result.status)) {
    const saved = await transaction((db) =>
      applyDeliveryResult(db, user, id, {
        state: result.status,
        provider_id: result.id ? String(result.id) : undefined,
      }),
    );
    return { state: saved?.state ?? m.state };
  }
  return { state: m.state };
}
