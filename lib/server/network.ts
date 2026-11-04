import { z } from "zod";
import { pool, query, transaction, lockOwner, type DB } from "@/db";
import { audit, checkVersion, fail, owned, text, uuid } from "./core";
export const relationshipSchema = z.object({
  person_a_id: uuid,
  person_b_id: uuid,
  relationship_type_id: uuid,
  notes: text.optional(),
  version: z.number().int().optional(),
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
    if (current) checkVersion(current as { version: number }, d.version);
    const type = await owned(
      db,
      "relationship_types",
      user,
      d.relationship_type_id,
      true,
    );
    await owned(db, "people", user, d.person_a_id, true);
    await owned(db, "people", user, d.person_b_id, true);
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
    await audit(db, user, id ? "update" : "create", "relationship", r.id);
    return r;
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
  const center = params.get("center_person_id");
  const [self] = await query(
    "SELECT id FROM people WHERE user_id=$1 AND is_self",
    [user],
  );
  const root = center ?? self?.id;
  if (!root) return { nodes: [], edges: [], truncated: false, has_more: false };
  await owned(pool, "people", user, root, true);
  const depth = Math.min(2, Math.max(1, Number(params.get("depth")) || 1)),
    limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 200));
  const rows = await query(
    `WITH RECURSIVE edges AS (
    SELECT person_a_id a,person_b_id b FROM relationships WHERE user_id=$1 AND archived_at IS NULL
    UNION SELECT p.id,coalesce(p.introduced_by_person_id,$2) FROM people p WHERE p.user_id=$1 AND NOT p.is_self AND p.is_active AND p.introduction_source<>'unknown'
  ), walk AS (SELECT $3::uuid id,0 depth UNION SELECT CASE WHEN e.a=w.id THEN e.b ELSE e.a END,w.depth+1 FROM walk w JOIN edges e ON e.a=w.id OR e.b=w.id WHERE w.depth<$4)
  SELECT DISTINCT p.id,p.display_name,p.company,p.job_title,p.importance_level,p.introduced_by_person_id,p.introduction_source,p.is_self,p.photo_key FROM people p JOIN walk w ON w.id=p.id WHERE p.user_id=$1 AND p.is_active ORDER BY p.id LIMIT $5`,
    [user, self?.id ?? root, root, depth, limit + 1],
  );
  const nodes = rows.slice(0, limit),
    ids = new Set(nodes.map((n) => n.id));
  const edges = (await relationships(user))
    .filter((r) => ids.has(r.person_a_id) && ids.has(r.person_b_id))
    .map((r) => ({
      id: r.id,
      source: r.person_a_id,
      target: r.person_b_id,
      label: r.label,
      directed: r.is_directed,
      kind: "relationship",
    }));
  for (const n of nodes) {
    const parent =
      n.introduction_source === "direct" ? self?.id : n.introduced_by_person_id;
    if (!n.is_self && parent && ids.has(parent))
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
    "SELECT count(*)::int total FROM people WHERE user_id=$1 AND is_active",
    [user],
  );
  return {
    nodes,
    edges,
    center_person_id: root,
    truncated: rows.length > limit,
    has_more: more.total > nodes.length,
  };
}
