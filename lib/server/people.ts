import { query, transaction, lockOwner, pool, type DB } from "@/db";
import {
  audit,
  checkVersion,
  decrypt,
  encrypt,
  fail,
  mobile,
  normalize,
  owned,
  personSchema,
} from "./core";

export function publicPerson(p: Record<string, any>): Record<string, any> {
  return {
    ...p,
    address: decrypt(p.address),
    notes: decrypt(p.notes),
    private_notes: decrypt(p.private_notes),
    acquaintance_notes: decrypt(p.acquaintance_notes),
    tags: p.tags ?? [],
  };
}
export async function listPeople(
  user: string,
  params: URLSearchParams,
  db: DB = pool,
) {
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.get("limit")) || 30)),
  );
  const q = normalize(params.get("q") ?? ""),
    importance = params.get("importance"),
    cursor = params.get("cursor"),
    tag = params.get("tag");
  const tagId = params.get("tag_id");
  if (tagId) (await import("./core")).uuid.parse(tagId);
  const rows = await query(
    `SELECT p.*,coalesce((SELECT jsonb_agg(t.name ORDER BY t.name) FROM person_tags pt JOIN tags t ON t.id=pt.tag_id AND t.user_id=pt.user_id WHERE pt.person_id=p.id AND pt.user_id=p.user_id),'[]') tags,
    (SELECT max(i.occurred_at) FROM interactions i WHERE i.user_id=p.user_id AND i.person_id=p.id AND counts_as_contact) last_interaction_at,
    (SELECT min(a.due_at) FROM actions a WHERE a.user_id=p.user_id AND a.person_id=p.id AND a.status='pending') next_action_at,
    intro.display_name introduced_by_name FROM people p LEFT JOIN people intro ON intro.id=p.introduced_by_person_id AND intro.user_id=p.user_id
    WHERE p.user_id=$1 AND p.is_active=$2 AND NOT p.is_self AND ($3='' OR p.normalized_search LIKE '%'||$3||'%' ESCAPE '!' OR EXISTS(SELECT 1 FROM person_tags pt JOIN tags t ON t.id=pt.tag_id AND t.user_id=pt.user_id WHERE pt.person_id=p.id AND pt.user_id=p.user_id AND t.normalized_name LIKE '%'||$3||'%' ESCAPE '!'))
    AND ($4::text IS NULL OR p.importance_level=$4) AND ($5::uuid IS NULL OR p.id>$5)
    AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM person_tags pt JOIN tags t ON t.id=pt.tag_id AND t.user_id=pt.user_id WHERE pt.person_id=p.id AND pt.user_id=p.user_id AND t.name=$6)) AND ($8::uuid IS NULL OR EXISTS(SELECT 1 FROM person_tags pt WHERE pt.user_id=p.user_id AND pt.person_id=p.id AND pt.tag_id=$8)) ORDER BY p.id LIMIT $7`,
    [
      user,
      params.get("active") !== "false",
      q.replace(/[!%_]/g, (c) => "!" + c),
      importance && importance !== "all" ? importance : null,
      cursor,
      tag,
      limit + 1,
      tagId,
    ],
    db,
  );
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map(publicPerson),
    next_cursor: hasMore ? rows[limit - 1].id : null,
  };
}
export async function personDetail(user: string, id: string, db: DB = pool) {
  const p = await owned(db, "people", user, id);
  p.tag_objects = await query(
    "SELECT t.id,t.name,t.kind FROM tags t JOIN person_tags pt ON pt.tag_id=t.id AND pt.user_id=t.user_id WHERE pt.user_id=$1 AND pt.person_id=$2",
    [user, id],
    db,
  );
  p.tags = p.tag_objects.map((t: any) => t.name);
  p.expertise = p.tag_objects
    .filter((t: any) => t.kind === "expertise")
    .map((t: any) => t.name);
  p.labels = p.tag_objects
    .filter((t: any) => t.kind === "label")
    .map((t: any) => t.name);
  const [interaction] = await query(
    "SELECT max(occurred_at) last_interaction_at FROM interactions WHERE user_id=$1 AND person_id=$2 AND counts_as_contact",
    [user, id],
    db,
  );
  const [next] = await query(
    "SELECT id,title,due_at,action_type FROM actions WHERE user_id=$1 AND person_id=$2 AND status='pending' ORDER BY due_at,id LIMIT 1",
    [user, id],
    db,
  );
  return publicPerson({ ...p, ...interaction, next_action: next ?? null });
}
export async function setTags(
  db: DB,
  user: string,
  id: string,
  tags: (string | { name: string; kind: string })[],
) {
  await db.query("DELETE FROM person_tags WHERE user_id=$1 AND person_id=$2", [
    user,
    id,
  ]);
  const seen = new Set<string>();
  for (const input of tags) {
    const name = (typeof input === "string" ? input : input.name).trim(),
      kind = typeof input === "string" ? "expertise" : input.kind;
    const key = kind + ":" + normalize(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const [tag] = await query(
      `INSERT INTO tags(user_id,name,normalized_name,kind) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,normalized_name,kind) DO UPDATE SET is_active=true RETURNING id`,
      [user, name, normalize(name), kind],
      db,
    );
    await db.query(
      "INSERT INTO person_tags(user_id,person_id,tag_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [user, id, tag.id],
    );
  }
}
export async function checkIntroduction(
  db: DB,
  user: string,
  id: string | undefined,
  parent?: string | null,
) {
  if (!parent) return;
  await owned(db, "people", user, parent, true);
  if (id === parent) fail("شخص نمی‌تواند معرفی‌کننده خودش باشد.");
  const seen = new Set<string>(id ? [id] : []);
  let current: string | null = parent;
  while (current) {
    if (seen.has(current))
      fail("این معرفی‌کننده در زنجیره آشنایی چرخه ایجاد می‌کند.");
    seen.add(current);
    const [p]: Record<string, any>[] = await query(
      "SELECT introduced_by_person_id FROM people WHERE user_id=$1 AND id=$2",
      [user, current],
      db,
    );
    current = p?.introduced_by_person_id ?? null;
  }
}
export async function savePerson(
  user: string,
  input: unknown,
  id?: string,
  externalDb?: DB,
) {
  const run = async (db: DB): Promise<Record<string, any>> => {
    await lockOwner(db, user);
    const current = id ? await personDetail(user, id, db) : undefined;
    const d = personSchema.parse(
      current ? { ...current, ...(input as object) } : input,
    );
    if (current) {
      checkVersion(
        current as { version: number },
        (input as { version?: number })?.version,
      );
      if (current.is_self) fail("پروفایل مرکزی از این فرم ویرایش نمی‌شود.");
    }
    const parent =
      d.introduction_source === "person" ? d.introduced_by_person_id : null;
    if (d.introduction_source === "person" && !parent)
      fail("معرفی‌کننده را انتخاب کنید.");
    await checkIntroduction(db, user, id, parent);
    const displayName =
      d.display_name || [d.first_name, d.last_name].filter(Boolean).join(" ");
    if (!displayName) fail("نام الزامی است.");
    const firstName = d.first_name || displayName.split(" ")[0];
    if (firstName.length > 100) fail("نام کوچک حداکثر ۱۰۰ نویسه است.");
    const phone = mobile(d.mobile);
    const values = [
      firstName,
      d.last_name || "",
      displayName,
      normalize(
        [
          displayName,
          phone,
          d.email,
          d.company,
          d.job_title,
          d.city,
          d.industry,
          d.activity_area,
        ].join(" "),
      ),
      phone,
      d.email || null,
      d.company || "",
      d.job_title || "",
      d.city || "",
      encrypt(d.address),
      encrypt(d.notes),
      encrypt(d.private_notes),
      d.importance_level,
      d.introduction_source,
      parent,
    ];
    let person;
    if (id)
      [person] = await query(
        `UPDATE people SET first_name=$3,last_name=$4,display_name=$5,normalized_search=$6,mobile=$7,email=$8,company=$9,job_title=$10,city=$11,address=$12,notes=$13,private_notes=$14,importance_level=$15,introduction_source=$16,introduced_by_person_id=$17,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`,
        [user, id, ...values],
        db,
      );
    else
      [person] = await query(
        `INSERT INTO people(user_id,first_name,last_name,display_name,normalized_search,mobile,email,company,job_title,city,address,notes,private_notes,importance_level,introduction_source,introduced_by_person_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [user, ...values],
        db,
      );
    await db.query(
      "UPDATE people SET gender=$3,country_code=$4,industry=$5,activity_area=$6,first_met_on=$7,acquaintance_notes=$8 WHERE user_id=$1 AND id=$2",
      [
        user,
        person.id,
        d.gender ?? "",
        d.country_code || null,
        d.industry ?? "",
        d.activity_area ?? "",
        d.first_met_on ?? null,
        encrypt(d.acquaintance_notes),
      ],
    );
    const supplied = input as Record<string, unknown>;
    let tagValues: (string | { name: string; kind: string })[] = d.tags;
    if ("expertise" in supplied || "labels" in supplied)
      tagValues = [
        ...(d.expertise ?? current?.expertise ?? []).map((name: string) => ({
          name,
          kind: "expertise",
        })),
        ...(d.labels ?? current?.labels ?? []).map((name: string) => ({
          name,
          kind: "label",
        })),
      ];
    else
      tagValues = d.tags.map((name) => ({
        name,
        kind:
          current?.tag_objects?.find(
            (t: any) => normalize(t.name) === normalize(name),
          )?.kind ?? "expertise",
      }));
    await setTags(db, user, person.id, tagValues);
    await audit(
      db,
      user,
      id ? "update" : "create",
      "person",
      person.id,
      Object.keys(d),
    );
    const result = await personDetail(user, person.id, db);
    const [similar] = await query(
      "SELECT count(*)::int n FROM people WHERE user_id=$1 AND id<>$2 AND is_active AND mobile=$3",
      [user, person.id, phone],
      db,
    );
    return {
      ...result,
      warnings: similar.n
        ? ["شماره موبایل با فرد دیگری مشترک است؛ هیچ ادغامی انجام نشد."]
        : [],
    };
  };
  return externalDb ? run(externalDb) : transaction(run);
}
export async function archivePerson(user: string, id: string) {
  return transaction(async (db) => {
    await lockOwner(db, user);
    const p = await owned(db, "people", user, id);
    if (p.is_self) fail("شخص مرکزی بایگانی نمی‌شود.");
    await db.query(
      "UPDATE people SET is_active=false,archived_at=now(),version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2",
      [user, id],
    );
    await db.query(
      `UPDATE actions SET status='cancelled',version=version+1 WHERE user_id=$1 AND person_id=$2 AND status='pending'`,
      [user, id],
    );
    await db.query(
      `UPDATE reminders SET is_enabled=false,version=version+1 WHERE user_id=$1 AND (person_id=$2 OR action_id IN(SELECT id FROM actions WHERE user_id=$1 AND person_id=$2) OR important_date_id IN(SELECT id FROM important_dates WHERE user_id=$1 AND person_id=$2) OR recipient_person_id=$2)`,
      [user, id],
    );
    await db.query(
      `UPDATE outbox_messages SET state='cancelled',updated_at=now() WHERE user_id=$1 AND state IN('queued','retry_wait') AND (action_id IN(SELECT id FROM actions WHERE user_id=$1 AND person_id=$2) OR reminder_id IN(SELECT id FROM reminders WHERE user_id=$1 AND NOT is_enabled))`,
      [user, id],
    );
    await audit(db, user, "archive", "person", id);
    return { ok: true };
  });
}
export async function introductionPath(user: string, id: string) {
  const path: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  let current: string | null = id;
  let incomplete = false;
  while (current) {
    if (visited.has(current)) {
      incomplete = true;
      break;
    }
    visited.add(current);
    const [p]: Record<string, any>[] = await query(
      "SELECT id,display_name,introduction_source,introduced_by_person_id,is_self,is_active FROM people WHERE user_id=$1 AND id=$2",
      [user, current],
    );
    if (!p) {
      incomplete = true;
      break;
    }
    path.unshift(p);
    if (p.introduction_source === "direct" && !p.is_self) {
      const [self] = await query(
        "SELECT id,display_name,is_self FROM people WHERE user_id=$1 AND is_self",
        [user],
      );
      if (self) path.unshift(self);
      break;
    }
    if (p.introduction_source === "unknown") incomplete = true;
    current = p.introduced_by_person_id;
  }
  return { items: path, incomplete };
}
