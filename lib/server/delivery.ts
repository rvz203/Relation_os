import { query, lockOwner, type DB } from "@/db";
import { encrypt, audit } from "./core";
export type DeliveryResult = {
  state: "accepted" | "delivered" | "failed" | "unknown" | "retry_wait";
  provider_id?: string;
  error_code?: string;
};
export async function notification(
  db: DB,
  user: string,
  messageId: string,
  title: string,
  body: string,
  related?: string,
) {
  await db.query(
    "INSERT INTO notifications(user_id,outbox_message_id,title,body,related_entity_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,outbox_message_id) DO NOTHING",
    [user, messageId, title, encrypt(body) ?? "", related ?? null],
  );
}
export async function applyDeliveryResult(
  db: DB,
  user: string,
  id: string,
  result: DeliveryResult,
  nextAttempt: string | null = null,
) {
  await lockOwner(db, user);
  const [m] = await query(
    "SELECT * FROM outbox_messages WHERE user_id=$1 AND id=$2 FOR UPDATE",
    [user, id],
    db,
  );
  if (!m) return null;
  // Late responses and duplicate receipts must not downgrade a known terminal result.
  let state = result.state;
  if (m.state === "delivered" || m.state === "failed") state = m.state;
  else if (m.state === "accepted" && ["unknown", "retry_wait"].includes(state))
    state = "accepted";
  if (["queued", "cancelled", "expired"].includes(m.state)) return m;
  await db.query(
    "UPDATE outbox_messages SET state=$3,provider_message_id=coalesce(provider_message_id,$4),error_code=$5,next_attempt_at=$6,locked_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",
    [
      user,
      id,
      state,
      result.provider_id ?? null,
      result.error_code ?? null,
      state === "retry_wait" ? nextAttempt : null,
    ],
  );
  if (m.channel === "sms")
    await db.query(
      "UPDATE sms_logs SET send_status=$3,provider_message_id=coalesce(provider_message_id,$4),delivery_status=$5,error_code=$6,responded_at=coalesce(responded_at,now()) WHERE user_id=$1 AND outbox_message_id=$2 AND attempt_no=$7",
      [
        user,
        id,
        ["accepted", "delivered"].includes(state) ||
        (state === "failed" && m.state === "accepted")
          ? "accepted"
          : state,
        result.provider_id ?? null,
        state === "delivered"
          ? "delivered"
          : state === "failed" && m.state === "accepted"
            ? "failed"
            : null,
        result.error_code ?? null,
        m.attempt_count,
      ],
    );
  if (m.action_id && ["accepted", "delivered"].includes(state)) {
    await db.query(
      "UPDATE flower_details SET sms_accepted_at=coalesce(sms_accepted_at,now()) WHERE user_id=$1 AND action_id=$2",
      [user, m.action_id],
    );
    const [action] = await query(
      "SELECT person_id FROM actions WHERE user_id=$1 AND id=$2",
      [user, m.action_id],
      db,
    );
    await db.query(
      "INSERT INTO interactions(user_id,person_id,occurred_at,interaction_type,notes,source,related_action_id,related_message_id,counts_as_contact,dedupe_key) VALUES($1,$2,now(),'note',$3,'message',$4,$5,false,$6) ON CONFLICT(user_id,dedupe_key) DO NOTHING",
      [
        user,
        action.person_id,
        encrypt("هماهنگی سفارش با گلفروش؛ پذیرش پیام تأیید انجام گل نیست."),
        m.action_id,
        id,
        "message:" + id,
      ],
    );
  }
  if (
    m.reminder_id &&
    m.channel === "sms" &&
    m.recipient_kind === "person" &&
    ["accepted", "delivered"].includes(state)
  ) {
    await db.query(
      "INSERT INTO interactions(user_id,person_id,occurred_at,interaction_type,notes,source,related_message_id,counts_as_contact,dedupe_key) VALUES($1,$2,now(),'sms',$3,'message',$4,$5,$6) ON CONFLICT(user_id,dedupe_key) DO UPDATE SET counts_as_contact=interactions.counts_as_contact OR EXCLUDED.counts_as_contact",
      [
        user,
        m.recipient_id,
        encrypt("پیامک یادآوری؛ وضعیت ارسال در بخش پیام‌ها ثبت شده است."),
        id,
        state === "delivered",
        "message:" + id,
      ],
    );
  }
  if (["accepted", "delivered", "failed", "unknown"].includes(state))
    await notification(
      db,
      user,
      id,
      state === "accepted" || state === "delivered"
        ? "وضعیت پیام"
        : "نیاز به بررسی ارسال",
      state === "delivered"
        ? "رسید معتبر تحویل پیام دریافت شد."
        : state === "accepted"
          ? "سرویس پیام را پذیرفت؛ پذیرش به معنی تحویل نیست."
          : "نتیجه ارسال را در تنظیمات بررسی کنید.",
      m.action_id ?? m.reminder_id,
    );
  await audit(db, user, "message_" + state, "message", id);
  return { ...m, state };
}
