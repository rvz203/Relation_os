import { z } from "zod";
import { DateTime } from "luxon";
import { query, transaction, lockOwner, pool, type DB } from "@/db";
import {
  dateSchema,
  actionSchema,
  owned,
  fail,
  checkVersion,
  audit,
  encrypt,
  decrypt,
  hash,
  text,
  uuid,
  isoDay,
} from "./core";
import {
  occurrences,
  originalISO,
  isValidOriginal,
  localToday,
  flowerSchedule,
} from "@/lib/calendar";
import type { Owner } from "./auth";
import { saveReminder } from "./settings";

export async function saveDate(user: string, input: unknown, id?: string) {
  return transaction(async (db) => {
    await lockOwner(db, user);
    const current = id ? await owned(db, "important_dates", user, id) : null;
    const d = dateSchema.parse({
      ...current,
      notes: decrypt(current?.notes),
      ...(input as object),
    });
    if (current)
      checkVersion(
        current as { version: number },
        (input as { version?: number })?.version,
      );
    await owned(db, "people", user, d.person_id, true);
    if (!isValidOriginal(d))
      fail("روز واردشده در تقویم انتخاب‌شده معتبر نیست.");
    if (d.recurrence === "none" && !d.original_year)
      fail("مناسبت یک‌باره به سال نیاز دارد.");
    const vals = [
      d.person_id,
      d.title,
      d.kind,
      d.calendar,
      d.original_year ?? null,
      d.month,
      d.day,
      originalISO(d),
      d.recurrence,
      d.leap_policy,
    ];
    const [r] = id
      ? await query(
          "UPDATE important_dates SET person_id=$3,title=$4,kind=$5,calendar=$6,original_year=$7,month=$8,day=$9,event_date=$10,recurrence=$11,leap_policy=$12,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
          [user, id, ...vals],
          db,
        )
      : await query(
          "INSERT INTO important_dates(user_id,person_id,title,kind,calendar,original_year,month,day,event_date,recurrence,leap_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [user, ...vals],
          db,
        );
    await db.query(
      "UPDATE important_dates SET notes=$3 WHERE user_id=$1 AND id=$2",
      [user, r.id, encrypt(d.notes)],
    );
    if (id) {
      await db.query(
        "UPDATE reminders SET version=version+1 WHERE user_id=$1 AND important_date_id=$2",
        [user, id],
      );
      await db.query(
        "UPDATE outbox_messages SET state='cancelled' WHERE user_id=$1 AND reminder_id IN(SELECT id FROM reminders WHERE user_id=$1 AND important_date_id=$2) AND state IN('queued','retry_wait')",
        [user, id],
      );
    }
    await audit(db, user, id ? "update" : "create", "important_date", r.id);
    return { ...r, notes: d.notes ?? "" };
  });
}
export async function calendar(user: Owner, from: string, to: string) {
  isoDay.parse(from);
  isoDay.parse(to);
  const start = DateTime.fromISO(from),
    end = DateTime.fromISO(to);
  if (
    !start.isValid ||
    !end.isValid ||
    end < start ||
    end.diff(start, "days").days > 365
  )
    fail("بازه تقویم باید معتبر و حداکثر ۳۶۶ روز باشد.");
  const dates = await query(
    "SELECT d.*,p.display_name person_name FROM important_dates d JOIN people p ON p.id=d.person_id AND p.user_id=d.user_id WHERE d.user_id=$1 AND d.is_active AND p.is_active",
    [user.id],
  );
  const events = dates.flatMap((d) =>
    occurrences(d as any, from, to).map((date) => ({
      ...d,
      notes: decrypt(d.notes),
      occurrence_date: date,
      event_type: "occasion",
    })),
  );
  const actions = await query(
    `SELECT a.*,p.display_name person_name FROM actions a JOIN people p ON p.id=a.person_id AND p.user_id=a.user_id WHERE a.user_id=$1 AND (a.due_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date AND a.status<>'cancelled' AND p.is_active`,
    [user.id, user.timezone, from, to],
  );
  return {
    items: [
      ...events,
      ...actions.map((a) => ({
        ...a,
        notes: decrypt(a.notes),
        occurrence_date: DateTime.fromJSDate(a.due_at)
          .setZone(user.timezone)
          .toISODate(),
        event_type: "action",
      })),
    ].sort((a, b) =>
      String(a.occurrence_date).localeCompare(String(b.occurrence_date)),
    ),
  };
}
export function publicAction(a: Record<string, any>) {
  if (a.delivery_address) a.delivery_address = decrypt(a.delivery_address);
  if (a.card_message) a.card_message = decrypt(a.card_message);
  a.notes = decrypt(a.notes);
  a.flower_notes = decrypt(a.flower_notes);
  return a;
}
export async function actionDetail(user: string, id: string, db: DB = pool) {
  await owned(db, "actions", user, id);
  const [a] = await query(
    `SELECT a.*,p.display_name person_name,f.florist_id,f.budget_amount,f.currency,f.delivery_date,f.delivery_address,f.card_message,f.delivery_local_time,f.timezone flower_timezone,f.notes flower_notes,f.sms_accepted_at,o.state sms_state,o.scheduled_at calculated_sms_at,o.error_code FROM actions a JOIN people p ON p.user_id=a.user_id AND p.id=a.person_id LEFT JOIN flower_details f ON f.action_id=a.id AND f.user_id=a.user_id LEFT JOIN outbox_messages o ON o.user_id=a.user_id AND o.dedupe_key='flower:'||a.id||':initial_sms' WHERE a.user_id=$1 AND a.id=$2`,
    [user, id],
    db,
  );
  return publicAction(a);
}
export async function saveAction(
  user: Owner,
  input: unknown,
  id?: string,
  dbExternal?: DB,
) {
  const run = async (db: DB) => {
    await lockOwner(db, user.id);
    const current = id ? await actionDetail(user.id, id, db) : null;
    const currentFlower =
      current?.action_type === "flower"
        ? {
            florist_id: current.florist_id,
            budget_amount: current.budget_amount,
            currency: current.currency,
            delivery_date: current.delivery_date,
            delivery_address: current.delivery_address,
            card_message: current.card_message,
            delivery_local_time: current.delivery_local_time,
            notes: current.flower_notes,
          }
        : undefined;
    const d = actionSchema.parse({
      ...current,
      ...(current
        ? {
            due_at: new Date(current.due_at).toISOString(),
            flower: currentFlower,
          }
        : {}),
      ...(input as object),
    });
    if (current) {
      checkVersion(
        current as { version: number },
        (input as { version?: number })?.version,
      );
      if (current.status !== "pending")
        fail("اقدام بسته‌شده قابل ویرایش نیست.", 409);
      if (current.action_type !== d.action_type)
        fail("نوع اقدام موجود تغییر نمی‌کند.");
      if (
        current.sms_accepted_at ||
        ["processing", "accepted", "delivered", "unknown"].includes(
          current.sms_state,
        )
      )
        fail(
          "ارسال آغاز شده است؛ ویرایش به گلفروش منتقل نمی‌شود. هماهنگی دستی لازم است.",
          409,
          "SEND_STARTED",
        );
    }
    const person = await owned(db, "people", user.id, d.person_id, true);
    if (d.important_date_id) {
      const date = await owned(
        db,
        "important_dates",
        user.id,
        d.important_date_id,
        true,
      );
      if (
        date.person_id !== d.person_id ||
        !d.occurrence_date ||
        !occurrences(date as any, d.occurrence_date, d.occurrence_date).length
      )
        fail("نوبت مناسبت با شخص و تاریخ مطابقت ندارد.");
    }
    if (d.action_type === "flower") {
      if (!d.flower) fail("جزئیات سفارش گل الزامی است.");
      await owned(db, "florists", user.id, d.flower.florist_id, true);
      if (!DateTime.fromISO(d.flower.delivery_date).isValid)
        fail("تاریخ تحویل معتبر نیست.");
      if (
        DateTime.fromISO(d.due_at).setZone(user.timezone).toISODate() !==
        d.flower.delivery_date
      )
        fail("روز موعد و روز تحویل گل باید یکسان باشند.");
    }
    const vals = [
      d.person_id,
      d.important_date_id ?? null,
      d.occurrence_date ?? null,
      d.action_type,
      d.title ??
        d.custom_title ??
        {
          call: "تماس",
          message: "پیام",
          meeting: "جلسه",
          gift: "هدیه",
          flower: "ارسال گل",
          reminder: "یادآوری",
          custom: "اقدام",
        }[d.action_type] +
          " · " +
          person.display_name,
      d.due_at,
      encrypt(d.notes),
    ];
    const [a] = id
      ? await query(
          "UPDATE actions SET person_id=$3,important_date_id=$4,occurrence_date=$5,action_type=$6,title=$7,due_at=$8,notes=$9,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
          [user.id, id, ...vals],
          db,
        )
      : await query(
          "INSERT INTO actions(user_id,person_id,important_date_id,occurrence_date,action_type,title,due_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [user.id, ...vals],
          db,
        );
    if (d.action_type === "flower" && d.flower) {
      const f = d.flower;
      await db.query(
        "INSERT INTO flower_details(action_id,user_id,florist_id,budget_amount,currency,delivery_date,delivery_address,card_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(action_id) DO UPDATE SET florist_id=$3,budget_amount=$4,currency=$5,delivery_date=$6,delivery_address=$7,card_message=$8,version=flower_details.version+1",
        [
          a.id,
          user.id,
          f.florist_id,
          f.budget_amount,
          f.currency,
          f.delivery_date,
          encrypt(f.delivery_address),
          encrypt(f.card_message) ?? "",
        ],
      );
      await db.query(
        "UPDATE flower_details SET delivery_local_time=$3,timezone=$4,notes=$5 WHERE user_id=$1 AND action_id=$2",
        [
          user.id,
          a.id,
          f.delivery_local_time ?? null,
          user.timezone,
          encrypt(f.notes),
        ],
      );
      const s = flowerSchedule(
        f.delivery_date,
        user.florist_send_local_time,
        user.timezone,
      );
      const late = f.delivery_date <= localToday(user.timezone);
      await db.query(
        `INSERT INTO outbox_messages(user_id,dedupe_key,action_id,channel,schedule_version,scheduled_at,deadline_at,state,error_code) VALUES($1,$2,$3,'sms',$4,$5,$6,$7,$8) ON CONFLICT(user_id,dedupe_key) DO UPDATE SET schedule_version=$4,scheduled_at=$5,deadline_at=$6,state=$7,error_code=$8,preview_fingerprint=NULL,payload_snapshot=NULL,next_attempt_at=NULL,updated_at=now() WHERE outbox_messages.state IN('queued','retry_wait','cancelled','expired','failed')`,
        [
          user.id,
          `flower:${a.id}:initial_sms`,
          a.id,
          a.version,
          s.scheduled_at,
          s.deadline_at,
          late ? "expired" : "queued",
          late ? "MANUAL_ACTION_REQUIRED" : null,
        ],
      );
    }
    if (d.reminder_at)
      await saveReminder(
        user,
        {
          action_id: a.id,
          channel: "in_app",
          message: a.title,
          scheduled_at: d.reminder_at,
        },
        undefined,
        db,
      );
    await audit(db, user.id, id ? "update" : "create", "action", a.id);
    return actionDetail(user.id, a.id, db);
  };
  return dbExternal ? run(dbExternal) : transaction(run);
}
export async function transitionAction(
  user: Owner,
  id: string,
  status: "done" | "cancelled",
  completedAt?: string,
) {
  return transaction(async (db) => {
    await lockOwner(db, user.id);
    const a = await owned(db, "actions", user.id, id);
    if (a.status === status) return actionDetail(user.id, id, db);
    if (a.status !== "pending")
      fail("این اقدام قبلاً بسته شده است.", 409, "INVALID_TRANSITION");
    const time = completedAt ? DateTime.fromISO(completedAt) : DateTime.now();
    if (!time.isValid || time > DateTime.now().plus({ minutes: 1 }))
      fail("زمان انجام معتبر نیست.");
    await db.query(
      "UPDATE actions SET status=$3,completed_at=$4,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2",
      [user.id, id, status, status === "done" ? time.toISO() : null],
    );
    await db.query(
      "UPDATE outbox_messages SET state='cancelled',updated_at=now() WHERE user_id=$1 AND action_id=$2 AND state IN('queued','retry_wait')",
      [user.id, id],
    );
    await db.query(
      "UPDATE reminders SET is_enabled=false,version=version+1 WHERE user_id=$1 AND action_id=$2",
      [user.id, id],
    );
    if (status === "done")
      await db.query(
        "INSERT INTO interactions(user_id,person_id,occurred_at,interaction_type,notes,source,related_action_id,counts_as_contact,dedupe_key) VALUES($1,$2,$3,$4,$5,'action',$6,$7,$8) ON CONFLICT(user_id,dedupe_key) DO NOTHING",
        [
          user.id,
          a.person_id,
          time.toISO(),
          a.action_type,
          encrypt(a.title),
          id,
          !["reminder", "custom"].includes(a.action_type),
          "action:" + id + ":complete",
        ],
      );
    const [sent] = await query(
      "SELECT count(*)::int n FROM outbox_messages WHERE user_id=$1 AND action_id=$2 AND state IN('processing','accepted','delivered','unknown')",
      [user.id, id],
      db,
    );
    await audit(db, user.id, status, "action", id);
    return {
      ...(await actionDetail(user.id, id, db)),
      warning: sent.n
        ? "پیام ممکن است قبلاً ارسال شده باشد؛ هماهنگی دستی لازم است."
        : null,
    };
  });
}
export async function addInteraction(user: string, input: unknown) {
  const d = z
    .object({
      person_id: uuid,
      interaction_type: z.enum([
        "call",
        "meeting",
        "message",
        "sms",
        "gift",
        "flower",
        "note",
        "custom",
      ]),
      notes: text.min(1),
      occurred_at: z.string().datetime({ offset: true }),
      direction: z.enum(["incoming", "outgoing"]).nullish(),
      related_message_id: uuid.nullish(),
    })
    .parse(input);
  if (DateTime.fromISO(d.occurred_at) > DateTime.now().plus({ minutes: 1 }))
    fail("تعامل نمی‌تواند در آینده باشد.");
  return transaction(async (db) => {
    await owned(db, "people", user, d.person_id, true);
    const [r] = await query(
      "INSERT INTO interactions(user_id,person_id,occurred_at,interaction_type,notes,counts_as_contact) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        user,
        d.person_id,
        d.occurred_at,
        d.interaction_type,
        encrypt(d.notes),
        !["note", "custom"].includes(d.interaction_type),
      ],
      db,
    );
    if (d.related_message_id)
      await owned(db, "outbox_messages", user, d.related_message_id);
    await db.query(
      "UPDATE interactions SET direction=$3,related_message_id=$4 WHERE user_id=$1 AND id=$2",
      [user, r.id, d.direction ?? null, d.related_message_id ?? null],
    );
    return { ...r, notes: d.notes, direction: d.direction ?? null };
  });
}
export async function idempotent(
  user: string,
  route: string,
  key: string | null,
  input: unknown,
  work: (db: DB) => Promise<unknown>,
) {
  if (!key || key.length > 200) fail("هدر Idempotency-Key الزامی است.");
  return transaction(async (db) => {
    await lockOwner(db, user);
    const fingerprint = hash(JSON.stringify(input));
    const [cached] = await query(
      "SELECT * FROM idempotency_requests WHERE user_id=$1 AND route=$2 AND idempotency_key=$3",
      [user, route, key],
      db,
    );
    if (cached) {
      if (cached.request_hash !== fingerprint)
        fail(
          "این کلید قبلاً با اطلاعات متفاوت استفاده شده است.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      return cached.response_body.ciphertext
        ? JSON.parse(decrypt(cached.response_body.ciphertext))
        : cached.response_body;
    }
    const result = await work(db);
    await db.query(
      "INSERT INTO idempotency_requests(user_id,route,idempotency_key,request_hash,response_body,response_code) VALUES($1,$2,$3,$4,$5,201)",
      [
        user,
        route,
        key,
        fingerprint,
        JSON.stringify({ ciphertext: encrypt(JSON.stringify(result)) }),
      ],
    );
    return result;
  });
}
