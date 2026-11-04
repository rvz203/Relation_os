import { DateTime } from "luxon";
import * as jalaali from "jalaali-js";
import { query, pool, transaction } from "../db/index";
import { passwordHash, normalize, encrypt } from "../lib/server/core";
import { savePerson } from "../lib/server/people";
import { saveRelationship } from "../lib/server/network";
import { saveDate, saveAction } from "../lib/server/dates-actions";
const email = "demo@relationship.local";
if ((await query("SELECT id FROM users WHERE email=$1", [email])).length) {
  console.log("Demo data already exists; no records changed.");
  await pool.end();
  process.exit(0);
}
if (process.env.NODE_ENV === "production")
  throw new Error("Demo seed is disabled in production.");
const user = await transaction(async (db) => {
  const [u] = await query(
    "INSERT INTO users(email,password_hash,display_name,sms_enabled) VALUES($1,$2,$3,true) RETURNING *",
    [email, passwordHash("Relationship-Demo-2026!"), "فضای شخصی من"],
    db,
  );
  await db.query(
    "INSERT INTO people(user_id,first_name,display_name,normalized_search,is_self,introduction_source) VALUES($1,'من','من',$2,true,'unknown')",
    [u.id, normalize("من")],
  );
  for (const [code, label, reverse, directed] of [
    ["friend", "دوست", "دوست", false],
    ["colleague", "همکار", "همکار", false],
    ["manager_of", "مدیر", "کارمند", true],
    ["family", "خانواده", "خانواده", false],
  ])
    await db.query(
      "INSERT INTO relationship_types(user_id,code,label,reverse_label,is_directed) VALUES($1,$2,$3,$4,$5)",
      [u.id, code, label, reverse, directed],
    );
  return u;
});
const source = [
  ["علی رضایی", "مدیرعامل", "گروه آوند", ["سرمایه‌گذاری", "مدیریت"], "A", 2],
  [
    "سارا احمدی",
    "مدیر مارکتینگ",
    "استودیو مدار",
    ["مارکتینگ", "برندینگ"],
    "A",
    -1,
  ],
  [
    "مهدی کریمی",
    "مشاور کسب‌وکار",
    "مشاور مستقل",
    ["استراتژی", "سرمایه‌گذاری"],
    "A",
    -1,
  ],
  ["نیلوفر نادری", "طراح محصول", "تیم نقطه", ["تکنولوژی", "طراحی"], "B", 1],
  ["امیر حسینی", "مدیر بازرگانی", "راه ابریشم", ["صادرات", "فروش"], "B", 2],
  ["رضا شریفی", "بنیان‌گذار", "شرکت رایان", ["تکنولوژی", "مدیریت"], "B", 0],
  ["نگار موسوی", "مشاور حقوقی", "مؤسسه دادمان", ["حقوق", "مشاوره"], "B", -1],
  ["پارسا محمدی", "مدیر فروش", "گروه سپهر", ["فروش", "توسعه بازار"], "C", 4],
] as const;
const people = [];
for (const [name, role, company, tags, importance] of source)
  people.push(
    await savePerson(user.id, {
      display_name: name,
      company,
      job_title: role,
      tags: [...tags],
      importance_level: importance,
      city: "مشهد",
      notes: "داده ساختگی برای بررسی برنامه.",
      address: "نشانی نمونه؛ پیش از سفارش واقعی اصلاح شود.",
    }),
  );
for (let i = 0; i < people.length; i++) {
  const parent = source[i][5];
  if (parent >= 0)
    await savePerson(
      user.id,
      {
        ...people[i],
        introduction_source: "person",
        introduced_by_person_id: people[parent].id,
      },
      people[i].id,
    );
}
const types = await query("SELECT * FROM relationship_types WHERE user_id=$1", [
  user.id,
]);
for (const [a, b, t] of [
  [0, 2, 0],
  [0, 1, 1],
  [1, 3, 1],
  [2, 4, 1],
  [4, 7, 2],
  [6, 3, 1],
  [0, 5, 1],
])
  await saveRelationship(user.id, {
    person_a_id: people[a].id,
    person_b_id: people[b].id,
    relationship_type_id: types[t].id,
  });
const now = DateTime.now().setZone(user.timezone),
  today = now.toISODate()!;
for (const [index, days, title, kind] of [
  [0, 1, "تولد", "birthday"],
  [1, 3, "سالگرد همکاری", "anniversary"],
  [2, 7, "تولد", "birthday"],
] as const) {
  const dt = now.plus({ days }),
    j = jalaali.toJalaali(dt.year, dt.month, dt.day);
  await saveDate(user.id, {
    person_id: people[index].id,
    title,
    kind,
    calendar: "jalali",
    month: j.jm,
    day: j.jd,
    recurrence: "yearly",
  });
}
const [florist] = await query(
  "INSERT INTO florists(user_id,name,mobile,notes) VALUES($1,$2,$3,$4) RETURNING *",
  [
    user.id,
    "گل‌فروشی بهار (نمونه)",
    "+989000000000",
    "شماره ساختگی؛ فقط sandbox.",
  ],
);
const tomorrow = now.plus({ days: 1 }).toISODate()!;
await saveAction(user as any, {
  person_id: people[0].id,
  action_type: "flower",
  title: "گل تولد علی",
  due_at: DateTime.fromISO(tomorrow + "T10:00", {
    zone: user.timezone,
  }).toISO(),
  flower: {
    florist_id: florist.id,
    budget_amount: 5000000,
    currency: "IRT",
    delivery_date: tomorrow,
    delivery_address: "نشانی ساختگی برای آزمون",
    card_message: "تولدت مبارک؛ به امید روزهای روشن.",
  },
});
for (const [index, time, type, title] of [
  [2, "11:30", "call", "تماس برای پیگیری همکاری"],
  [1, "14:00", "meeting", "گفت‌وگو درباره پروژه جدید"],
  [4, "17:00", "message", "پیام و احوال‌پرسی"],
] as const)
  await saveAction(user as any, {
    person_id: people[index].id,
    action_type: type,
    title,
    due_at: DateTime.fromISO(today + "T" + time, {
      zone: user.timezone,
    }).toISO(),
  });
for (let i = 0; i < people.length; i++)
  await query(
    "INSERT INTO interactions(user_id,person_id,occurred_at,interaction_type,notes) VALUES($1,$2,$3,'call',$4)",
    [
      user.id,
      people[i].id,
      now.minus({ days: [3, 7, 1, 5, 14, 4, 10, 21][i] }).toISO(),
      encrypt("گفت‌وگوی نمونه درباره زمینه‌های همکاری."),
    ],
  );
await query(
  "INSERT INTO notifications(user_id,title,body) VALUES($1,'به فضای روابط خوش آمدید','این حساب شامل داده‌های ساختگی و پیامک sandbox است.')",
  [user.id],
);
console.log(
  "Demo owner and synthetic network created. See README for local demo login.",
);
await pool.end();
