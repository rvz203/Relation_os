import { pool, query, transaction } from "../db/index";
import { passwordHash, normalize } from "../lib/server/core";
const email = process.env.OWNER_EMAIL?.trim().toLowerCase(),
  password = process.env.OWNER_PASSWORD,
  name = process.env.OWNER_NAME ?? "فضای شخصی من";
if (!email || !password || password.length < 12)
  throw new Error(
    "Set OWNER_EMAIL, OWNER_PASSWORD (12+ characters), and optionally OWNER_NAME.",
  );
await transaction(async (db) => {
  const [u] = await query(
    "INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id",
    [email, passwordHash(password), name],
    db,
  );
  await db.query(
    "INSERT INTO people(user_id,first_name,display_name,normalized_search,is_self,introduction_source) VALUES($1,$2,$2,$3,true,'unknown')",
    [u.id, name, normalize(name)],
  );
  for (const t of [
    { code: "friend", label: "دوست", reverse: "دوست", directed: false },
    { code: "colleague", label: "همکار", reverse: "همکار", directed: false },
    { code: "manager_of", label: "مدیر", reverse: "کارمند", directed: true },
    { code: "family", label: "خانواده", reverse: "خانواده", directed: false },
  ])
    await db.query(
      "INSERT INTO relationship_types(user_id,code,label,reverse_label,is_directed) VALUES($1,$2,$3,$4,$5)",
      [u.id, t.code, t.label, t.reverse, t.directed],
    );
});
console.log("Owner created. No password was logged.");
await pool.end();
