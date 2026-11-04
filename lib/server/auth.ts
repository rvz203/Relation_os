import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/db";
import {
  AppError,
  audit,
  fail,
  hash,
  passwordHash,
  verifyPassword,
} from "./core";
export type Owner = {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  florist_send_local_time: string;
  sms_enabled: boolean;
  csrf_token: string;
};
export const COOKIE = "relationship_session";
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const expected = new URL(process.env.APP_ORIGIN ?? req.url).origin;
  if (!origin || origin !== expected)
    fail("درخواست از مبدأ معتبر ارسال نشده است.", 403, "CSRF_ERROR");
}
export async function owner(
  req: NextRequest,
  mutation = false,
): Promise<Owner> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token)
    throw new AppError(401, "UNAUTHENTICATED", "ابتدا وارد حساب شوید.");
  const [u] = await query(
    `SELECT u.id,u.email,u.display_name,u.timezone,u.florist_send_local_time,u.sms_enabled,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hash(token)],
  );
  if (!u)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "نشست منقضی شده است. دوباره وارد شوید.",
    );
  if (mutation) {
    checkOrigin(req);
    if (req.headers.get("x-csrf-token") !== u.csrf_token)
      fail("نشست امنیتی معتبر نیست.", 403, "CSRF_ERROR");
  }
  return u as Owner;
}
const dummy = passwordHash("dummy-constant-verification-value");
export async function login(req: NextRequest) {
  checkOrigin(req);
  const data = await req.json();
  const email = String(data.email ?? "")
      .trim()
      .toLowerCase(),
    password = String(data.password ?? "");
  if (email.length > 254 || password.length > 256)
    fail("اطلاعات ورود معتبر نیست.");
  const key = hash(email);
  const [attempt] = await query(
    `INSERT INTO login_attempts(key,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts`,
    [key],
  );
  if (attempt.attempts > 10)
    fail(
      "تلاش ورود بیش از حد مجاز است. ۱۵ دقیقه دیگر امتحان کنید.",
      429,
      "RATE_LIMITED",
    );
  const [u] = await query("SELECT * FROM users WHERE email=$1", [email]);
  const valid = verifyPassword(password, u?.password_hash ?? dummy);
  if (!u || !valid)
    fail("ایمیل یا رمز عبور اشتباه است.", 401, "INVALID_CREDENTIALS");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  await transaction(async (db) => {
    await db.query("DELETE FROM login_attempts WHERE key=$1", [key]);
    await db.query(
      `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`,
      [hash(token), u.id, csrf],
    );
    await audit(db, u.id, "login", "user", u.id);
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: new URL(process.env.APP_ORIGIN ?? req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
  return res;
}
