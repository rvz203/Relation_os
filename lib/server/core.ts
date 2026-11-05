import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { query, type DB } from "@/db";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export const auditContext = new AsyncLocalStorage<{ requestId: string }>();
export function fail(
  message: string,
  status = 422,
  code = "VALIDATION_ERROR",
): never {
  throw new AppError(status, code, message);
}
export function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[\s\u200c]+/g, " ")
    .trim()
    .toLowerCase();
}
export function mobile(value?: string | null) {
  if (!value?.trim()) return null;
  let v = normalize(value).replace(/[\s()-]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (/^09\d{9}$/.test(v)) v = "+98" + v.slice(1);
  if (!/^\+[1-9]\d{7,14}$/.test(v))
    fail("شماره موبایل معتبر نیست؛ مانند 09123456789.");
  return v;
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function encryptionKey() {
  const value = process.env.DATA_ENCRYPTION_KEY ?? "";
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new Error("DATA_ENCRYPTION_KEY must contain 64 hex characters");
  return Buffer.from(value, "hex");
}
export function encrypt(value: string | null | undefined) {
  if (!value) return null;
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}
export function decrypt(value: string | null | undefined): string {
  if (!value) return "";
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported encrypted data version");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [, salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const a = scryptSync(password, salt, 64),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function audit(
  db: DB,
  user: string,
  event: string,
  entity: string,
  id?: string,
  fields: string[] = [],
) {
  await db.query(
    "INSERT INTO audit_logs(user_id,event,entity_type,entity_id,changed_fields,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$1,$6)",
    [
      user,
      event,
      entity,
      id ?? null,
      fields,
      auditContext.getStore()?.requestId ?? randomUUID(),
    ],
  );
}
export const uuid = z.string().uuid();
export async function owned(
  db: DB,
  table: string,
  user: string,
  id: string,
  active = false,
) {
  uuid.parse(id);
  const [row] = await query(
    `SELECT * FROM ${table} WHERE user_id=$1 AND id=$2${active ? " AND is_active=true" : ""}`,
    [user, id],
    db,
  );
  if (!row) fail("رکورد پیدا نشد.", 404, "NOT_FOUND");
  return row;
}
export function checkVersion(
  row: { version: number },
  version: number | undefined,
) {
  if (version === undefined)
    fail("نسخه رکورد برای ویرایش الزامی است.", 422, "VERSION_REQUIRED");
  if (row.version !== version)
    fail(
      "اطلاعات تغییر کرده است. فرم شما حفظ شد؛ اطلاعات تازه را بارگذاری کنید.",
      409,
      "VERSION_CONFLICT",
    );
}
export const text = z.string().trim().max(10000);
export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => DateTime.fromISO(s, { zone: "UTC" }).isValid,
    "تاریخ معتبر نیست.",
  );
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const personSchema = z.object({
  display_name: z.string().trim().max(200).optional(),
  first_name: z.string().trim().max(100).optional(),
  last_name: text.optional(),
  mobile: text.nullish(),
  email: z.union([z.string().email(), z.literal("")]).nullish(),
  company: text.optional(),
  job_title: text.optional(),
  city: text.optional(),
  address: text.optional(),
  notes: text.optional(),
  private_notes: text.optional(),
  gender: text.nullish(),
  country_code: z
    .union([z.string().regex(/^[A-Z]{2}$/), z.literal("")])
    .nullish(),
  industry: text.nullish(),
  activity_area: text.nullish(),
  first_met_on: isoDay.nullish(),
  acquaintance_notes: text.optional(),
  expertise: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  labels: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  importance_level: z.enum(["A", "B", "C"]).default("B"),
  introduction_source: z
    .enum(["direct", "person", "unknown"])
    .default("direct"),
  introduced_by_person_id: uuid.nullish(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  version: z.number().int().positive().optional(),
});
export const dateSchema = z.object({
  person_id: uuid,
  title: text.min(1),
  kind: z.enum(["birthday", "anniversary", "custom"]).default("custom"),
  calendar: z.enum(["jalali", "gregorian"]),
  original_year: z.number().int().min(1).max(9999).nullish(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  recurrence: z.enum(["none", "yearly"]).default("yearly"),
  leap_policy: z.enum(["last_valid_day", "skip"]).default("last_valid_day"),
  version: z.number().int().optional(),
  notes: text.optional(),
});
export const flowerSchema = z.object({
  florist_id: uuid,
  budget_amount: z.number().int().positive().max(1e12),
  currency: z.enum(["IRT", "IRR"]).default("IRT"),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  delivery_address: text.min(1),
  card_message: text.default(""),
  delivery_local_time: localTime.nullish(),
  notes: text.optional(),
});
export const actionSchema = z.object({
  person_id: uuid,
  action_type: z.enum([
    "call",
    "message",
    "meeting",
    "gift",
    "flower",
    "reminder",
    "custom",
  ]),
  title: text.min(1).optional(),
  custom_title: text.min(1).optional(),
  due_at: z.string().datetime({ offset: true }),
  important_date_id: uuid.nullish(),
  occurrence_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  notes: text.optional(),
  flower: flowerSchema.optional(),
  version: z.number().int().optional(),
  reminder_at: z.string().datetime({ offset: true }).nullish(),
});
