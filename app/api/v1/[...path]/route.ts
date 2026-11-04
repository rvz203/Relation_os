import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction, lockOwner, pool } from "@/db";
import { owner, login, COOKIE } from "@/lib/server/auth";
import {
  AppError,
  fail,
  owned,
  decrypt,
  hash,
  audit,
  text,
  normalize,
  uuid,
} from "@/lib/server/core";
import {
  archivePerson,
  listPeople,
  personDetail,
  savePerson,
  introductionPath,
} from "@/lib/server/people";
import { network, relationships, saveRelationship } from "@/lib/server/network";
import {
  calendar,
  saveDate,
  saveAction,
  actionDetail,
  transitionAction,
  publicAction,
  addInteraction,
  idempotent,
} from "@/lib/server/dates-actions";
import {
  smsPreview,
  queueSendNow,
  reconcileMessage,
} from "@/lib/server/messaging";
import { saveSettings, saveFlorist, saveReminder } from "@/lib/server/settings";
import {
  uploadImport,
  getImport,
  updateImport,
  commitImport,
  safeCSV,
} from "@/lib/server/imports";
import { localToday } from "@/lib/calendar";
import { receiveSMSWebhook } from "@/lib/server/webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: NextRequest, ctx: Context) {
  const requestId = randomUUID();
  const json = (value: unknown, status = 200) =>
    NextResponse.json(value, {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
    });
  try {
    const parts = (await ctx.params).path,
      route = parts.join("/"),
      method = req.method,
      params = req.nextUrl.searchParams;
    const mutation = !["GET", "HEAD"].includes(method);
    if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024)
      fail("درخواست بیش از حد بزرگ است.", 413);
    if (route === "auth/login" && method === "POST") return await login(req);
    if (route === "sms/webhooks/http" && method === "POST")
      return json(
        await receiveSMSWebhook(
          await req.text(),
          req.headers.get("x-sms-timestamp"),
          req.headers.get("x-sms-signature"),
        ),
      );
    const user = await owner(req, mutation),
      uid = user.id,
      id = parts[1];
    const body = async () => {
      try {
        return await req.json();
      } catch {
        fail("بدنه JSON معتبر نیست.", 400, "INVALID_JSON");
      }
    };
    if (route === "auth/me" && method === "GET")
      return json({ ...user, sms_mode: process.env.SMS_MODE ?? "sandbox" });
    if (route === "auth/logout" && method === "POST") {
      await query("DELETE FROM sessions WHERE token_hash=$1", [
        hash(req.cookies.get(COOKIE)!.value),
      ]);
      const res = json({ ok: true });
      res.cookies.delete(COOKIE);
      return res;
    }
    if (route === "auth/password" && method === "POST") {
      const { passwordHash, verifyPassword } =
        await import("@/lib/server/core");
      const d = z
        .object({
          current_password: z.string(),
          new_password: z.string().min(12).max(256),
        })
        .parse(await body());
      const [u] = await query("SELECT password_hash FROM users WHERE id=$1", [
        uid,
      ]);
      if (!verifyPassword(d.current_password, u.password_hash))
        fail("رمز فعلی درست نیست.");
      await transaction(async (db) => {
        await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          uid,
          passwordHash(d.new_password),
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
        await audit(db, uid, "password_changed", "user", uid);
      });
      return json({ ok: true });
    }
    if (route === "settings") {
      if (method === "GET") {
        const [self] = await query(
          "SELECT mobile FROM people WHERE user_id=$1 AND is_self",
          [uid],
        );
        return json({
          ...user,
          owner_mobile: self?.mobile ?? "",
          sms_mode: process.env.SMS_MODE ?? "sandbox",
        });
      }
      if (method === "PATCH")
        return json(await saveSettings(user, await body()));
      fail("روش مجاز نیست.", 405);
    }
    if (parts[0] === "people") {
      if (parts.length === 1 && method === "GET")
        return json(await listPeople(uid, params));
      if (parts.length === 1 && method === "POST") {
        const d = await body();
        return json(
          await idempotent(
            uid,
            route,
            req.headers.get("idempotency-key"),
            d,
            (db) => savePerson(uid, d, undefined, db),
          ),
          201,
        );
      }
      if (id) uuid.parse(id);
      if (parts.length === 2 && method === "GET")
        return json(await personDetail(uid, id));
      if (parts.length === 2 && method === "PATCH")
        return json(await savePerson(uid, await body(), id));
      if (parts[2] === "archive" && method === "POST")
        return json(await archivePerson(uid, id));
      if (parts[2] === "relationships" && method === "GET") {
        await owned(pool, "people", uid, id);
        return json({ items: await relationships(uid, id) });
      }
      if (parts[2] === "introduction-path" && method === "GET") {
        await owned(pool, "people", uid, id);
        return json(await introductionPath(uid, id));
      }
      if (parts[2] === "timeline" && method === "GET") {
        await owned(pool, "people", uid, id);
        const limit = Math.min(100, Number(params.get("limit")) || 30);
        const rows = await query(
          "SELECT * FROM interactions WHERE user_id=$1 AND person_id=$2 AND ($3::uuid IS NULL OR (occurred_at,id)<(SELECT occurred_at,id FROM interactions WHERE user_id=$1 AND person_id=$2 AND id=$3)) AND ($4::text IS NULL OR interaction_type=$4) ORDER BY occurred_at DESC,id DESC LIMIT $5",
          [uid, id, params.get("cursor"), params.get("type"), limit + 1],
        );
        return json({
          items: rows
            .slice(0, limit)
            .map((i) => ({ ...i, notes: decrypt(i.notes) })),
          next_cursor: rows.length > limit ? rows[limit - 1].id : null,
        });
      }
      if (parts[2] === "photo") {
        const p = await owned(pool, "people", uid, id);
        const folder = path.resolve(
          process.env.UPLOAD_DIR ?? "private/uploads",
          uid,
        );
        if (method === "GET") {
          if (!p.photo_key) fail("تصویری ثبت نشده است.", 404);
          return new NextResponse(
            await readFile(
              /* turbopackIgnore: true */ path.join(
                /* turbopackIgnore: true */ folder,
                p.photo_key,
              ),
            ),
            {
              headers: {
                "Content-Type": "image/webp",
                "Cache-Control": "private, max-age=60",
                "X-Content-Type-Options": "nosniff",
              },
            },
          );
        }
        if (method === "POST") {
          const file = (await req.formData()).get("file");
          if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
            fail("تصویر باید حداکثر ۵ مگابایت باشد.");
          const image = sharp(Buffer.from(await file.arrayBuffer()), {
            limitInputPixels: 25000000,
          });
          const meta = await image.metadata();
          if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
            fail("فقط JPEG، PNG یا WebP پذیرفته می‌شود.");
          const buffer = await image
            .rotate()
            .resize(500, 500, { fit: "cover", withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
          await mkdir(folder, { recursive: true, mode: 0o700 });
          const key = randomUUID() + ".webp";
          await writeFile(path.join(folder, key), buffer, { mode: 0o600 });
          await query(
            "UPDATE people SET photo_key=$3,version=version+1 WHERE user_id=$1 AND id=$2",
            [uid, id, key],
          );
          return json({ ok: true, photo_url: `/api/v1/people/${id}/photo` });
        }
      }
    }
    if (route === "network" && method === "GET")
      return json(await network(uid, params));
    if (parts[0] === "relationships") {
      if (method === "GET")
        return json({
          items: await relationships(uid, params.get("person_id") ?? undefined),
        });
      if (method === "POST" && !id)
        return json(await saveRelationship(uid, await body()), 201);
      if (method === "PATCH" && id)
        return json(await saveRelationship(uid, await body(), id));
      if (method === "DELETE" && id) {
        await owned(pool, "relationships", uid, id);
        await query(
          "UPDATE relationships SET archived_at=now(),version=version+1 WHERE user_id=$1 AND id=$2",
          [uid, id],
        );
        return json({ ok: true });
      }
    }
    if (parts[0] === "tags" || parts[0] === "relationship-types") {
      const table = parts[0] === "tags" ? "tags" : "relationship_types";
      if (method === "GET")
        return json({
          items: await query(
            `SELECT * FROM ${table} WHERE user_id=$1 AND is_active ORDER BY ${table === "tags" ? "name" : "label"}`,
            [uid],
          ),
        });
      if (table === "tags" && (method === "POST" || method === "PATCH")) {
        const d = z
          .object({
            name: text.min(1).max(80),
            kind: z.enum(["expertise", "label"]).default("expertise"),
          })
          .parse(await body());
        if (id) await owned(pool, table, uid, id);
        const [r] = id
          ? await query(
              "UPDATE tags SET name=$3,normalized_name=$4,kind=$5 WHERE user_id=$1 AND id=$2 RETURNING *",
              [uid, id, d.name, normalize(d.name), d.kind],
            )
          : await query(
              "INSERT INTO tags(user_id,name,normalized_name,kind) VALUES($1,$2,$3,$4) RETURNING *",
              [uid, d.name, normalize(d.name), d.kind],
            );
        return json(r, id ? 200 : 201);
      }
      if (
        table === "relationship_types" &&
        (method === "POST" || method === "PATCH")
      ) {
        const d = z
          .object({
            code: z.string().regex(/^[a-z][a-z_]{1,39}$/),
            label: text.min(1),
            reverse_label: text.optional(),
            is_directed: z.boolean(),
          })
          .parse(await body());
        return json(
          await transaction(async (db) => {
            await lockOwner(db, uid);
            if (id) {
              const current = await owned(db, table, uid, id);
              const [used] = await query(
                "SELECT count(*)::int n FROM relationships WHERE user_id=$1 AND relationship_type_id=$2",
                [uid, id],
                db,
              );
              if (used.n && current.is_directed !== d.is_directed)
                fail("جهت نوع استفاده‌شده تغییر نمی‌کند.");
            }
            const [r] = id
              ? await query(
                  "UPDATE relationship_types SET code=$3,label=$4,reverse_label=$5,is_directed=$6 WHERE user_id=$1 AND id=$2 RETURNING *",
                  [
                    uid,
                    id,
                    d.code,
                    d.label,
                    d.reverse_label ?? null,
                    d.is_directed,
                  ],
                  db,
                )
              : await query(
                  "INSERT INTO relationship_types(user_id,code,label,reverse_label,is_directed) VALUES($1,$2,$3,$4,$5) RETURNING *",
                  [
                    uid,
                    d.code,
                    d.label,
                    d.reverse_label ?? null,
                    d.is_directed,
                  ],
                  db,
                );
            return r;
          }),
          id ? 200 : 201,
        );
      }
    }
    if (parts[0] === "important-dates") {
      if (method === "GET")
        return json({
          items: await query(
            "SELECT d.*,p.display_name person_name FROM important_dates d JOIN people p ON p.id=d.person_id AND p.user_id=d.user_id WHERE d.user_id=$1 AND d.is_active AND p.is_active AND ($2::uuid IS NULL OR d.person_id=$2) ORDER BY d.month,d.day",
            [uid, params.get("person_id")],
          ),
        });
      if (method === "POST")
        return json(await saveDate(uid, await body()), 201);
      if (method === "PATCH" && id)
        return json(await saveDate(uid, await body(), id));
      if (method === "DELETE" && id) {
        return json(
          await transaction(async (db) => {
            await lockOwner(db, uid);
            await owned(db, "important_dates", uid, id);
            await db.query(
              "UPDATE important_dates SET is_active=false,version=version+1 WHERE user_id=$1 AND id=$2",
              [uid, id],
            );
            await db.query(
              "UPDATE actions SET status='cancelled',version=version+1 WHERE user_id=$1 AND important_date_id=$2 AND status='pending'",
              [uid, id],
            );
            await db.query(
              "UPDATE reminders SET is_enabled=false,version=version+1 WHERE user_id=$1 AND important_date_id=$2",
              [uid, id],
            );
            await db.query(
              "UPDATE outbox_messages SET state='cancelled' WHERE user_id=$1 AND state IN('queued','retry_wait') AND (action_id IN(SELECT id FROM actions WHERE user_id=$1 AND important_date_id=$2) OR reminder_id IN(SELECT id FROM reminders WHERE user_id=$1 AND important_date_id=$2))",
              [uid, id],
            );
            return { ok: true };
          }),
        );
      }
    }
    if (route === "calendar" && method === "GET")
      return json(
        await calendar(
          user,
          params.get("from") ?? localToday(user.timezone),
          params.get("to") ??
            DateTime.now()
              .setZone(user.timezone)
              .plus({ days: 30 })
              .toISODate()!,
        ),
      );
    if (parts[0] === "actions") {
      if (parts.length === 1 && method === "GET") {
        const limit = Math.min(
          100,
          Math.max(1, Number(params.get("limit")) || 30),
        );
        const rows = await query(
          `SELECT a.*,p.display_name person_name,o.state sms_state,o.error_code,o.scheduled_at calculated_sms_at FROM actions a JOIN people p ON p.id=a.person_id AND p.user_id=a.user_id LEFT JOIN outbox_messages o ON o.user_id=a.user_id AND o.dedupe_key='flower:'||a.id||':initial_sms' WHERE a.user_id=$1 AND ($2::text IS NULL OR a.status=$2) AND ($3::uuid IS NULL OR a.person_id=$3) AND ($4::timestamptz IS NULL OR a.due_at>=$4) AND ($5::timestamptz IS NULL OR a.due_at<=$5) AND ($6::uuid IS NULL OR a.id>$6) ORDER BY a.id LIMIT $7`,
          [
            uid,
            params.get("status"),
            params.get("person_id"),
            params.get("due_from"),
            params.get("due_to"),
            params.get("cursor"),
            limit + 1,
          ],
        );
        return json({
          items: rows.slice(0, limit).map(publicAction),
          next_cursor: rows.length > limit ? rows[limit - 1].id : null,
        });
      }
      if (parts.length === 1 && method === "POST") {
        const d = await body();
        return json(
          await idempotent(
            uid,
            route,
            req.headers.get("idempotency-key"),
            d,
            (db) => saveAction(user, d, undefined, db),
          ),
          201,
        );
      }
      if (parts.length === 2 && method === "GET")
        return json(await actionDetail(uid, id));
      if (parts.length === 2 && method === "PATCH")
        return json(await saveAction(user, await body(), id));
      if (parts[2] === "complete" && method === "POST")
        return json(
          await transitionAction(user, id, "done", (await body()).completed_at),
        );
      if (parts[2] === "cancel" && method === "POST")
        return json(await transitionAction(user, id, "cancelled"));
      if (parts[2] === "sms-preview" && method === "POST")
        return json(await smsPreview(user, id));
      if (parts[2] === "send-now" && method === "POST") {
        const d = await body();
        return json(
          await idempotent(
            uid,
            route,
            req.headers.get("idempotency-key"),
            d,
            (db) => queueSendNow(user, id, d.preview_token, db),
          ),
          202,
        );
      }
    }
    if (parts[0] === "interactions" && method === "POST")
      return json(await addInteraction(uid, await body()), 201);
    if (parts[0] === "florists") {
      if (method === "GET")
        return json({
          items: await query(
            "SELECT * FROM florists WHERE user_id=$1 ORDER BY created_at",
            [uid],
          ),
        });
      if (method === "POST")
        return json(await saveFlorist(uid, await body()), 201);
      if (method === "PATCH" && id)
        return json(await saveFlorist(uid, await body(), id));
    }
    if (parts[0] === "reminders") {
      if (method === "GET")
        return json({
          items: (
            await query(
              "SELECT * FROM reminders WHERE user_id=$1 ORDER BY created_at DESC",
              [uid],
            )
          ).map((r) => ({ ...r, message: decrypt(r.message) })),
        });
      if (method === "POST")
        return json(await saveReminder(user, await body()), 201);
      if (method === "PATCH" && id)
        return json(await saveReminder(user, await body(), id));
      if (method === "DELETE" && id) {
        const r = await owned(pool, "reminders", uid, id);
        return json(
          await saveReminder(
            user,
            {
              ...r,
              message: decrypt(r.message),
              is_enabled: false,
              scheduled_at: r.scheduled_at
                ? new Date(r.scheduled_at).toISOString()
                : null,
            },
            id,
          ),
        );
      }
    }
    if (parts[0] === "notifications") {
      if (method === "GET")
        return json({
          items: await query(
            "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
            [uid],
          ),
        });
      if (parts[2] === "read" && method === "POST") {
        await owned(pool, "notifications", uid, id);
        await query(
          "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=$2",
          [uid, id],
        );
        return json({ ok: true });
      }
    }
    if (parts[0] === "messages") {
      if (parts[2] === "reconcile" && method === "POST")
        return json(await reconcileMessage(uid, id));
      if (method === "GET" && id) {
        const m = await owned(pool, "outbox_messages", uid, id);
        return json({
          ...m,
          payload: m.payload_snapshot
            ? JSON.parse(decrypt(m.payload_snapshot))
            : null,
          logs: await query(
            "SELECT * FROM sms_logs WHERE user_id=$1 AND outbox_message_id=$2 ORDER BY attempt_no",
            [uid, id],
          ),
        });
      }
      if (method === "GET")
        return json({
          items: await query(
            "SELECT id,action_id,channel,state,error_code,attempt_count,scheduled_at,updated_at,provider_message_id FROM outbox_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
            [uid],
          ),
        });
    }
    if (parts[0] === "imports") {
      if (route === "imports/template" && method === "GET")
        return new NextResponse(
          "\uFEFFexternal_id,person_name,mobile,company,expertise,introduced_by_external_id,relationship_type\n1,نمونه اول,,شرکت نمونه,طراحی,,\n2,نمونه دوم,,,مدیریت,1,colleague\n",
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="people-template.csv"',
            },
          },
        );
      if (route === "imports/people" && method === "POST") {
        const file = (await req.formData()).get("file");
        if (!(file instanceof File)) fail("فایل را انتخاب کنید.");
        return json(await uploadImport(uid, file), 202);
      }
      if (id && method === "GET" && parts.length === 2)
        return json(await getImport(uid, id));
      if (id && parts[2] === "mapping" && method === "PATCH")
        return json(await updateImport(uid, id, await body()));
      if (id && parts[2] === "validate" && method === "POST")
        return json(await updateImport(uid, id, {}));
      if (id && parts[2] === "commit" && method === "POST")
        return json(await commitImport(uid, id, (await body()).checksum), 202);
      if (id && parts[2] === "errors" && method === "GET") {
        const job = await getImport(uid, id);
        const csv = [
          "row,error",
          ...job.rows.flatMap((r) =>
            r.errors.map(
              (e) => r.row_number + ',"' + safeCSV(e).replace(/"/g, '""') + '"',
            ),
          ),
        ].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="import-errors.csv"',
            "Cache-Control": "no-store",
          },
        });
      }
    }
    if (route === "dashboard" && method === "GET") {
      const today = localToday(user.timezone),
        days = [1, 7, 30].includes(Number(params.get("days")))
          ? Number(params.get("days"))
          : 7;
      const [stats] = await query(
        `SELECT (SELECT count(*)::int FROM people WHERE user_id=$1 AND is_active AND NOT is_self) people,(SELECT count(*)::int FROM relationships r JOIN people a ON a.id=r.person_a_id AND a.user_id=r.user_id JOIN people b ON b.id=r.person_b_id AND b.user_id=r.user_id WHERE r.user_id=$1 AND r.archived_at IS NULL AND a.is_active AND b.is_active) relationships,(SELECT count(*)::int FROM people WHERE user_id=$1 AND is_active AND importance_level='A' AND NOT is_self) important,(SELECT count(*)::int FROM actions WHERE user_id=$1 AND status='pending') pending,(SELECT count(*)::int FROM actions WHERE user_id=$1 AND status='pending' AND due_at<now()) overdue,(SELECT count(*)::int FROM tags WHERE user_id=$1 AND is_active AND kind='expertise') expertise`,
        [uid],
      );
      const events = await calendar(
        user,
        today,
        DateTime.fromISO(today)
          .plus({ days: days - 1 })
          .toISODate()!,
      );
      const tasks = await query(
        `SELECT a.*,p.display_name person_name,o.state sms_state FROM actions a JOIN people p ON p.id=a.person_id AND p.user_id=a.user_id LEFT JOIN outbox_messages o ON o.user_id=a.user_id AND o.dedupe_key='flower:'||a.id||':initial_sms' WHERE a.user_id=$1 AND a.status='pending' AND (a.due_at AT TIME ZONE $2)::date<=$3::date ORDER BY a.due_at LIMIT 30`,
        [
          uid,
          user.timezone,
          DateTime.fromISO(today)
            .plus({ days: days - 1 })
            .toISODate(),
        ],
      );
      const reconnect = await query(
        `SELECT p.id,p.display_name,p.company,p.importance_level,p.photo_key,max(i.occurred_at) last_interaction_at FROM people p LEFT JOIN interactions i ON i.person_id=p.id AND i.user_id=p.user_id AND i.counts_as_contact WHERE p.user_id=$1 AND p.is_active AND NOT p.is_self GROUP BY p.id ORDER BY max(i.occurred_at) ASC NULLS FIRST LIMIT 4`,
        [uid],
      );
      const [health] = await query(
        "SELECT last_seen_at FROM worker_health WHERE name='scheduler'",
      );
      return json({
        stats,
        today,
        events: events.items,
        tasks: tasks.map(publicAction),
        reconnect,
        worker_last_seen_at: health?.last_seen_at ?? null,
      });
    }
    fail("مسیر پیدا نشد.", 404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof SyntaxError)
      return json(
        {
          error: {
            code: "INVALID_JSON",
            message: "بدنه JSON معتبر نیست.",
            request_id: requestId,
          },
        },
        400,
      );
    if (error instanceof z.ZodError)
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "اطلاعات فرم معتبر نیست.",
            fields: error.flatten().fieldErrors,
            request_id: requestId,
          },
        },
        422,
      );
    if (error instanceof AppError)
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
            request_id: requestId,
          },
        },
        error.status,
      );
    const code = (error as { code?: string }).code;
    if (code === "23505")
      return json(
        {
          error: {
            code: "DUPLICATE",
            message: "این رکورد یا رابطه قبلاً ثبت شده است.",
            request_id: requestId,
          },
        },
        409,
      );
    if (["23503", "23514", "22P02", "22007", "22008"].includes(code ?? ""))
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "مقادیر یا ارتباط رکوردها معتبر نیست.",
            request_id: requestId,
          },
        },
        422,
      );
    console.error(
      "API error",
      requestId,
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "خطای سرور؛ دوباره تلاش کنید.",
          request_id: requestId,
        },
      },
      500,
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
