import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import * as jalaali from "jalaali-js";
import {
  flowerSchedule,
  occurrences,
  nextOccurrence,
  isValidOriginal,
  type ImportantDate,
} from "../lib/calendar";
import {
  mobile,
  normalize,
  encrypt,
  decrypt,
  passwordHash,
  verifyPassword,
} from "../lib/server/core";
const base: ImportantDate = {
  calendar: "jalali",
  month: 7,
  day: 10,
  recurrence: "yearly",
  leap_policy: "last_valid_day",
};
test("Jalali annual dates keep their original month and day across Gregorian years", () => {
  const dates = occurrences(base, "2026-01-01", "2030-12-31");
  assert.equal(dates.length, 5);
  for (const iso of dates) {
    const d = DateTime.fromISO(iso),
      j = jalaali.toJalaali(d.year, d.month, d.day);
    assert.equal(j.jm, 7);
    assert.equal(j.jd, 10);
  }
});
test("both Jalali leap policies preserve intent", () => {
  const d = { ...base, month: 12, day: 30 };
  assert.ok(isValidOriginal(d));
  const last = occurrences(d, "2025-03-21", "2026-03-20");
  assert.equal(last.length, 1);
  assert.equal(jalaali.toJalaali(DateTime.fromISO(last[0]).toJSDate()).jd, 29);
  assert.deepEqual(
    occurrences({ ...d, leap_policy: "skip" }, "2025-03-21", "2026-03-20"),
    [],
  );
});
test("Gregorian February 29 handles unknown years and today inclusively", () => {
  const d: ImportantDate = {
    ...base,
    calendar: "gregorian",
    month: 2,
    day: 29,
  };
  assert.ok(isValidOriginal(d));
  assert.equal(nextOccurrence(d, "2027-02-28"), "2027-02-28");
  assert.equal(
    nextOccurrence({ ...d, leap_policy: "skip" }, "2027-02-28"),
    "2028-02-29",
  );
  assert.equal(isValidOriginal({ ...d, original_year: 2027 }), false);
});
test("florist sends at 09:00 Tehran on the previous calendar day", () => {
  const schedule = flowerSchedule("2026-11-05", "09:00", "Asia/Tehran");
  assert.equal(schedule.scheduled_at, "2026-11-04T05:30:00.000Z");
  assert.equal(
    DateTime.fromISO(schedule.deadline_at).setZone("Asia/Tehran").toISODate(),
    "2026-11-04",
  );
});
test("normalizes Persian search and phone digits without altering display text", () => {
  assert.equal(normalize("  علي  كريمي ۱۲٣ "), "علی کریمی 123");
  assert.equal(mobile("۰۹۱۲۳۴۵۶۷۸۹"), "+989123456789");
  assert.throws(() => mobile("123"));
  assert.equal(mobile(""), null);
});
test("private fields are authenticated ciphertext and password hashes use unique salts", () => {
  const a = encrypt("نشانی خصوصی")!,
    b = encrypt("نشانی خصوصی")!;
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "نشانی خصوصی");
  const parts = a.split(".");
  parts[2] = Buffer.alloc(16).toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
  const encoded = passwordHash("example-password");
  assert.ok(verifyPassword("example-password", encoded));
  assert.equal(verifyPassword("wrong", encoded), false);
});
