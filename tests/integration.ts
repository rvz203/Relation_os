import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { DateTime } from "luxon";
import sharp from "sharp";
import { rm } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { pool, query, transaction } from "../db/index";
import { passwordHash, normalize, decrypt } from "../lib/server/core";
import { processPendingImport } from "../lib/server/imports";
import { generateReminders, processOneMessage } from "../lib/server/messaging";
import { receiveSMSWebhook } from "../lib/server/webhook";
import { applyDeliveryResult } from "../lib/server/delivery";
import { monitorOnce } from "../lib/server/monitoring";
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
  assert.equal(committed.body.status, "queued");
  assert.equal(await processPendingImport(a.id), true);
  assert.equal(
    (await request(a, "imports/" + imported.body.job_id)).body.result.created,
    2,
  );
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
  const full = await request(a, "people", "POST", {
    first_name: "QA",
    last_name: "Complete",
    gender: "female",
    country_code: "IR",
    industry: "Software",
    activity_area: "Engineering",
    first_met_on: "2020-01-01",
    acquaintance_notes: "Private origin",
    expertise: ["هوش مصنوعي"],
    labels: ["آشنا"],
    mobile: payload.mobile,
  });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.equal(full.body.display_name, "QA Complete");
  assert.equal(full.body.acquaintance_notes, "Private origin");
  assert.equal(full.body.labels[0], "آشنا");
  assert.ok(full.body.warnings.length);
  assert.equal(
    (
      await request(a, "people/" + full.body.id, "PATCH", {
        company: "Changed",
      })
    ).body.error.code,
    "VERSION_REQUIRED",
  );
  const fullEdit = await request(a, "people/" + full.body.id, "PATCH", {
    company: "Changed",
    version: full.body.version,
  });
  assert.equal(fullEdit.status, 200, JSON.stringify(fullEdit.body));
  const literal = await request(a, "people?q=" + encodeURIComponent("%"));
  assert.equal(literal.status, 200);
  assert.equal(literal.body.items.length, 0);
  const tag = (await request(a, "tags")).body.items.find(
    (t: any) => t.name === "آشنا",
  );
  assert.ok(
    (await request(a, "people?tag_id=" + tag.id)).body.items.some(
      (i: any) => i.id === full.body.id,
    ),
  );
  check(
    "complete profile fields, separate label/expertise, duplicate warning, literal search and required versions",
  );
  const bounded = await request(a, "network?limit=1&depth=2");
  assert.equal(bounded.status, 200, JSON.stringify(bounded.body));
  assert.equal(bounded.body.nodes.length, 1);
  assert.equal(bounded.body.nodes[0].is_self, true);
  assert.equal(bounded.body.truncated, true);
  assert.equal(bounded.body.has_more, true);
  const graph = await request(a, "network?limit=200&depth=2");
  assert.equal(graph.status, 200, JSON.stringify(graph.body));
  assert.ok(graph.body.nodes.length <= 200);
  check("network keeps its root and reports omitted neighbors truthfully");
  const planned = await request(a, "actions", "POST", {
    person_id: full.body.id,
    action_type: "call",
    due_at: now.plus({ days: 3 }).toUTC().toISO(),
    reminder_at: now.plus({ days: 2 }).toUTC().toISO(),
    important_date_id: null,
  });
  assert.equal(planned.status, 201, JSON.stringify(planned.body));
  assert.ok(planned.body.title.includes("QA Complete"));
  const [linkedReminder] = await query(
    "SELECT * FROM reminders WHERE user_id=$1 AND action_id=$2",
    [a.id, planned.body.id],
  );
  assert.ok(linkedReminder);
  assert.equal(
    (
      await request(a, "actions/" + planned.body.id, "PATCH", {
        notes: "Missing version",
      })
    ).body.error.code,
    "VERSION_REQUIRED",
  );
  const reminderEdit = await request(
    a,
    "reminders/" + linkedReminder.id,
    "PATCH",
    { message: "Edited reminder", version: linkedReminder.version },
  );
  assert.equal(reminderEdit.status, 200, JSON.stringify(reminderEdit.body));
  assert.equal(
    (
      await request(a, "reminders", "POST", {
        person_id: full.body.id,
        recipient_person_id: full.body.id,
        channel: "in_app",
        message: "Invalid recipient",
        scheduled_at: now.toUTC().toISO(),
      })
    ).status,
    422,
  );
  check(
    "action reminder creates a separate editable schedule and in-app recipients are owner-only",
  );
  const missed = await request(a, "reminders", "POST", {
    person_id: full.body.id,
    message: "Old reminder",
    scheduled_at: now.minus({ hours: 25 }).toUTC().toISO(),
  });
  assert.equal(missed.status, 201);
  await generateReminders(a.id);
  assert.equal(await processOneMessage(a.id), true);
  const [missedMessage] = await query(
    "SELECT state FROM outbox_messages WHERE user_id=$1 AND reminder_id=$2",
    [a.id, missed.body.id],
  );
  assert.equal(missedMessage.state, "expired");
  const direct = await request(a, "reminders", "POST", {
    person_id: full.body.id,
    recipient_person_id: full.body.id,
    channel: "sms",
    message: "Recovery QA",
    scheduled_at: now.minus({ minutes: 1 }).toUTC().toISO(),
  });
  assert.equal(direct.status, 201);
  await generateReminders(a.id);
  await processOneMessage(a.id, async () => {
    throw new Error("Simulated lost response");
  });
  const [uncertain] = await query(
    "SELECT * FROM outbox_messages WHERE user_id=$1 AND reminder_id=$2",
    [a.id, direct.body.id],
  );
  assert.equal(uncertain.state, "unknown");
  assert.equal(await processOneMessage(a.id), false);
  const [attempt] = await query(
    "SELECT * FROM sms_logs WHERE user_id=$1 AND outbox_message_id=$2",
    [a.id, uncertain.id],
  );
  assert.equal(decrypt(attempt.message_snapshot), "Recovery QA");
  assert.equal(attempt.send_status, "unknown");
  await query(
    "UPDATE outbox_messages SET state='processing',locked_until=now()-interval '1 minute' WHERE id=$1",
    [uncertain.id],
  );
  assert.equal(await processOneMessage(a.id), false);
  const [crashed] = await query(
    "SELECT send_status,error_code FROM sms_logs WHERE user_id=$1 AND outbox_message_id=$2",
    [a.id, uncertain.id],
  );
  assert.equal(crashed.error_code, "LEASE_EXPIRED");
  assert.equal(crashed.send_status, "unknown");
  process.env.SMS_WEBHOOK_SECRET = "synthetic-webhook-secret";
  const raw = JSON.stringify({
      client_reference: uncertain.id,
      provider_message_id: "synthetic-receipt",
      status: "delivered",
    }),
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature = createHmac("sha256", process.env.SMS_WEBHOOK_SECRET)
      .update(timestamp + "." + raw)
      .digest("hex");
  await receiveSMSWebhook(raw, timestamp, signature);
  await receiveSMSWebhook(raw, timestamp, signature);
  const [receipt] = await query(
    "SELECT state FROM outbox_messages WHERE id=$1",
    [uncertain.id],
  );
  assert.equal(receipt.state, "delivered");
  const [directHistory] = await query(
    "SELECT count(*)::int n,bool_and(counts_as_contact) counted FROM interactions WHERE user_id=$1 AND related_message_id=$2",
    [a.id, uncertain.id],
  );
  assert.equal(directHistory.n, 1);
  assert.equal(directHistory.counted, true);
  await assert.rejects(() => receiveSMSWebhook(raw, timestamp, "x".repeat(64)));
  await transaction((db) =>
    applyDeliveryResult(db, a.id, queued.body.message_id, {
      state: "accepted",
    }),
  );
  await transaction((db) =>
    applyDeliveryResult(db, a.id, queued.body.message_id, { state: "failed" }),
  );
  const freshPreview = await request(
    a,
    "actions/" + order.body.id + "/sms-preview",
    "POST",
    {},
  );
  assert.equal(
    (
      await request(a, "actions/" + order.body.id + "/send-now", "POST", {
        preview_token: freshPreview.body.preview_token,
      })
    ).status,
    409,
  );
  check(
    "missed grace periods, lost responses, expired leases, immutable attempt snapshots and signed deduplicated receipts",
  );
  const refFile = await upload(
    a,
    "reference.csv",
    "external_id,person_name,introduced_by_external_id\nnew,QA external child,outside\n",
  );
  const refJob = (await request(a, "imports/" + refFile.body.job_id)).body;
  assert.equal(refJob.valid, false);
  const mapped = await request(
    a,
    "imports/" + refJob.id + "/mapping",
    "PATCH",
    { external_references: { outside: full.body.id } },
  );
  assert.equal(mapped.body.valid, true, JSON.stringify(mapped.body.rows));
  await request(a, "imports/" + refJob.id + "/commit", "POST", {
    checksum: refJob.checksum,
  });
  assert.equal(
    (await request(a, "imports/" + refJob.id + "/mapping", "PATCH", {})).status,
    409,
  );
  await processPendingImport(a.id);
  const refResult = (await request(a, "imports/" + refJob.id)).body;
  assert.equal(refResult.status, "committed");
  const legacy = await upload(
    a,
    "legacy.csv",
    "person_name,parent\nQA legacy child,QA Complete\n",
  );
  assert.equal(
    (await request(a, "imports/" + legacy.body.job_id)).body.valid,
    true,
  );
  const cycleExisting = await upload(
    a,
    "existing-cycle.csv",
    "external_id,person_name,introduced_by_external_id\nexisting,QA Complete,child\nchild,QA external child,existing\n",
  );
  const cycleRows = (await request(a, "imports/" + cycleExisting.body.job_id))
    .body.rows;
  const childId = (
    await query(
      "SELECT id FROM people WHERE user_id=$1 AND display_name='QA external child'",
      [a.id],
    )
  )[0].id;
  const mappedCycle = await request(
    a,
    "imports/" + cycleExisting.body.job_id + "/mapping",
    "PATCH",
    {
      decisions: {
        "2": {
          operation: "existing",
          person_id: full.body.id,
          confirmed: true,
        },
        "3": { operation: "existing", person_id: childId, confirmed: true },
      },
    },
  );
  assert.equal(mappedCycle.body.valid, false);
  assert.ok(
    mappedCycle.body.rows.some((r: any) =>
      r.errors.some((e: string) => e.includes("چرخه")),
    ),
  );
  const fresh = new FormData();
  fresh.set("file", new File([csv], "intentional.csv"));
  fresh.set("allow_duplicate", "true");
  assert.notEqual(
    (await request(a, "imports/people", "POST", fresh)).body.job_id,
    imported.body.job_id,
  );
  assert.equal((await request(b, "imports/" + refJob.id)).status, 404);
  assert.equal((await request(b, "messages/" + uncertain.id)).status, 404);
  check(
    "external import references, exact existing parent names, frozen commits, existing-network cycles and cross-owner jobs",
  );
  const futureOnce = await request(a, "reminders", "POST", {
    person_id: full.body.id,
    message: "Timezone test",
    scheduled_at: now.plus({ days: 5 }).toUTC().toISO(),
  });
  const settings = await request(a, "settings");
  const shifted = await request(a, "settings", "PATCH", {
    display_name: settings.body.display_name,
    timezone: "Europe/Berlin",
    florist_send_local_time: "09:00",
    sms_enabled: true,
    ui_calendar: "gregorian",
  });
  assert.equal(shifted.status, 200, JSON.stringify(shifted.body));
  const [rescheduled] = await query(
    "SELECT scheduled_at,timezone FROM reminders WHERE user_id=$1 AND id=$2",
    [a.id, futureOnce.body.id],
  );
  assert.equal(rescheduled.timezone, "Europe/Berlin");
  assert.equal(
    DateTime.fromJSDate(rescheduled.scheduled_at)
      .setZone("Europe/Berlin")
      .toFormat("HH:mm"),
    now.plus({ days: 5 }).toFormat("HH:mm"),
  );
  assert.equal((await request(a, "auth/me")).body.ui_calendar, "gregorian");
  const operations = await request(a, "operations");
  assert.equal(operations.status, 200, JSON.stringify(operations.body));
  assert.equal(typeof operations.body.failed, "number");
  const incidents = await monitorOnce(a.id);
  await monitorOnce(a.id);
  const [dedupAlerts] = await query(
    "SELECT count(*)::int n FROM operational_alerts WHERE user_id=$1",
    [a.id],
  );
  assert.ok(dedupAlerts.n <= 3);
  const seededNotifications = await query(
    "INSERT INTO notifications(user_id,title,body,created_at) SELECT $1,'Pagination QA','QA','2026-01-01'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,35) n RETURNING id",
    [a.id],
  );
  const notificationIds = new Set<string>();
  let nextNotification: string | null = null;
  do {
    const page = await request(
      a,
      "notifications?limit=7" +
        (nextNotification
          ? "&cursor=" + encodeURIComponent(nextNotification)
          : ""),
    );
    assert.equal(page.status, 200);
    for (const item of page.body.items) {
      assert.ok(!notificationIds.has(item.id));
      notificationIds.add(item.id);
    }
    nextNotification = page.body.next_cursor;
  } while (nextNotification);
  assert.ok(seededNotifications.every((n) => notificationIds.has(n.id)));
  await query(
    "INSERT INTO operational_alerts(user_id,code,detail) VALUES($1,'QA_DELIVERY','Synthetic delivery test')",
    [a.id],
  );
  process.env.OPS_ALERT_URL = "https://operations.invalid/incidents";
  try {
    await assert.rejects(() =>
      monitorOnce(a.id, async () => new Response("", { status: 503 })),
    );
    let delivered = 0;
    await monitorOnce(a.id, async () => {
      delivered++;
      return new Response("", { status: 200 });
    });
    assert.equal(delivered, 1);
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM operational_alerts WHERE user_id=$1 AND ops_pending",
          [a.id],
        )
      )[0].n,
      0,
    );
  } finally {
    delete process.env.OPS_ALERT_URL;
  }
  check(
    "timezone settings preserve future wall time and operational status/incident monitoring works",
  );

  const raceOrder = await request(a, "actions", "POST", {
    ...flower,
    important_date_id: null,
    occurrence_date: null,
    title: "QA race flower",
  });
  assert.equal(raceOrder.status, 201, JSON.stringify(raceOrder.body));
  const racePreview = await request(
    a,
    "actions/" + raceOrder.body.id + "/sms-preview",
    "POST",
    {},
  );
  await request(a, "actions/" + raceOrder.body.id + "/send-now", "POST", {
    preview_token: racePreview.body.preview_token,
  });
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      begin = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
  const sending = processOneMessage(a.id, async () => {
    begin();
    await wait;
    return { state: "accepted", provider_id: "synthetic-race" };
  });
  await started;
  try {
    assert.equal(
      (
        await request(a, "actions/" + raceOrder.body.id, "PATCH", {
          version: raceOrder.body.version,
          notes: "Concurrent edit",
        })
      ).body.error.code,
      "SEND_STARTED",
    );
  } finally {
    release();
    await sending;
  }
  const staleOrder = await request(a, "actions", "POST", {
    ...flower,
    important_date_id: null,
    occurrence_date: null,
    title: "QA stale preview",
  });
  const stalePreview = await request(
    a,
    "actions/" + staleOrder.body.id + "/sms-preview",
    "POST",
    {},
  );
  await request(a, "actions/" + staleOrder.body.id + "/send-now", "POST", {
    preview_token: stalePreview.body.preview_token,
  });
  await request(a, "florists/" + florist.body.id, "PATCH", {
    version: florist.body.version,
    mobile: "+989000000001",
  });
  await processOneMessage(a.id);
  assert.equal(
    (await request(a, "actions/" + staleOrder.body.id)).body.error_code,
    "STALE_PREVIEW",
  );
  check(
    "concurrent edits explicitly block after reservation and queued previews reject changed recipients",
  );
  const retried = await request(a, "reminders", "POST", {
    person_id: full.body.id,
    channel: "sms",
    recipient_person_id: full.body.id,
    message: "Retry QA",
    scheduled_at: now.minus({ minutes: 1 }).toUTC().toISO(),
  });
  await Promise.all([generateReminders(a.id), generateReminders(a.id)]);
  const [retryIntent] = await query(
    "SELECT id,count(*) OVER()::int n FROM outbox_messages WHERE user_id=$1 AND reminder_id=$2",
    [a.id, retried.body.id],
  );
  assert.equal(retryIntent.n, 1);
  for (let n = 0; n < 4; n++) {
    await processOneMessage(a.id, async () => ({
      state: "retry_wait",
      error_code: "RATE_LIMITED",
    }));
    await query(
      "UPDATE outbox_messages SET next_attempt_at=now() WHERE id=$1",
      [retryIntent.id],
    );
  }
  const [exhausted] = await query(
    "SELECT state,attempt_count,error_code FROM outbox_messages WHERE id=$1",
    [retryIntent.id],
  );
  assert.equal(exhausted.state, "failed");
  assert.equal(exhausted.attempt_count, 4);
  assert.equal(exhausted.error_code, "RETRIES_EXHAUSTED");
  check(
    "concurrent schedulers deduplicate intents and definitely unaccepted sends stop after three retries",
  );
  const photoForm = new FormData();
  photoForm.set(
    "file",
    new File(
      [
        await sharp({
          create: { width: 4, height: 4, channels: 3, background: "#abcdef" },
        })
          .png()
          .toBuffer(),
      ],
      "synthetic.png",
    ),
  );
  assert.equal(
    (await request(a, "people/" + full.body.id + "/photo", "POST", photoForm))
      .status,
    200,
  );
  const photo = await fetch(
    origin + "/api/v1/people/" + full.body.id + "/photo",
    { headers: { Cookie: a.cookie } },
  );
  assert.equal(photo.status, 200);
  const metadata = await sharp(
    Buffer.from(await photo.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(
    (await request(b, "people/" + full.body.id + "/photo")).status,
    404,
  );
  const badPhoto = new FormData();
  badPhoto.set("file", new File(["not an image"], "fake.png"));
  assert.equal(
    (await request(a, "people/" + full.body.id + "/photo", "POST", badPhoto))
      .status,
    422,
  );
  await rm(path.resolve(process.env.UPLOAD_DIR ?? "private/uploads", a.id), {
    recursive: true,
    force: true,
  });
  check(
    "private photo uploads validate actual content, strip metadata and enforce owner access",
  );

  const rollbackFile = await upload(
    a,
    "late-failure.csv",
    "external_id,person_name,introduced_by_external_id,relationship_type\nnew,QA must rollback,,\nexisting,Existing QA,parent,friend\nparent,Parent QA,,\n",
  );
  const rollbackMapping = await request(
    a,
    "imports/" + rollbackFile.body.job_id + "/mapping",
    "PATCH",
    {
      decisions: {
        "3": { operation: "existing", person_id: p.id, confirmed: true },
        "4": { operation: "existing", person_id: p2.id, confirmed: true },
      },
    },
  );
  assert.equal(
    rollbackMapping.body.valid,
    true,
    JSON.stringify(rollbackMapping.body.rows),
  );
  await request(a, "imports/" + rollbackFile.body.job_id + "/commit", "POST", {
    checksum: (await request(a, "imports/" + rollbackFile.body.job_id)).body
      .checksum,
  });
  await processPendingImport(a.id);
  assert.equal(
    (await request(a, "imports/" + rollbackFile.body.job_id)).body.status,
    "failed",
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int n FROM people WHERE user_id=$1 AND display_name='QA must rollback'",
        [a.id],
      )
    )[0].n,
    0,
  );
  check("a late database constraint failure rolls back every imported person");
  await query("UPDATE users SET must_change_password=true WHERE id=$1", [b.id]);
  assert.equal(
    (await request(b, "people")).body.error.code,
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.equal(
    (
      await request(b, "auth/password", "POST", {
        current_password: "QA-only-password-2026!",
        new_password: "Synthetic-new-password-2026!",
      })
    ).status,
    200,
  );
  assert.equal((await request(b, "auth/me")).status, 401);
  check(
    "initial passwords gate private features and password changes revoke sessions",
  );
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
  for (const id of users) {
    await rm(path.resolve(process.env.UPLOAD_DIR ?? "private/uploads", id), {
      recursive: true,
      force: true,
    });
    await transaction(async (db) => {
      for (const table of [
        "operational_alerts",
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
  }
  await pool.end();
}
