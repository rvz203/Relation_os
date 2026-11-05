import Papa from "papaparse";
import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { personSchema, AppError } from "./core";
import { z } from "zod";
import { query, transaction, lockOwner, pool, type DB } from "@/db";
import {
  decrypt,
  encrypt,
  fail,
  hash,
  mobile,
  normalize,
  owned,
  audit,
} from "./core";
import { savePerson, checkIntroduction } from "./people";
import { saveRelationship } from "./network";

type Raw = Record<string, string>;
type Decision = {
  operation: "new" | "existing" | "skip";
  person_id?: string;
  confirmed?: boolean;
};
type Row = {
  row_number: number;
  data: Raw;
  errors: string[];
  similar: { id: string; display_name: string }[];
  decision: Decision;
};
type Staged = {
  headers: string[];
  raw: Raw[];
  rows: Row[];
  external_references?: Record<string, string>;
};
const fields = [
  "external_id",
  "person_name",
  "mobile",
  "company",
  "job_title",
  "expertise",
  "tags",
  "notes",
  "introduced_by_external_id",
  "introduced_by",
  "parent",
  "relationship_type",
];
async function inspectZip(buffer: Buffer) {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new Error("فایل XLSX معتبر نیست."));
      let size = 0,
        count = 0;
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        if (/vbaProject|externalLinks/i.test(entry.fileName)) {
          zip.close();
          reject(new Error("ماکرو و پیوند خارجی پذیرفته نمی‌شود."));
          return;
        }
        size += entry.uncompressedSize;
        count++;
        if (size > 50 * 1024 * 1024 || count > 10000) {
          zip.close();
          reject(new Error("حجم بازشده فایل بیش از حد مجاز است."));
        } else zip.readEntry();
      });
      zip.readEntry();
    });
  });
}
async function parseFile(file: File) {
  if (file.size > 5 * 1024 * 1024) fail("حداکثر اندازه فایل ۵ مگابایت است.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let raw: Raw[] = [];
  let headers: string[] = [];
  if (file.name.toLowerCase().endsWith(".csv")) {
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      fail("فایل CSV باید UTF-8 باشد.");
    }
    const parsed = Papa.parse<Raw>(decoded, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
    });
    const parseErrors = parsed.errors.filter(
      (e) => e.code !== "UndetectableDelimiter",
    );
    if (parseErrors.length)
      fail("ساختار CSV معتبر نیست: " + parseErrors[0].message);
    raw = parsed.data;
    headers = parsed.meta.fields ?? [];
  } else if (file.name.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await inspectZip(buffer);
      await workbook.xlsx.load(buffer as any);
    } catch {
      fail("فایل XLSX خراب است یا حجم بازشده آن بیش از حد مجاز است.");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) fail("فایل برگه‌ای ندارد.");
    if (
      sheet.rowCount > 5001 ||
      sheet.columnCount > 100 ||
      sheet.rowCount * sheet.columnCount > 250000
    )
      fail("تعداد سطر یا سلول بیش از حد مجاز است.");
    for (const s of workbook.worksheets)
      s.eachRow((row) =>
        row.eachCell((cell) => {
          if (
            cell.type === ExcelJS.ValueType.Formula ||
            cell.type === ExcelJS.ValueType.Hyperlink
          )
            fail("فرمول و پیوند خارجی در فایل پذیرفته نمی‌شود.");
        }),
      );
    sheet.getRow(1).eachCell((cell, i) => {
      headers[i - 1] = String(cell.text).trim();
    });
    for (let i = 2; i <= sheet.rowCount; i++) {
      const record: Raw = {};
      headers.forEach((h, j) => {
        if (h)
          record[h] = sheet
            .getRow(i)
            .getCell(j + 1)
            .text.trim();
      });
      if (Object.values(record).some(Boolean)) raw.push(record);
    }
  } else fail("فقط CSV و XLSX بدون ماکرو پذیرفته می‌شود.");
  if (!raw.length || raw.length > 5000)
    fail("فایل باید بین ۱ و ۵۰۰۰ سطر داشته باشد.");
  return { headers, raw, checksum: hash(buffer.toString("base64")) };
}
async function validate(
  user: string,
  staged: Staged,
  mapping: Record<string, string>,
  decisions: Record<string, Decision> = {},
  db: DB = pool,
): Promise<Staged> {
  const people = await query(
      "SELECT id,display_name,mobile,introduced_by_person_id,is_self FROM people WHERE user_id=$1 AND is_active",
      [user],
      db,
    ),
    byId = new Map(people.map((p) => [p.id, p]));
  const types = await query(
    "SELECT id,label,code FROM relationship_types WHERE user_id=$1 AND is_active",
    [user],
    db,
  );
  const rows: Row[] = staged.raw.map((raw, i) => {
    const data: Raw = {};
    for (const f of fields) data[f] = String(raw[mapping[f] ?? f] ?? "").trim();
    const decision = decisions[String(i + 2)] ??
      staged.rows?.[i]?.decision ?? { operation: "new" };
    let phone: string | null = null;
    try {
      phone = mobile(data.mobile);
    } catch {}
    return {
      row_number: i + 2,
      data,
      decision,
      errors: [],
      similar: people
        .filter(
          (p) =>
            !p.is_self &&
            (normalize(p.display_name) === normalize(data.person_name) ||
              (phone && p.mobile === phone)),
        )
        .map((p) => ({ id: p.id, display_name: p.display_name })),
    };
  });
  const ids = new Map<string, Row[]>();
  for (const r of rows)
    if (r.data.external_id)
      ids.set(r.data.external_id, [...(ids.get(r.data.external_id) ?? []), r]);
  const identity = (row: Row) =>
    row.decision.operation === "existing"
      ? row.decision.person_id!
      : "row:" + row.row_number;
  const references = staged.external_references ?? {};
  const lookup = (ref: string): string | undefined => {
    if (ref.startsWith("@person:")) {
      const id = ref.slice(8);
      return byId.has(id) ? id : undefined;
    }
    if (ref.startsWith("@row:")) {
      const r = rows.find((r) => r.row_number === Number(ref.slice(5)));
      return r && r.decision.operation !== "skip" ? identity(r) : undefined;
    }
    const matches = ids.get(ref);
    if (matches?.length === 1 && matches[0].decision.operation !== "skip")
      return identity(matches[0]);
    return !matches && references[ref] && byId.has(references[ref])
      ? references[ref]
      : undefined;
  };
  for (const r of rows) {
    if (r.decision.operation === "skip") continue;
    const d = r.data;
    if (!d.person_name) r.errors.push("نام الزامی است.");
    const parsed = personSchema.safeParse({
      display_name: d.person_name,
      mobile: d.mobile,
      company: d.company,
      job_title: d.job_title,
      notes: d.notes,
      tags: [d.expertise, d.tags]
        .join(";")
        .split(/[;,،]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!parsed.success)
      r.errors.push("طول نام، برچسب یا اطلاعات واردشده معتبر نیست.");
    try {
      mobile(d.mobile);
    } catch {
      r.errors.push("شماره موبایل معتبر نیست.");
    }
    if (d.external_id && (ids.get(d.external_id)?.length ?? 0) > 1)
      r.errors.push("external_id تکراری است.");
    if (r.decision.operation === "existing" && !byId.has(r.decision.person_id))
      r.errors.push("شخص موجود را انتخاب کنید.");
    const fileSimilar = rows.filter(
      (other) =>
        other !== r &&
        other.decision.operation !== "skip" &&
        normalize(other.data.person_name) === normalize(d.person_name),
    );
    if (
      (r.similar.length || fileSimilar.length) &&
      r.decision.operation === "new" &&
      !r.decision.confirmed
    )
      r.errors.push(
        "فرد مشابه یافت شد؛ ساخت جدید، اتصال یا نادیده گرفتن را صریح انتخاب کنید.",
      );
    if (!d.introduced_by_external_id && (d.parent || d.introduced_by)) {
      const name = normalize(d.parent || d.introduced_by),
        matches = rows.filter(
          (other) =>
            normalize(other.data.person_name) === name &&
            other.decision.operation !== "skip",
        );
      if (matches.length === 1)
        d.introduced_by_external_id = "@row:" + matches[0].row_number;
      else if (matches.length > 1)
        r.errors.push("نام معرفی‌کننده در فایل یکتا نیست.");
      else {
        const existing = people.filter(
          (p) => normalize(p.display_name) === name,
        );
        if (existing.length === 1)
          d.introduced_by_external_id = "@person:" + existing[0].id;
        else r.errors.push("نام معرفی‌کننده در شبکه موجود یا یکتا نیست.");
      }
    }
    if (d.introduced_by_external_id && !lookup(d.introduced_by_external_id))
      r.errors.push(
        "شناسه معرفی‌کننده موجود یا یکتا نیست؛ نگاشت شبکه را بررسی کنید.",
      );
    if (d.relationship_type) {
      const matches = types.filter((t) => t.code === d.relationship_type);
      const named = matches.length
        ? matches
        : types.filter((t) => t.label === d.relationship_type);
      if (named.length !== 1)
        r.errors.push("نوع رابطه تعریف نشده یا مبهم است.");
      else d._relationship_type_id = named[0].id;
      if (!d.introduced_by_external_id)
        r.errors.push("رابطه به معرفی‌کننده نیاز دارد.");
    }
  }
  const assigned = new Map<string, string>();
  for (const r of rows) {
    if (r.decision.operation === "skip" || !r.data.introduced_by_external_id)
      continue;
    const id = identity(r),
      parent = lookup(r.data.introduced_by_external_id);
    if (!parent) continue;
    if (assigned.has(id) && assigned.get(id) !== parent) {
      for (const other of rows)
        if (identity(other) === id)
          other.errors.push(
            "برای یک شخص، دو معرفی‌کننده متفاوت تعیین شده است.",
          );
    }
    assigned.set(id, parent);
  }
  const parents = new Map<string, string | null>(
    people.map((p) => [p.id, p.introduced_by_person_id ?? null]),
  );
  for (const r of rows)
    if (r.decision.operation !== "skip" && r.data.introduced_by_external_id) {
      const parent = lookup(r.data.introduced_by_external_id);
      if (parent) {
        parents.set(identity(r), parent);
        r.data._parent_identity = parent;
      }
    }
  for (const r of rows) {
    if (r.decision.operation === "skip") continue;
    const visited = new Set<string>();
    let at: string | null = identity(r);
    while (at) {
      if (visited.has(at)) {
        r.errors.push("چرخه یا خودمعرفی در زنجیره معرفی.");
        break;
      }
      visited.add(at);
      at = parents.get(at) ?? null;
    }
  }
  return { ...staged, rows };
}
export async function uploadImport(
  user: string,
  file: File,
  allowDuplicate = false,
) {
  const parsed = await parseFile(file);
  const [duplicate] = await query(
    "SELECT id,status FROM import_jobs WHERE user_id=$1 AND checksum=$2 ORDER BY created_at DESC LIMIT 1",
    [user, parsed.checksum],
  );
  if (duplicate && !allowDuplicate)
    return { job_id: duplicate.id, duplicate: true, status: duplicate.status };
  const staged = await validate(user, { ...parsed, rows: [] }, {});
  const [job] = await query(
    "INSERT INTO import_jobs(user_id,filename,checksum,staged_data) VALUES($1,$2,$3,$4) RETURNING id",
    [
      user,
      file.name.slice(0, 200),
      parsed.checksum,
      encrypt(JSON.stringify(staged)),
    ],
  );
  return { job_id: job.id };
}
export async function getImport(user: string, id: string) {
  const job = await owned(pool, "import_jobs", user, id);
  if (new Date(job.expires_at) < new Date() && job.status !== "committed")
    fail("پیش‌نمایش منقضی شده است.", 410);
  if (job.purged_at)
    return {
      id: job.id,
      filename: job.filename,
      status: job.status,
      checksum: job.checksum,
      result: job.result,
      mapping: job.mapping,
      headers: [],
      raw: [],
      rows: [],
      valid: job.status === "committed",
    };
  const staged: Staged = JSON.parse(decrypt(job.staged_data));
  return {
    id: job.id,
    filename: job.filename,
    status: job.status,
    checksum: job.checksum,
    result: job.result,
    mapping: job.mapping,
    external_references: job.external_references,
    error_message: job.error_message,
    ...staged,
    valid: staged.rows.every((r) => !r.errors.length),
  };
}
export async function updateImport(
  user: string,
  id: string,
  input: {
    mapping?: Record<string, string>;
    decisions?: Record<string, Decision>;
    external_references?: Record<string, string>;
  },
) {
  input = z
    .object({
      mapping: z.record(z.string().max(200)).optional(),
      external_references: z.record(z.string().uuid()).optional(),
      decisions: z
        .record(
          z.object({
            operation: z.enum(["new", "existing", "skip"]),
            person_id: z.string().uuid().optional(),
            confirmed: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .parse(input);
  return transaction(async (db) => {
    await lockOwner(db, user);
    const job = await owned(db, "import_jobs", user, id);
    if (!["preview", "failed"].includes(job.status))
      fail("این ورود قفل یا ثبت شده است.", 409);
    if (new Date(job.expires_at) < new Date() || job.purged_at)
      fail("پیش‌نمایش منقضی شده است.", 410);
    const mapping = input.mapping ?? job.mapping;
    const staged = await validate(
      user,
      {
        ...JSON.parse(decrypt(job.staged_data)),
        external_references:
          input.external_references ?? job.external_references,
      },
      mapping,
      input.decisions,
      db,
    );
    await db.query(
      "UPDATE import_jobs SET mapping=$3,staged_data=$4,external_references=$5,status='preview',error_message=NULL WHERE user_id=$1 AND id=$2",
      [
        user,
        id,
        JSON.stringify(mapping),
        encrypt(JSON.stringify(staged)),
        JSON.stringify(staged.external_references ?? {}),
      ],
    );
    return {
      valid: staged.rows.every((r) => !r.errors.length),
      rows: staged.rows,
    };
  });
}
export async function commitImport(user: string, id: string, checksum: string) {
  return transaction(async (db) => {
    await lockOwner(db, user);
    const job = await owned(db, "import_jobs", user, id);
    if (job.status === "committed") return job.result;
    if (job.checksum !== checksum || new Date(job.expires_at) < new Date())
      fail("پیش‌نمایش منقضی یا تغییر کرده است.", 409);
    const original: Staged = {
      ...JSON.parse(decrypt(job.staged_data)),
      external_references: job.external_references,
    };
    const decisions = Object.fromEntries(
      original.rows.map((r) => [String(r.row_number), r.decision]),
    );
    const staged = await validate(user, original, job.mapping, decisions, db);
    if (staged.rows.some((r) => r.errors.length))
      fail("ابتدا خطاهای پیش‌نمایش را اصلاح کنید.");
    const map = new Map<string, string>(
        Object.entries(job.external_references ?? {}),
      ),
      result = { created: 0, linked: 0, skipped: 0, errors: 0 };
    for (const row of staged.rows) {
      if (row.decision.operation === "skip") {
        result.skipped++;
        continue;
      }
      let personId = row.decision.person_id;
      if (row.decision.operation === "new") {
        const d = row.data;
        const person = await savePerson(
          user,
          {
            display_name: d.person_name,
            mobile: d.mobile,
            company: d.company,
            job_title: d.job_title,
            notes: d.notes,
            expertise: d.expertise
              .split(/[;,،]/)
              .map((t) => t.trim())
              .filter(Boolean),
            labels: d.tags
              .split(/[;,،]/)
              .map((t) => t.trim())
              .filter(Boolean),
            introduction_source: "unknown",
          },
          undefined,
          db,
        );
        personId = person.id;
        result.created++;
      } else result.linked++;
      map.set("@row:" + row.row_number, personId!);
      map.set("row:" + row.row_number, personId!);
      if (row.data.external_id) map.set(row.data.external_id, personId!);
    }
    // The complete two-pass import is a single transaction, including graph validation.
    for (const row of staged.rows) {
      if (
        row.decision.operation === "skip" ||
        !row.data.introduced_by_external_id
      )
        continue;
      const personId = map.get("@row:" + row.row_number)!,
        parent = row.data._parent_identity?.startsWith("row:")
          ? map.get(row.data._parent_identity)
          : row.data._parent_identity;
      if (!parent) fail("معرفی‌کننده نادیده گرفته شده است.");
      await checkIntroduction(db, user, personId, parent);
      await db.query(
        "UPDATE people SET introduction_source='person',introduced_by_person_id=$3,version=version+1 WHERE user_id=$1 AND id=$2",
        [user, personId, parent],
      );
      if (row.data.relationship_type) {
        await saveRelationship(
          user,
          {
            person_a_id: parent,
            person_b_id: personId,
            relationship_type_id: row.data._relationship_type_id,
          },
          undefined,
          db,
        );
      }
    }
    await db.query(
      "UPDATE import_jobs SET status='committed',locked_until=NULL,error_message=NULL,result=$3 WHERE user_id=$1 AND id=$2",
      [user, id, JSON.stringify(result)],
    );
    await audit(db, user, "commit", "import", id);
    return result;
  });
}
export function safeCSV(value: string) {
  return /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

export async function requestImportCommit(
  user: string,
  id: string,
  checksum: string,
) {
  return transaction(async (db) => {
    await lockOwner(db, user);
    const job = await owned(db, "import_jobs", user, id);
    if (job.status === "committed") return job.result;
    if (job.checksum !== checksum) fail("پیش‌نمایش تغییر کرده است.", 409);
    if (new Date(job.expires_at) < new Date() || job.purged_at)
      fail("پیش‌نمایش منقضی شده است.", 410);
    if (["queued", "processing"].includes(job.status))
      return { job_id: id, status: job.status };
    const staged: Staged = {
      ...JSON.parse(decrypt(job.staged_data)),
      external_references: job.external_references,
    };
    const checked = await validate(
      user,
      staged,
      job.mapping,
      Object.fromEntries(
        staged.rows.map((r) => [String(r.row_number), r.decision]),
      ),
      db,
    );
    if (checked.rows.some((r) => r.errors.length))
      fail("ابتدا خطاهای پیش‌نمایش را اصلاح کنید.");
    await db.query(
      "UPDATE import_jobs SET status='queued',error_message=NULL WHERE user_id=$1 AND id=$2",
      [user, id],
    );
    return { job_id: id, status: "queued" };
  });
}
export async function processPendingImport(userFilter?: string) {
  const claim = await transaction(async (db) => {
    const [candidate] = await query(
      "SELECT id,user_id FROM import_jobs WHERE (status='queued' OR (status='processing' AND locked_until<now())) AND ($1::uuid IS NULL OR user_id=$1) ORDER BY created_at LIMIT 1",
      [userFilter ?? null],
      db,
    );
    if (!candidate) return null;
    await lockOwner(db, candidate.user_id);
    const [job] = await query(
      "UPDATE import_jobs SET status='processing',locked_until=now()+interval '10 minutes' WHERE id=$1 AND (status='queued' OR (status='processing' AND locked_until<now())) RETURNING *",
      [candidate.id],
      db,
    );
    return job ?? null;
  });
  if (!claim) return false;
  try {
    await commitImport(claim.user_id, claim.id, claim.checksum);
  } catch (error) {
    await query(
      "UPDATE import_jobs SET status='failed',locked_until=NULL,error_message=$3 WHERE user_id=$1 AND id=$2",
      [
        claim.user_id,
        claim.id,
        error instanceof AppError
          ? error.message
          : "خطای پردازش؛ هیچ فردی از این ورود ثبت نشد.",
      ],
    );
  }
  return true;
}
