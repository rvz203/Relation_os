import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { pool, query, transaction } from "../db/index";
import { passwordHash } from "../lib/server/core";
const origin = process.env.APP_ORIGIN ?? "http://localhost:3011";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Benchmark is local synthetic data only",
);
const email = "benchmark-" + randomUUID() + "@example.test",
  password = "Synthetic-benchmark-2026!";
let user: string | undefined;
try {
  const [u] = await query(
    "INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id",
    [email, passwordHash(password), "Synthetic benchmark"],
  );
  user = u.id;
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO people(user_id,first_name,display_name,normalized_search,is_self,introduction_source) VALUES($1,'Benchmark','Benchmark root','benchmark root',true,'unknown')",
      [user],
    );
    await db.query(
      "INSERT INTO people(user_id,first_name,display_name,normalized_search,company,job_title,introduction_source,importance_level) SELECT $1,'آزمایش', 'آزمایش '||n, 'آزمایش '||n||' شرکت نمونه مهندس','شرکت نمونه','مهندس','direct',CASE WHEN n%3=0 THEN 'A' WHEN n%3=1 THEN 'B' ELSE 'C' END FROM generate_series(1,10000) n",
      [user],
    );
    const [type] = await query(
      "INSERT INTO relationship_types(user_id,code,label) VALUES($1,'colleague','همکار') RETURNING id",
      [user],
      db,
    );
    await db.query(
      `WITH numbered AS(SELECT id,row_number() OVER(ORDER BY id)::int n FROM people WHERE user_id=$1 AND NOT is_self) INSERT INTO relationships(user_id,person_a_id,person_b_id,relationship_type_id) SELECT $1,least(a.id,b.id),greatest(a.id,b.id),$2 FROM numbered a CROSS JOIN generate_series(1,5) offset_n JOIN numbered b ON b.n=((a.n+offset_n-1)%10000)+1`,
      [user, type.id],
    );
  });
  await query("ANALYZE people");
  await query("ANALYZE relationships");
  const cookies = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const r = await fetch(origin + "/api/v1/auth/login", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    }),
  );
  const routes = [
    "people?limit=30",
    "people?limit=30&q=" + encodeURIComponent("آزمایش 50"),
    "people?limit=30&q=" + encodeURIComponent("شرکت"),
    "network?depth=2&limit=200",
  ];
  const results = [];
  for (const route of routes) {
    await fetch(origin + "/api/v1/" + route, {
      headers: { Cookie: cookies[0] },
    });
    const samples: number[] = [];
    await Promise.all(
      cookies.map(async (cookie) => {
        for (let n = 0; n < 15; n++) {
          const start = performance.now();
          const r = await fetch(origin + "/api/v1/" + route, {
            headers: { Cookie: cookie },
          });
          const body = await r.json();
          assert.equal(r.status, 200, JSON.stringify(body));
          if (route.startsWith("network")) assert.ok(body.nodes.length <= 200);
          samples.push(performance.now() - start);
        }
      }),
    );
    samples.sort((a, b) => a - b);
    results.push({
      route,
      requests: samples.length,
      p50_ms: Math.round(samples[Math.ceil(samples.length * 0.5) - 1]),
      p95_ms: Math.round(samples[Math.ceil(samples.length * 0.95) - 1]),
      max_ms: Math.round(samples.at(-1)!),
    });
  }
  const report = {
    at: new Date().toISOString(),
    environment:
      "local macOS; Next.js production server; PostgreSQL; synthetic disposable owner",
    people: 10000,
    relationships: 50000,
    concurrent_sessions: 10,
    results,
    passes_list_search_target: results.slice(0, 3).every((r) => r.p95_ms < 800),
    scope:
      "Local measurement only; repeat on production-equivalent infrastructure.",
  };
  await mkdir("outputs", { recursive: true });
  await writeFile(
    "outputs/benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  assert.ok(
    report.passes_list_search_target,
    "List/search p95 must be below 800ms",
  );
} finally {
  if (user)
    await transaction(async (db) => {
      for (const table of [
        "relationships",
        "relationship_types",
        "audit_logs",
        "sessions",
      ])
        await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [user]);
      await db.query("DELETE FROM people WHERE user_id=$1", [user]);
      await db.query("DELETE FROM users WHERE id=$1", [user]);
    });
  await pool.end();
}
