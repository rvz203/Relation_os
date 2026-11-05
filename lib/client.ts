export type Person = {
  id: string;
  display_name: string;
  company?: string;
  job_title?: string;
  importance_level: string;
  tags?: string[];
  mobile?: string;
  city?: string;
  email?: string;
  address?: string;
  notes?: string;
  private_notes?: string;
  introduced_by_person_id?: string;
  introduced_by_name?: string;
  introduction_source?: string;
  last_interaction_at?: string;
  photo_key?: string;
  is_self?: boolean;
  expertise?: string[];
  labels?: string[];
  first_name?: string;
  last_name?: string;
  gender?: string;
  country_code?: string;
  industry?: string;
  activity_area?: string;
  first_met_on?: string;
  acquaintance_notes?: string;
  next_action?: Action;
  version: number;
};
export type Action = {
  id: string;
  person_id: string;
  person_name: string;
  title: string;
  due_at: string;
  action_type: string;
  status: string;
  sms_state?: string;
  error_code?: string;
  version: number;
  [key: string]: any;
};
export type User = {
  id: string;
  display_name: string;
  email: string;
  timezone: string;
  florist_send_local_time: string;
  sms_enabled: boolean;
  csrf_token: string;
  sms_mode: string;
  ui_calendar?: "jalali" | "gregorian";
  must_change_password?: boolean;
};
let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  route: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["X-CSRF-Token"] = csrf;
    headers["Idempotency-Key"] = key ?? crypto.randomUUID();
  }
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch("/api/v1/" + route, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "ارتباط با سرور قطع است. دوباره تلاش کنید؛ اطلاعات فرم حفظ شده‌اند.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("پاسخ سرور معتبر نیست.");
  }
  if (!response.ok && data.error?.code === "UNAUTHENTICATED")
    window.dispatchEvent(new Event("relationship:unauthenticated"));
  if (!response.ok)
    throw new APIError(
      data.error?.message ?? "ارتباط با سرور برقرار نشد.",
      data.error?.code ?? "ERROR",
      data.error?.fields,
    );
  return data;
}
export const fa = (n: number) => n.toLocaleString("fa-IR");
export function contactAge(date?: string) {
  if (!date) return "هنوز تعاملی ثبت نشده";
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 86400000),
  );
  return days === 0 ? "امروز" : days === 1 ? "دیروز" : fa(days) + " روز پیش";
}
export const labels: Record<string, string> = {
  call: "تماس",
  message: "پیام",
  sms: "پیامک",
  meeting: "جلسه",
  gift: "هدیه",
  flower: "گل",
  note: "یادداشت",
  custom: "سفارشی",
  reminder: "یادآوری",
  pending: "در انتظار",
  done: "انجام‌شده",
  cancelled: "لغوشده",
  queued: "در صف",
  accepted: "پذیرفته‌شده توسط سرویس",
  delivered: "تحویل‌شده",
  unknown: "نتیجه نامشخص",
  failed: "ناموفق",
  expired: "نیاز به اقدام دستی",
  processing: "در حال ارسال",
  retry_wait: "در انتظار تلاش مجدد",
};

export async function apiAll(route: string) {
  let items: any[] = [],
    cursor: string | null = null;
  do {
    const page: any = await api(
      route +
        (route.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    items.push(...page.items);
    cursor = page.next_cursor ?? null;
  } while (cursor);
  return { items, next_cursor: null };
}
