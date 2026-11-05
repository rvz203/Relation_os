import { z } from "zod";
import { pool, query, transaction, lockOwner, type DB } from "@/db";
import { audit, checkVersion, fail, owned, text, uuid, isoDay } from "./core";
export const relationshipSchema = z.object({
  person_a_id: uuid,
  person_b_id: uuid,
  relationship_type_id: uuid,
  notes: text.optional(),
  version: z.number().int().optional(),
  introduced_by_person_id: uuid.nullish(),
  start_date: isoDay.nullish(),
});
export async function saveRelationship(
  user: string,
  input: unknown,
  id?: string,
  externalDb?: DB,
) {
  const run = async (db: DB) => {
    await lockOwner(db, user);
    const current = id ? await owned(db, "relationships", user, id) : null;
    const d = relationshipSchema.parse({ ...current, ...(input as object) });
    if (current)
      checkVersion(
        current as { version: number },
        (input as { version?: number })?.version,
      );
    const type = await owned(
      db,
      "relationship_types",
      user,
      d.relationship_type_id,
      true,
    );
    await owned(db, "people", user, d.person_a_id, true);
    await owned(db, "people", user, d.person_b_id, true);
    if (d.introduced_by_person_id)
      await owned(db, "people", user, d.introduced_by_person_id, true);
    if (d.person_a_id === d.person_b_id) fail("رابطه با خود مجاز نیست.");
    let a = d.person_a_id,
      b = d.person_b_id;
    if (!type.is_directed && a > b) [a, b] = [b, a];
    const [r] = id
      ? await query(
          "UPDATE relationships SET person_a_id=$3,person_b_id=$4,relationship_type_id=$5,notes=$6,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",
          [user, id, a, b, d.relationship_type_id, d.notes ?? ""],
          db,
        )
      : await query(
          "INSERT INTO relationships(user_id,person_a_id,person_b_id,relationship_type_id,notes) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [user, a, b, d.relationship_type_id, d.notes ?? ""],
          db,
        );
    const [saved] = await query(
      "UPDATE relationships SET introduced_by_person_id=$3,start_date=$4 WHERE user_id=$1 AND id=$2 RETURNING *",
      [user, r.id, d.introduced_by_person_id ?? null, d.start_date ?? null],
      db,
    );
    await audit(db, user, id ? "update" : "create", "relationship", r.id);
    return saved;
  };
  return externalDb ? run(externalDb) : transaction(run);
}
export async function relationships(
  user: string,
  person?: string,
  db: DB = pool,
) {
  return query(
    `SELECT r.*,t.label,t.reverse_label,t.is_directed,a.display_name person_a_name,b.display_name person_b_name FROM relationships r JOIN relationship_types t ON t.id=r.relationship_type_id AND t.user_id=r.user_id JOIN people a ON a.id=r.person_a_id AND a.user_id=r.user_id JOIN people b ON b.id=r.person_b_id AND b.user_id=r.user_id WHERE r.user_id=$1 AND r.archived_at IS NULL AND a.is_active AND b.is_active AND ($2::uuid IS NULL OR r.person_a_id=$2 OR r.person_b_id=$2) ORDER BY r.created_at`,
    [user, person ?? null],
    db,
  );
}
export async function network(user: string, params: URLSearchParams) {
  const [self] = await query(
    "SELECT id FROM people WHERE user_id=$1 AND is_self",
    [user],
  );
  const root = params.get("center_person_id") ?? self?.id;
  if (!root) return { nodes: [], edges: [], truncated: false, has_more: false };
  await owned(pool, "people", user, root, true);
  const depth = Math.min(
      2,
      Math.max(1, Math.floor(Number(params.get("depth")) || 1)),
    ),
    limit = Math.min(
      200,
      Math.max(1, Math.floor(Number(params.get("limit")) || 200)),
    );
  const seen = new Set<string>([root]);
  let frontier = [root],
    truncated = false;
  const adjacentSQL = `SELECT CASE WHEN r.person_a_id=ANY($2::uuid[]) THEN r.person_b_id ELSE r.person_a_id END id FROM relationships r JOIN people a ON a.user_id=r.user_id AND a.id=r.person_a_id AND a.is_active JOIN people b ON b.user_id=r.user_id AND b.id=r.person_b_id AND b.is_active WHERE r.user_id=$1 AND r.archived_at IS NULL AND (r.person_a_id=ANY($2::uuid[]) OR r.person_b_id=ANY($2::uuid[]))
    UNION SELECT p.id FROM people p WHERE p.user_id=$1 AND p.is_active AND NOT p.is_self AND (p.introduced_by_person_id=ANY($2::uuid[]) OR (p.introduction_source='direct' AND $3::uuid=ANY($2::uuid[])))
    UNION SELECT coalesce(p.introduced_by_person_id,$3) FROM people p WHERE p.user_id=$1 AND p.is_active AND NOT p.is_self AND p.introduction_source<>'unknown' AND p.id=ANY($2::uuid[])`;
  for (let step = 0; step < depth && frontier.length; step++) {
    const candidates = await query(
      `SELECT DISTINCT p.id FROM (${adjacentSQL}) n JOIN people p ON p.id=n.id AND p.user_id=$1 AND p.is_active WHERE NOT(p.id=ANY($4::uuid[])) ORDER BY p.id LIMIT $5`,
      [user, frontier, self?.id ?? root, [...seen], limit - seen.size + 1],
    );
    const available = limit - seen.size;
    if (candidates.length > available) truncated = true;
    frontier = candidates.slice(0, available).map((n) => n.id);
    for (const id of frontier) seen.add(id);
    if (truncated) break;
  }
  const ids = [...seen];
  const nodes = await query(
    "SELECT id,display_name,company,job_title,importance_level,introduced_by_person_id,introduction_source,is_self,photo_key FROM people WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY (id=$3) DESC,id",
    [user, ids, root],
  );
  const edges = await query(
    `SELECT r.id,r.person_a_id source,r.person_b_id target,t.label,t.is_directed directed,'relationship' kind FROM relationships r JOIN relationship_types t ON t.user_id=r.user_id AND t.id=r.relationship_type_id WHERE r.user_id=$1 AND r.archived_at IS NULL AND r.person_a_id=ANY($2::uuid[]) AND r.person_b_id=ANY($2::uuid[])`,
    [user, ids],
  );
  for (const n of nodes) {
    const parent =
      n.introduction_source === "direct" ? self?.id : n.introduced_by_person_id;
    if (!n.is_self && parent && seen.has(parent))
      edges.push({
        id: "intro-" + n.id,
        source: parent,
        target: n.id,
        label: "معرفی",
        directed: true,
        kind: "introduction",
      });
  }
  const [more] = await query(
    `SELECT EXISTS(SELECT 1 FROM (${adjacentSQL}) n JOIN people p ON p.id=n.id AND p.user_id=$1 AND p.is_active WHERE NOT(p.id=ANY($2::uuid[]))) more`,
    [user, ids, self?.id ?? root],
  );
  return {
    nodes,
    edges,
    center_person_id: root,
    truncated,
    has_more: truncated || more.more,
  };
}
