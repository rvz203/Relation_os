import Papa from "papaparse";
import ExcelJS from "exceljs";
import yauzl from "yauzl";
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
type Staged = { headers: string[]; raw: Raw[]; rows: Row[] };
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
    "SELECT id,display_name,normalized_search,mobile FROM people WHERE user_id=$1 AND is_active AND NOT is_self",
    [user],
    db,
  );
  const types = await query(
    "SELECT id,label,code FROM relationship_types WHERE user_id=$1 AND is_active",
    [user],
    db,
  );
  const rows: Row[] = staged.raw.map((raw, i) => {
    const data: Raw = {};
    for (const f of fields) {
      const column = mapping[f] ?? f;
      data[f] = String(raw[column] ?? "").trim();
    }
    const similar = people.filter(
      (p) =>
        normalize(p.display_name) === normalize(data.person_name) ||
        (data.mobile &&
          (() => {
            try {
              return mobile(data.mobile) === p.mobile;
            } catch {
              return false;
            }
          })()),
    );
    const decision = decisions[String(i + 2)] ??
      staged.rows?.[i]?.decision ?? { operation: "new" };
    return {
      row_number: i + 2,
      data,
      errors: [],
      similar: similar.map((p) => ({ id: p.id, display_name: p.display_name })),
      decision,
    };
  });
  const ids = new Map<string, Row[]>();
  for (const row of rows)
    if (row.data.external_id) {
      const list = ids.get(row.data.external_id) ?? [];
      list.push(row);
      ids.set(row.data.external_id, list);
    }
  for (const row of rows) {
    if (row.decision.operation === "skip") continue;
    if (!row.data.person_name) row.errors.push("نام الزامی است.");
    try {
      mobile(row.data.mobile);
    } catch {
      row.errors.push("شماره موبایل معتبر نیست.");
    }
    if (
      row.data.external_id &&
      (ids.get(row.data.external_id)?.length ?? 0) > 1
    )
      row.errors.push("external_id تکراری است.");
    if (
      row.decision.operation === "existing" &&
      !people.some((p) => p.id === row.decision.person_id)
    )
      row.errors.push("شخص موجود را انتخاب کنید.");
    // Similar names are never merged without an explicit row decision.
    if (
      row.similar.length &&
      row.decision.operation === "new" &&
      !row.decision.confirmed
    )
      row.errors.push(
        "نام یا شماره مشابه یافت شد؛ ساخت جدید، اتصال یا نادیده‌گرفتن را انتخاب کنید.",
      );
    const ref = row.data.introduced_by_external_id;
    if (ref) {
      const parents = ids.get(ref);
      if (
        !parents ||
        parents.length !== 1 ||
        parents[0].decision.operation === "skip"
      )
        row.errors.push("شناسه معرفی‌کننده موجود یا یکتا نیست.");
    } else if (row.data.parent || row.data.introduced_by) {
      const name = normalize(row.data.parent || row.data.introduced_by),
        matches = rows.filter(
          (r) =>
            normalize(r.data.person_name) === name &&
            r.decision.operation !== "skip",
        );
      if (matches.length !== 1)
        row.errors.push("نام معرفی‌کننده در فایل باید دقیق و یکتا باشد.");
      else if (!matches[0].data.external_id)
        row.data.introduced_by_external_id = "@row:" + matches[0].row_number;
      else row.data.introduced_by_external_id = matches[0].data.external_id;
    }
    if (
      row.data.relationship_type &&
      !types.some(
        (t) =>
          t.code === row.data.relationship_type ||
          t.label === row.data.relationship_type,
      )
    )
      row.errors.push("نوع رابطه تعریف نشده است.");
    if (row.data.relationship_type && !row.data.introduced_by_external_id)
      row.errors.push("رابطه به معرفی‌کننده نیاز دارد.");
  }
  const lookup = (ref: string) =>
    ref.startsWith("@row:")
      ? rows.find((r) => r.row_number === Number(ref.slice(5)))
      : ids.get(ref)?.[0];
  for (const row of rows) {
    const visited = new Set<number>();
    let current: Row | undefined = row;
    while (current && current.decision.operation !== "skip") {
      if (visited.has(current.row_number)) {
        row.errors.push("چرخه در زنجیره معرفی.");
        break;
      }
      visited.add(current.row_number);
      current = lookup(current.data.introduced_by_external_id);
    }
  }
  return { ...staged, rows };
}
export async function uploadImport(user: string, file: File) {
  const parsed = await parseFile(file);
  const [duplicate] = await query(
    "SELECT id,status FROM import_jobs WHERE user_id=$1 AND checksum=$2 ORDER BY created_at DESC LIMIT 1",
    [user, parsed.checksum],
  );
  if (duplicate)
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
  if (new Date(job.expires_at) < new Date())
    fail("پیش‌نمایش منقضی شده است.", 410);
  const staged: Staged = JSON.parse(decrypt(job.staged_data));
  return {
    id: job.id,
    filename: job.filename,
    status: job.status,
    checksum: job.checksum,
    result: job.result,
    mapping: job.mapping,
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
  },
) {
  input = z
    .object({
      mapping: z.record(z.string().max(200)).optional(),
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
    if (job.status !== "preview") fail("این ورود قبلاً ثبت شده است.", 409);
    const mapping = input.mapping ?? job.mapping;
    const staged = await validate(
      user,
      JSON.parse(decrypt(job.staged_data)),
      mapping,
      input.decisions,
      db,
    );
    await db.query(
      "UPDATE import_jobs SET mapping=$3,staged_data=$4 WHERE user_id=$1 AND id=$2",
      [user, id, JSON.stringify(mapping), encrypt(JSON.stringify(staged))],
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
    const original: Staged = JSON.parse(decrypt(job.staged_data));
    const decisions = Object.fromEntries(
      original.rows.map((r) => [String(r.row_number), r.decision]),
    );
    const staged = await validate(user, original, job.mapping, decisions, db);
    if (staged.rows.some((r) => r.errors.length))
      fail("ابتدا خطاهای پیش‌نمایش را اصلاح کنید.");
    const map = new Map<string, string>(),
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
            tags: [d.expertise, d.tags]
              .join(";")
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
        parent = map.get(row.data.introduced_by_external_id);
      if (!parent) fail("معرفی‌کننده نادیده گرفته شده است.");
      await checkIntroduction(db, user, personId, parent);
      await db.query(
        "UPDATE people SET introduction_source='person',introduced_by_person_id=$3,version=version+1 WHERE user_id=$1 AND id=$2",
        [user, personId, parent],
      );
      if (row.data.relationship_type) {
        const [type] = await query(
          "SELECT id FROM relationship_types WHERE user_id=$1 AND (code=$2 OR label=$2)",
          [user, row.data.relationship_type],
          db,
        );
        await saveRelationship(
          user,
          {
            person_a_id: parent,
            person_b_id: personId,
            relationship_type_id: type.id,
          },
          undefined,
          db,
        );
      }
    }
    await db.query(
      "UPDATE import_jobs SET status='committed',result=$3 WHERE user_id=$1 AND id=$2",
      [user, id, JSON.stringify(result)],
    );
    await audit(db, user, "commit", "import", id);
    return result;
  });
}
export function safeCSV(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}
