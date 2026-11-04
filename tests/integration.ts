import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
import { pool, query, transaction } from "../db/index";
import { passwordHash, normalize } from "../lib/server/core";
import { generateReminders, processOneMessage } from "../lib/server/messaging";
const origin = process.env.APP_ORIGIN ?? "http://localhost:3001";
assert.equal(
  process.env.SMS_MODE,
  "sandbox",
  "Integration tests require sandbox SMS.",
);
assert.ok(
  new URL(origin).hostname === "localhost" ||
    new URL(origin).hostname === "127.0.0.1",
  "Integration tests must target a local app.",
);
const users: string[] = [];
let checks = 0;
const check = (description: string) => {
  checks++;
  console.log("PASS", description);
};
type Client = { cookie: string; csrf: string; id: string };
async function request(
  client: Client | null,
  route: string,
  method = "GET",
  body?: unknown,
  key = randomUUID(),
) {
  const headers: Record<string, string> = { Origin: origin };
  if (client) {
    headers.Cookie = client.cookie;
    headers["X-CSRF-Token"] = client.csrf;
  }
  if (method !== "GET") headers["Idempotency-Key"] = key;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const res = await fetch(origin + "/api/v1/" + route, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const result = await res.json();
  return { status: res.status, body: result, headers: res.headers };
}
async function client() {
  const email = "qa-" + randomUUID() + "@example.test";
  const password = "QA-only-password-2026!";
  const [u] = await query(
    "INSERT INTO users(email,password_hash,display_name,sms_enabled) VALUES($1,$2,$3,true) RETURNING id",
    [email, passwordHash(password), "QA synthetic owner"],
  );
  users.push(u.id);
  await query(
    "INSERT INTO people(user_id,first_name,display_name,normalized_search,is_self,introduction_source,mobile) VALUES($1,'QA','QA','qa',true,'unknown','+989000000000')",
    [u.id],
  );
  await query(
    "INSERT INTO relationship_types(user_id,code,label) VALUES($1,'friend','دوست')",
    [u.id],
  );
  const login = await request(null, "auth/login", "POST", { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const c = {
    cookie: login.headers.get("set-cookie")!.split(";")[0],
    csrf: "",
    id: u.id,
  };
  const me = await request(c, "auth/me");
  c.csrf = me.body.csrf_token;
  return c;
}
async function upload(c: Client, name: string, content: string | Uint8Array) {
  const f = new FormData();
  f.set("file", new File([content as any], name));
  return request(c, "imports/people", "POST", f);
}
try {
  assert.equal((await request(null, "people")).status, 401);
  check("unauthenticated API denies private records");
  const a = await client(),
    b = await client();
  const noCsrf = await fetch(origin + "/api/v1/people", {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: a.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ display_name: "QA" }),
  });
  assert.equal(noCsrf.status, 403);
  check("session mutations require CSRF protection");
  const idem = randomUUID(),
    payload = {
      display_name: "علي كريمي ۱۲۳",
      mobile: "۰۹۱۲۳۴۵۶۷۸۹",
      tags: ["طراحی"],
    };
  const first = await request(a, "people", "POST", payload, idem);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const p = first.body;
  const retry = await request(a, "people", "POST", payload, idem);
  assert.equal(retry.body.id, p.id);
  assert.equal(
    (
      await request(
        a,
        "people",
        "POST",
        { ...payload, display_name: "Different" },
        idem,
      )
    ).status,
    409,
  );
  check("idempotency replays the original create and rejects changed bodies");
  assert.equal((await request(b, "people/" + p.id)).status, 404);
  assert.equal(
    (
      await request(b, "people/" + p.id, "PATCH", {
        display_name: "hijack",
        version: p.version,
      })
    ).status,
    404,
  );
  check("other owners cannot read or change records by UUID");
  const search = await request(
    a,
    "people?q=" + encodeURIComponent("علی کریمی 123"),
  );
  assert.equal(search.body.items.length, 1);
  assert.equal(search.body.items[0].mobile, "+989123456789");
  check("Persian search and mobile normalization work through PostgreSQL");
  const second = await request(a, "people", "POST", {
    display_name: "QA second",
  });
  const p2 = second.body;
  const edit = await request(a, "people/" + p.id, "PATCH", {
    introduced_by_person_id: p2.id,
    introduction_source: "person",
    version: p.version,
  });
  assert.equal(edit.status, 200);
  assert.equal(
    (
      await request(a, "people/" + p2.id, "PATCH", {
        introduced_by_person_id: p.id,
        introduction_source: "person",
        version: p2.version,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(a, "people/" + p.id, "PATCH", {
        display_name: "stale",
        version: p.version,
      })
    ).status,
    409,
  );
  check("introduction cycles and stale edits are rejected");
  const type = (await request(a, "relationship-types")).body.items[0];
  const rel = {
    person_a_id: p.id,
    person_b_id: p2.id,
    relationship_type_id: type.id,
  };
  assert.equal((await request(a, "relationships", "POST", rel)).status, 201);
  assert.equal(
    (
      await request(a, "relationships", "POST", {
        ...rel,
        person_a_id: p2.id,
        person_b_id: p.id,
      })
    ).status,
    409,
  );
  check("symmetric edges reject reversed duplicates");
  const now = DateTime.now().setZone("Asia/Tehran"),
    today = now.toISODate()!;
  const date = await request(a, "important-dates", "POST", {
    person_id: p.id,
    title: "تولد QA",
    kind: "birthday",
    calendar: "gregorian",
    month: now.month,
    day: now.day,
  });
  assert.equal(date.status, 201);
  const cal = await request(a, `calendar?from=${today}&to=${today}`);
  assert.ok(cal.body.items.some((d: any) => d.id === date.body.id));
  check("an occasion on today remains in today’s calendar");
  const action = await request(a, "actions", "POST", {
    person_id: p.id,
    action_type: "call",
    title: "QA call",
    due_at: now.toUTC().toISO(),
  });
  assert.equal(action.status, 201);
  const done = await Promise.all([
    request(a, "actions/" + action.body.id + "/complete", "POST", {}),
    request(a, "actions/" + action.body.id + "/complete", "POST", {}),
  ]);
  assert.ok(done.every((r) => r.status === 200));
  const [count] = await query(
    "SELECT count(*)::int n FROM interactions WHERE user_id=$1 AND related_action_id=$2",
    [a.id, action.body.id],
  );
  assert.equal(count.n, 1);
  check("concurrent action completion creates exactly one interaction");
  const florist = await request(a, "florists", "POST", {
    name: "QA florist",
    mobile: "+989000000000",
  });
  assert.equal(florist.status, 201);
  const flower = {
    person_id: p.id,
    action_type: "flower",
    title: "QA flower",
    due_at: now.toUTC().toISO(),
    important_date_id: date.body.id,
    occurrence_date: today,
    flower: {
      florist_id: florist.body.id,
      budget_amount: 5000000,
      currency: "IRT",
      delivery_date: today,
      delivery_address: "Synthetic QA address",
      card_message: "QA",
    },
  };
  assert.equal(
    (
      await request(a, "actions", "POST", {
        ...flower,
        flower: { ...flower.flower, budget_amount: 0 },
      })
    ).status,
    422,
  );
  const order = await request(a, "actions", "POST", flower);
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.sms_state, "expired");
  const sms = await request(
    a,
    "actions/" + order.body.id + "/sms-preview",
    "POST",
    {},
  );
  assert.equal(sms.status, 200);
  assert.ok(sms.body.text.includes("تومان"));
  assert.ok(sms.body.text.includes(today));
  assert.equal(
    (
      await request(a, "actions/" + order.body.id + "/send-now", "POST", {
        preview_token: sms.body.preview_token + "x",
      })
    ).status,
    422,
  );
  const queued = await request(
    a,
    "actions/" + order.body.id + "/send-now",
    "POST",
    { preview_token: sms.body.preview_token },
  );
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const before = (await request(a, "people/" + p.id)).body.last_interaction_at;
  assert.equal(await processOneMessage(a.id), true);
  const after = await request(a, "actions/" + order.body.id);
  assert.equal(after.body.sms_state, "accepted");
  assert.equal(after.body.status, "pending");
  assert.equal(
    (await request(a, "people/" + p.id)).body.last_interaction_at,
    before,
  );
  check(
    "flower budget, units, preview, late-send rules and sandbox acceptance preserve direct-contact history",
  );
  await query(
    "UPDATE outbox_messages SET state='unknown' WHERE user_id=$1 AND id=$2",
    [a.id, queued.body.message_id],
  );
  assert.equal(
    (
      await request(a, "actions/" + order.body.id + "/send-now", "POST", {
        preview_token: sms.body.preview_token,
      })
    ).status,
    409,
  );
  assert.equal(await processOneMessage(a.id), false);
  check("unknown provider results cannot be blindly resent");
  const reminder = await request(a, "reminders", "POST", {
    person_id: p.id,
    message: "QA reminder",
    channel: "in_app",
    scheduled_at: now.minus({ minutes: 1 }).toUTC().toISO(),
  });
  assert.equal(reminder.status, 201);
  await generateReminders();
  await Promise.all([processOneMessage(a.id), processOneMessage(a.id)]);
  await generateReminders();
  await processOneMessage(a.id);
  const [notification] = await query(
    "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND outbox_message_id IN(SELECT id FROM outbox_messages WHERE user_id=$1 AND reminder_id=$2)",
    [a.id, reminder.body.id],
  );
  assert.equal(notification.n, 1);
  check("repeated schedulers and workers produce one reminder notification");
  const csv =
    "external_id,person_name,introduced_by_external_id,relationship_type\nchild,QA child,parent,friend\nparent,QA parent,,\n";
  const imported = await upload(a, "qa.csv", csv);
  assert.equal(imported.status, 202);
  const preview = await request(a, "imports/" + imported.body.job_id);
  assert.equal(preview.body.valid, true, JSON.stringify(preview.body.rows));
  const committed = await request(
    a,
    "imports/" + imported.body.job_id + "/commit",
    "POST",
    { checksum: preview.body.checksum },
  );
  assert.equal(committed.status, 202, JSON.stringify(committed.body));
  assert.equal(committed.body.created, 2);
  assert.equal(
    (
      await request(a, "imports/" + imported.body.job_id + "/commit", "POST", {
        checksum: preview.body.checksum,
      })
    ).body.created,
    2,
  );
  assert.equal(
    (await upload(a, "again.csv", csv)).body.job_id,
    imported.body.job_id,
  );
  check(
    "two-pass import supports parent after child and repeated commit/upload deduplicates",
  );
  const similar = await upload(a, "similar.csv", "person_name\nQA child\n");
  const sim = await request(a, "imports/" + similar.body.job_id);
  assert.equal(sim.body.valid, false);
  const decision = await request(
    a,
    "imports/" + similar.body.job_id + "/mapping",
    "PATCH",
    { decisions: { "2": { operation: "new", confirmed: true } } },
  );
  assert.equal(decision.body.valid, true);
  check("similar people require an explicit import decision");
  const cyclic = await upload(
    a,
    "cycle.csv",
    "external_id,person_name,introduced_by_external_id\n1,QA cycle one,2\n2,QA cycle two,1\n",
  );
  const bad = await request(a, "imports/" + cyclic.body.job_id);
  assert.equal(bad.body.valid, false);
  const [beforeImport] = await query(
    "SELECT count(*)::int n FROM people WHERE user_id=$1",
    [a.id],
  );
  assert.equal(
    (
      await request(a, "imports/" + cyclic.body.job_id + "/commit", "POST", {
        checksum: bad.body.checksum,
      })
    ).status,
    422,
  );
  const [afterImport] = await query(
    "SELECT count(*)::int n FROM people WHERE user_id=$1",
    [a.id],
  );
  assert.equal(beforeImport.n, afterImport.n);
  check("invalid imports leave the network unchanged");
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("People");
  sheet.addRow(["person_name"]);
  sheet.addRow(["QA workbook"]);
  const xlsx = await upload(
    a,
    "valid.xlsx",
    new Uint8Array(await workbook.xlsx.writeBuffer()),
  );
  assert.equal(xlsx.status, 202, JSON.stringify(xlsx.body));
  assert.equal(
    (await request(a, "imports/" + xlsx.body.job_id)).body.valid,
    true,
  );
  sheet.getCell("A2").value = { formula: "1+1", result: 2 };
  const formula = await upload(
    a,
    "formula.xlsx",
    new Uint8Array(await workbook.xlsx.writeBuffer()),
  );
  assert.equal(formula.status, 422, JSON.stringify(formula.body));
  check("XLSX preview accepts plain cells and rejects formulas");
  const future = await request(a, "reminders", "POST", {
    person_id: p2.id,
    message: "QA future",
    channel: "in_app",
    scheduled_at: now.plus({ days: 1 }).toUTC().toISO(),
  });
  await generateReminders();
  assert.equal(
    (await request(a, "people/" + p2.id + "/archive", "POST", {})).status,
    200,
  );
  const [stopped] = await query(
    "SELECT is_enabled FROM reminders WHERE user_id=$1 AND id=$2",
    [a.id, future.body.id],
  );
  assert.equal(stopped.is_enabled, false);
  const [outbox] = await query(
    "SELECT state FROM outbox_messages WHERE user_id=$1 AND reminder_id=$2",
    [a.id, future.body.id],
  );
  assert.equal(outbox.state, "cancelled");
  check("archiving a person stops future reminders and queued work");
  await request(a, "auth/logout", "POST", {});
  assert.equal((await request(a, "auth/me")).status, 401);
  check("logout invalidates the server-side session");
  console.log(`${checks} integration checks passed.`);
} finally {
  for (const id of users)
    await transaction(async (db) => {
      for (const table of [
        "idempotency_requests",
        "sms_logs",
        "notifications",
        "interactions",
        "outbox_messages",
        "reminders",
        "flower_details",
        "actions",
        "important_dates",
        "relationships",
        "person_tags",
        "tags",
        "relationship_types",
        "florists",
        "import_jobs",
        "audit_logs",
        "sessions",
      ])
        await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
      await db.query(
        "UPDATE people SET introduced_by_person_id=NULL,introduction_source='unknown' WHERE user_id=$1",
        [id],
      );
      await db.query("DELETE FROM people WHERE user_id=$1", [id]);
      await db.query("DELETE FROM users WHERE id=$1", [id]);
    });
  await pool.end();
}
