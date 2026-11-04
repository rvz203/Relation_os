import { z } from "zod";
import { DateTime, IANAZone } from "luxon";
import { query, transaction, lockOwner } from "@/db";
import {
  owned,
  checkVersion,
  mobile,
  encrypt,
  fail,
  audit,
  text,
  uuid,
} from "./core";
import type { Owner } from "./auth";
import { flowerSchedule } from "@/lib/calendar";
export async function saveSettings(user: Owner, input: unknown) {
  const d = z
    .object({
      display_name: text.min(1),
      timezone: text,
      florist_send_local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      sms_enabled: z.boolean(),
      owner_mobile: text.optional(),
    })
    .parse(input);
  if (!IANAZone.isValidZone(d.timezone)) fail("منطقه زمانی معتبر نیست.");
  return transaction(async (db) => {
    await lockOwner(db, user.id);
    await db.query(
      "UPDATE users SET display_name=$2,timezone=$3,florist_send_local_time=$4,sms_enabled=$5,updated_at=now() WHERE id=$1",
      [
        user.id,
        d.display_name,
        d.timezone,
        d.florist_send_local_time,
        d.sms_enabled,
      ],
    );
    if (d.owner_mobile !== undefined)
      await db.query(
        "UPDATE people SET mobile=$2,version=version+1 WHERE user_id=$1 AND is_self",
        [user.id, mobile(d.owner_mobile)],
      );
    if (d.timezone !== user.timezone) {
      await db.query(
        "UPDATE reminders SET scheduled_at=CASE WHEN scheduled_at IS NULL THEN NULL ELSE (scheduled_at AT TIME ZONE timezone) AT TIME ZONE $3 END,timezone=$3,version=version+1,updated_at=now() WHERE user_id=$1 AND timezone=$2 AND is_enabled",
        [user.id, user.timezone, d.timezone],
      );
      await db.query(
        "UPDATE outbox_messages SET state='cancelled',error_code='TIMEZONE_CHANGED',updated_at=now() WHERE user_id=$1 AND reminder_id IN(SELECT id FROM reminders WHERE user_id=$1 AND timezone=$2) AND state IN('queued','retry_wait')",
        [user.id, d.timezone],
      );
    }
    const flowers = await query(
      "SELECT a.id,a.version,f.delivery_date FROM actions a JOIN flower_details f ON f.action_id=a.id AND f.user_id=a.user_id WHERE a.user_id=$1 AND a.status='pending'",
      [user.id],
      db,
    );
    for (const f of flowers) {
      const s = flowerSchedule(
        f.delivery_date,
        d.florist_send_local_time,
        d.timezone,
      );
      await db.query(
        "UPDATE outbox_messages SET scheduled_at=$3,deadline_at=$4,updated_at=now() WHERE user_id=$1 AND action_id=$2 AND state IN('queued','retry_wait')",
        [user.id, f.id, s.scheduled_at, s.deadline_at],
      );
    }
    if (!d.sms_enabled)
      await db.query(
        "UPDATE outbox_messages SET state='cancelled',error_code='SMS_DISABLED',updated_at=now() WHERE user_id=$1 AND channel='sms' AND state IN('queued','retry_wait')",
        [user.id],
      );
    if (d.sms_enabled && !user.sms_enabled)
      await db.query(
        "UPDATE outbox_messages SET state='queued',error_code=NULL,updated_at=now() WHERE user_id=$1 AND channel='sms' AND state='cancelled' AND error_code='SMS_DISABLED' AND deadline_at>now()",
        [user.id],
      );
    await audit(db, user.id, "update", "settings", user.id, Object.keys(d));
    return d;
  });
}
export async function saveFlorist(user: string, input: unknown, id?: string) {
  return transaction(async (db) => {
    await lockOwner(db, user);
    const current = id ? await owned(db, "florists", user, id) : null;
    const d = z
      .object({
        name: text.min(1),
        mobile: text.min(1),
        notes: text.optional(),
        is_active: z.boolean().default(true),
        version: z.number().int().optional(),
      })
      .parse({ ...current, ...(input as object) });
    if (current) checkVersion(current as { version: number }, d.version);
    const number = mobile(d.mobile);
    const [r] = id
      ? await query(
          "UPDATE florists SET name=$3,mobile=$4,notes=$5,is_active=$6,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
          [user, id, d.name, number, d.notes ?? "", d.is_active],
          db,
        )
      : await query(
          "INSERT INTO florists(user_id,name,mobile,notes,is_active) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [user, d.name, number, d.notes ?? "", d.is_active],
          db,
        );
    if (id && !d.is_active) {
      await db.query(
        "UPDATE outbox_messages SET state='cancelled',error_code='FLORIST_INACTIVE',updated_at=now() WHERE user_id=$1 AND action_id IN(SELECT action_id FROM flower_details WHERE user_id=$1 AND florist_id=$2) AND state IN('queued','retry_wait')",
        [user, id],
      );
      await db.query(
        "INSERT INTO notifications(user_id,title,body,related_entity_id) VALUES($1,'گلفروش غیرفعال شد','برنامه‌های ارسال آینده این گلفروش متوقف شدند.',$2)",
        [user, id],
      );
    }
    await audit(db, user, id ? "update" : "create", "florist", r.id);
    return r;
  });
}
export async function saveReminder(user: Owner, input: unknown, id?: string) {
  return transaction(async (db) => {
    await lockOwner(db, user.id);
    const current = id ? await owned(db, "reminders", user.id, id) : null;
    const d = z
      .object({
        person_id: uuid.nullish(),
        important_date_id: uuid.nullish(),
        action_id: uuid.nullish(),
        channel: z.enum(["in_app", "sms"]).default("in_app"),
        recipient_person_id: uuid.nullish(),
        message: text.min(1),
        schedule_mode: z.enum(["once", "per_occurrence"]).default("once"),
        scheduled_at: z.string().datetime({ offset: true }).nullish(),
        offset_days: z.number().int().min(-365).max(365).default(0),
        local_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .default("09:00"),
        timezone: text.default(user.timezone),
        is_enabled: z.boolean().default(true),
        version: z.number().int().optional(),
      })
      .parse({ ...current, ...(input as object) });
    if (current) checkVersion(current as { version: number }, d.version);
    if (!IANAZone.isValidZone(d.timezone)) fail("منطقه زمانی معتبر نیست.");
    if (
      [d.person_id, d.action_id, d.important_date_id].filter(Boolean).length !==
      1
    )
      fail("یک هدف برای یادآوری انتخاب کنید.");
    if (d.schedule_mode === "per_occurrence" && !d.important_date_id)
      fail("یادآوری سالانه باید به مناسبت وصل شود.");
    if (
      d.schedule_mode === "once" &&
      (!d.scheduled_at || !DateTime.fromISO(d.scheduled_at).isValid)
    )
      fail("زمان یادآوری الزامی است.");
    if (d.person_id) await owned(db, "people", user.id, d.person_id, true);
    if (d.important_date_id)
      await owned(db, "important_dates", user.id, d.important_date_id, true);
    if (d.action_id) await owned(db, "actions", user.id, d.action_id);
    if (d.recipient_person_id)
      await owned(db, "people", user.id, d.recipient_person_id, true);
    const vals = [
      d.person_id ?? null,
      d.important_date_id ?? null,
      d.action_id ?? null,
      d.channel,
      d.recipient_person_id ?? null,
      encrypt(d.message),
      d.schedule_mode,
      d.scheduled_at ?? null,
      d.offset_days,
      d.local_time,
      d.timezone,
      d.is_enabled,
    ];
    const [r] = id
      ? await query(
          "UPDATE reminders SET person_id=$3,important_date_id=$4,action_id=$5,channel=$6,recipient_person_id=$7,message=$8,schedule_mode=$9,scheduled_at=$10,offset_days=$11,local_time=$12,timezone=$13,is_enabled=$14,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
          [user.id, id, ...vals],
          db,
        )
      : await query(
          "INSERT INTO reminders(user_id,person_id,important_date_id,action_id,channel,recipient_person_id,message,schedule_mode,scheduled_at,offset_days,local_time,timezone,is_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
          [user.id, ...vals],
          db,
        );
    if (id)
      await db.query(
        "UPDATE outbox_messages SET state='cancelled',updated_at=now() WHERE user_id=$1 AND reminder_id=$2 AND state IN('queued','retry_wait')",
        [user.id, id],
      );
    await audit(db, user.id, id ? "update" : "create", "reminder", r.id);
    return { ...r, message: d.message };
  });
}
