"use client";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  Check,
  ChevronLeft,
  Flower2,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, fa, labels, type Person, type User } from "@/lib/client";
import { flowerSchedule, faDate } from "@/lib/calendar";
import { Busy, ErrorBox, PersonPicker } from "./common";
export type Workflow = {
  type:
    | "person"
    | "action"
    | "flower"
    | "interaction"
    | "occasion"
    | "relationship"
    | "reminder"
    | "florist"
    | "sms"
    | "archive"
    | "password";
  person?: Person;
  record?: any;
  event?: any;
};
const titles: Record<Workflow["type"], string> = {
  person: "یک آشنایی تازه",
  action: "برای ارتباط وقت بگذارید",
  flower: "یک گل، یک حال خوب",
  interaction: "ثبت یک تعامل",
  occasion: "یک روز مهم",
  relationship: "یک ارتباط تازه",
  reminder: "تنظیم یادآوری",
  florist: "اطلاعات گلفروش",
  sms: "بررسی پیام گلفروش",
  archive: "بایگانی فرد",
  password: "تغییر رمز عبور",
};
const dataOf = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form)) as Record<string, string>;
export function WorkflowModal({
  workflow,
  user,
  onClose,
  onSaved,
}: {
  workflow: Workflow;
  user: User;
  onClose: () => void;
  onSaved: (result?: any) => void;
}) {
  const w = workflow,
    record = w.record ?? {},
    p = w.person;
  const [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [person, setPerson] = useState(
      w.type === "relationship"
        ? (record.person_b_id ?? "")
        : (p?.id ?? record.person_id ?? ""),
    ),
    [parent, setParent] = useState(p?.introduced_by_person_id ?? ""),
    [source, setSource] = useState(p?.introduction_source ?? "direct");
  const [types, setTypes] = useState<any[]>([]),
    [florists, setFlorists] = useState<any[]>([]),
    [preview, setPreview] = useState<any>(null),
    [flowerDraft, setFlowerDraft] = useState<any>(null),
    [calendar, setCalendar] = useState(record.calendar ?? "jalali"),
    [repeat, setRepeat] = useState(record.recurrence ?? "yearly");
  const key = useRef(crypto.randomUUID());
  const flowerCache = useRef<Record<string, string>>({});
  const [dates, setDates] = useState<any[]>([]),
    [dateId, setDateId] = useState(w.event?.id ?? "");
  const zone = user.timezone,
    now = DateTime.now().setZone(zone),
    today = now.toISODate()!;
  useEffect(() => {
    if (w.type === "relationship")
      api("relationship-types")
        .then((d) => setTypes(d.items))
        .catch(setError);
    if (w.type === "flower")
      api("florists")
        .then((d) => setFlorists(d.items))
        .catch(setError);
    if (w.type === "sms")
      api("actions/" + record.id + "/sms-preview", "POST", {})
        .then(setPreview)
        .catch(setError);
  }, []);
  useEffect(() => {
    if (w.type === "reminder" && person)
      api("important-dates?person_id=" + person)
        .then((d) => setDates(d.items))
        .catch(setError);
  }, [person, w.type]);
  const execute = async (work: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      onSaved(result);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const toUTC = (value: string) => {
    const dt = DateTime.fromISO(value, { zone });
    if (!dt.isValid) throw new Error("تاریخ و ساعت معتبر نیست.");
    return dt.toUTC().toISO()!;
  };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = dataOf(e.currentTarget);
    if (w.type === "flower" && !flowerDraft) {
      flowerCache.current = d;
      const florist = florists.find((f) => f.id === d.florist_id);
      const delivery = d.delivery_date;
      setFlowerDraft({
        person_id: person,
        action_type: "flower",
        title: d.title || "ارسال گل",
        important_date_id: w.event?.id ?? record.important_date_id ?? null,
        occurrence_date:
          w.event?.occurrence_date ?? record.occurrence_date ?? null,
        due_at: toUTC(delivery + "T10:00"),
        version: record.version,
        flower: {
          florist_id: d.florist_id,
          budget_amount: Number(d.budget_amount),
          currency: d.currency,
          delivery_date: delivery,
          delivery_address: d.delivery_address,
          card_message: d.card_message,
        },
        florist,
      });
      return;
    }
    execute(async () => {
      if (w.type === "person")
        return api(
          "people" + (p ? "/" + p.id : ""),
          p ? "PATCH" : "POST",
          {
            ...d,
            display_name: d.display_name,
            introduction_source: source,
            introduced_by_person_id: source === "person" ? parent : null,
            tags: d.tags
              .split(/[,،;]/)
              .map((t) => t.trim())
              .filter(Boolean),
            version: p?.version,
          },
          key.current,
        );
      if (w.type === "action")
        return api(
          "actions" + (record.id ? "/" + record.id : ""),
          record.id ? "PATCH" : "POST",
          {
            ...d,
            person_id: person,
            due_at: toUTC(d.due_at),
            version: record.version,
          },
          key.current,
        );
      if (w.type === "flower") {
        const { florist, ...payload } = flowerDraft;
        return api(
          "actions" + (record.id ? "/" + record.id : ""),
          record.id ? "PATCH" : "POST",
          payload,
          key.current,
        );
      }
      if (w.type === "interaction")
        return api(
          "interactions",
          "POST",
          {
            person_id: person,
            interaction_type: d.interaction_type,
            notes: d.notes,
            occurred_at: toUTC(d.occurred_at),
          },
          key.current,
        );
      if (w.type === "occasion")
        return api(
          "important-dates" + (record.id ? "/" + record.id : ""),
          record.id ? "PATCH" : "POST",
          {
            ...d,
            person_id: person,
            calendar,
            recurrence: repeat,
            original_year: d.original_year ? Number(d.original_year) : null,
            month: Number(d.month),
            day: Number(d.day),
            version: record.version,
          },
          key.current,
        );
      if (w.type === "relationship")
        return api(
          "relationships" + (record.id ? "/" + record.id : ""),
          record.id ? "PATCH" : "POST",
          {
            ...d,
            person_a_id: record.person_a_id ?? p?.id,
            person_b_id: person,
            version: record.version,
          },
          key.current,
        );
      if (w.type === "florist")
        return api(
          "florists" + (record.id ? "/" + record.id : ""),
          record.id ? "PATCH" : "POST",
          { ...d, is_active: d.is_active === "on", version: record.version },
          key.current,
        );
      if (w.type === "reminder")
        return api(
          "reminders",
          "POST",
          {
            person_id: dateId ? null : person,
            important_date_id: dateId || null,
            channel: d.channel,
            recipient_person_id:
              d.channel === "sms" && d.recipient === "person" ? person : null,
            message: d.message,
            schedule_mode: dateId ? "per_occurrence" : "once",
            scheduled_at: dateId ? null : toUTC(d.scheduled_at),
            offset_days: Number(d.offset_days || 0),
            local_time: d.local_time || "09:00",
            timezone: zone,
          },
          key.current,
        );
      if (w.type === "sms")
        return api(
          "actions/" + record.id + "/send-now",
          "POST",
          { preview_token: preview.preview_token },
          key.current,
        );
      if (w.type === "archive")
        return api("people/" + p?.id + "/archive", "POST", {});
      if (w.type === "password") return api("auth/password", "POST", d);
    });
  };
  const personField = (label = "شخص") => (
    <PersonPicker
      value={person}
      onChange={setPerson}
      initial={p}
      label={label}
    />
  );
  const btn = (
    <div className="form-footer">
      <button
        type="submit"
        disabled={busy || (w.type === "sms" && !preview)}
        className="primary"
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Check size={16} />
        )}{" "}
        {w.type === "sms"
          ? "تأیید متن و گیرنده و ارسال"
          : w.type === "archive"
            ? "بایگانی و توقف برنامه‌ها"
            : "ذخیره اطلاعات"}
      </button>
      <button
        type="button"
        className="secondary"
        onClick={onClose}
        disabled={busy}
      >
        انصراف
      </button>
    </div>
  );
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent dir="rtl" className="app-dialog">
        <DialogTitle>
          {w.type === "person" && p
            ? "ویرایش " + p.display_name
            : titles[w.type]}
        </DialogTitle>
        <DialogDescription>
          {w.type === "flower"
            ? "بودجه و نشانی این نوبت را بررسی کنید. پیامک روز قبل از تحویل زمان‌بندی می‌شود."
            : "اطلاعات در فضای شخصی شما ذخیره می‌شوند."}
        </DialogDescription>
        <ErrorBox error={error} />
        {(error as any)?.code === "VERSION_CONFLICT" && (
          <button
            className="secondary"
            onClick={() => onSaved({ reload: true })}
          >
            بازخوانی اطلاعات جدید در فرم
          </button>
        )}
        <form className="form-stack" onSubmit={submit}>
          {w.type === "person" && (
            <>
              <label>
                نام و نام خانوادگی
                <input
                  name="display_name"
                  required
                  autoFocus
                  maxLength={200}
                  defaultValue={p?.display_name}
                  placeholder="مثلاً آرمان نیک‌پی"
                />
              </label>
              <label>
                شماره موبایل{" "}
                <input
                  name="mobile"
                  dir="ltr"
                  defaultValue={p?.mobile ?? ""}
                  placeholder="09…"
                  inputMode="tel"
                />
              </label>
              <label>
                نحوه آشنایی
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="direct">آشنایی مستقیم</option>
                  <option value="person">معرفی از طریق شخص</option>
                  <option value="unknown">نامشخص</option>
                </select>
              </label>
              {source === "person" && (
                <PersonPicker
                  name="introduced_by_person_id"
                  value={parent}
                  onChange={setParent}
                  label="معرفی‌کننده"
                />
              )}
              <div className="form-two">
                <label>
                  تخصص و برچسب
                  <input
                    name="tags"
                    defaultValue={p?.tags?.join("، ")}
                    placeholder="با ویرگول جدا کنید"
                  />
                </label>
                <label>
                  اهمیت رابطه
                  <select
                    name="importance_level"
                    defaultValue={p?.importance_level ?? "B"}
                  >
                    <option value="A">A · بسیار مهم</option>
                    <option value="B">B · مهم</option>
                    <option value="C">C · عادی</option>
                  </select>
                </label>
              </div>
              <details open={!!p}>
                <summary>اطلاعات تکمیلی</summary>
                <div className="form-stack">
                  <div className="form-two">
                    <label>
                      شرکت
                      <input name="company" defaultValue={p?.company} />
                    </label>
                    <label>
                      سمت
                      <input name="job_title" defaultValue={p?.job_title} />
                    </label>
                  </div>
                  <div className="form-two">
                    <label>
                      شهر
                      <input name="city" defaultValue={p?.city} />
                    </label>
                    <label>
                      ایمیل
                      <input
                        name="email"
                        dir="ltr"
                        type="email"
                        defaultValue={p?.email}
                      />
                    </label>
                  </div>
                  <label>
                    نشانی
                    <textarea name="address" defaultValue={p?.address} />
                  </label>
                  <label>
                    یادداشت رابطه
                    <textarea name="notes" defaultValue={p?.notes} />
                  </label>
                  <label>
                    یادداشت خصوصی
                    <textarea
                      name="private_notes"
                      defaultValue={p?.private_notes}
                    />
                  </label>
                </div>
              </details>
            </>
          )}
          {w.type === "action" && (
            <>
              {personField()}
              <label>
                عنوان اقدام
                <input
                  name="title"
                  required
                  autoFocus
                  defaultValue={record.title}
                  placeholder="مثلاً هماهنگی دیدار"
                />
              </label>
              <div className="form-two">
                <label>
                  نوع اقدام
                  <select
                    name="action_type"
                    defaultValue={record.action_type ?? "call"}
                  >
                    {[
                      "call",
                      "meeting",
                      "message",
                      "gift",
                      "reminder",
                      "custom",
                    ].map((t) => (
                      <option key={t} value={t}>
                        {labels[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  موعد <small>به وقت {zone}</small>
                  <input
                    type="datetime-local"
                    name="due_at"
                    required
                    defaultValue={
                      record.due_at
                        ? DateTime.fromISO(record.due_at)
                            .setZone(zone)
                            .toFormat("yyyy-MM-dd'T'HH:mm")
                        : now.plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm")
                    }
                  />
                </label>
              </div>
              <label>
                یادداشت
                <textarea name="notes" defaultValue={record.notes} />
              </label>
              <button
                className="text-button"
                type="button"
                onClick={() => onSaved({ openFlower: true, person_id: person })}
              >
                <Flower2 size={16} />
                ثبت سفارش گل به‌جای این اقدام
              </button>
            </>
          )}
          {w.type === "flower" &&
            (!flowerDraft ? (
              <>
                <div className="steps">
                  <span className="active">
                    <b>۱</b>جزئیات گل
                  </span>
                  <i />
                  <span>
                    <b>۲</b>بررسی و ثبت
                  </span>
                </div>
                {personField("گیرنده گل")}
                <label>
                  عنوان سفارش
                  <input
                    name="title"
                    required
                    defaultValue={
                      flowerCache.current.title ??
                      record.title ??
                      (w.event ? "گل " + w.event.title : "ارسال گل")
                    }
                  />
                </label>
                <div className="form-two">
                  <label>
                    بودجه
                    <input
                      name="budget_amount"
                      required
                      type="number"
                      min={1}
                      max={1e12}
                      defaultValue={
                        flowerCache.current.budget_amount ??
                        record.budget_amount ??
                        5000000
                      }
                    />
                  </label>
                  <label>
                    واحد
                    <select
                      name="currency"
                      defaultValue={
                        flowerCache.current.currency ?? record.currency ?? "IRT"
                      }
                    >
                      <option value="IRT">تومان</option>
                      <option value="IRR">ریال</option>
                    </select>
                  </label>
                </div>
                <label>
                  تاریخ تحویل میلادی
                  <input
                    name="delivery_date"
                    type="date"
                    required
                    min={today}
                    defaultValue={
                      flowerCache.current.delivery_date ??
                      record.delivery_date ??
                      w.event?.occurrence_date ??
                      now.plus({ days: 1 }).toISODate()!
                    }
                  />
                </label>
                <label>
                  نشانی تحویل
                  <textarea
                    name="delivery_address"
                    required
                    rows={2}
                    defaultValue={
                      flowerCache.current.delivery_address ??
                      record.delivery_address ??
                      p?.address
                    }
                  />
                </label>
                <label>
                  متن کارت
                  <textarea
                    name="card_message"
                    rows={2}
                    defaultValue={
                      flowerCache.current.card_message ??
                      record.card_message ??
                      "به امید روزهای روشن و اتفاق‌های خوب."
                    }
                  />
                </label>
                <label>
                  گلفروش
                  <select
                    name="florist_id"
                    required
                    defaultValue={
                      flowerCache.current.florist_id ?? record.florist_id ?? ""
                    }
                  >
                    <option value="">انتخاب کنید</option>
                    {florists
                      .filter((f) => f.is_active)
                      .map((f) => (
                        <option value={f.id} key={f.id}>
                          {f.name} · {f.mobile}
                        </option>
                      ))}
                  </select>
                </label>
                {!florists.some((f) => f.is_active) && (
                  <p className="muted">ابتدا گلفروش را در تنظیمات ثبت کنید.</p>
                )}
                <button type="submit" className="primary full">
                  بررسی سفارش <ChevronLeft size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="steps">
                  <span className="complete">
                    <b>
                      <Check size={13} />
                    </b>
                    جزئیات گل
                  </span>
                  <i />
                  <span className="active">
                    <b>۲</b>بررسی و ثبت
                  </span>
                </div>
                <div className="sms-preview">
                  <span>
                    <MessageSquare size={18} />
                    اطلاعاتی که برای گلفروش ارسال خواهد شد
                  </span>
                  <p>
                    گلفروش: {flowerDraft.florist?.name}{" "}
                    <b dir="ltr">{flowerDraft.florist?.mobile}</b>
                  </p>
                  <p>
                    بودجه: {fa(flowerDraft.flower.budget_amount)}{" "}
                    {flowerDraft.flower.currency === "IRT" ? "تومان" : "ریال"}
                  </p>
                  <p>
                    تاریخ تحویل: {faDate(flowerDraft.flower.delivery_date)}{" "}
                    <small dir="ltr">{flowerDraft.flower.delivery_date}</small>
                  </p>
                  <p>نشانی: {flowerDraft.flower.delivery_address}</p>
                  <p>کارت: {flowerDraft.flower.card_message || "بدون متن"}</p>
                </div>
                <div className="soft-notice">
                  زمان پیامک:{" "}
                  {faDate(
                    flowerSchedule(
                      flowerDraft.flower.delivery_date,
                      user.florist_send_local_time,
                      zone,
                    ).scheduled_at,
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                  <br />
                  {flowerDraft.flower.delivery_date === today
                    ? "ثبت در روز تحویل؛ نیاز به ارسال دستی پس از پیش‌نمایش دارد."
                    : `حالت پیامک: ${user.sms_mode === "sandbox" ? "آزمایشی؛ پیام واقعی ارسال نمی‌شود" : "سرویس عملیاتی"}`}
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setFlowerDraft(null)}
                >
                  ویرایش جزئیات
                </button>
                {btn}
              </>
            ))}
          {w.type === "interaction" && (
            <>
              {personField()}
              <div className="form-two">
                <label>
                  نوع تعامل
                  <select name="interaction_type" defaultValue="call">
                    {[
                      "call",
                      "meeting",
                      "message",
                      "gift",
                      "flower",
                      "note",
                      "custom",
                    ].map((t) => (
                      <option key={t} value={t}>
                        {labels[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  زمان واقعی تعامل
                  <input
                    type="datetime-local"
                    name="occurred_at"
                    required
                    max={now.toFormat("yyyy-MM-dd'T'HH:mm")}
                    defaultValue={now.toFormat("yyyy-MM-dd'T'HH:mm")}
                  />
                </label>
              </div>
              <label>
                شرح تعامل
                <textarea name="notes" autoFocus required rows={4} />
              </label>
              <p className="muted">
                یادداشت در محاسبه آخرین تماس مستقیم اثر ندارد.
              </p>
            </>
          )}
          {w.type === "occasion" && (
            <>
              {personField()}
              <label>
                عنوان مناسبت
                <input
                  name="title"
                  required
                  defaultValue={record.title}
                  placeholder="تولد، سالگرد همکاری و…"
                />
              </label>
              <div className="form-two">
                <label>
                  نوع
                  <select name="kind" defaultValue={record.kind ?? "birthday"}>
                    <option value="birthday">تولد</option>
                    <option value="anniversary">سالگرد</option>
                    <option value="custom">سفارشی</option>
                  </select>
                </label>
                <label>
                  تقویم
                  <select
                    value={calendar}
                    onChange={(e) => setCalendar(e.target.value)}
                  >
                    <option value="jalali">هجری شمسی</option>
                    <option value="gregorian">میلادی</option>
                  </select>
                </label>
              </div>
              <div className="form-two">
                <label>
                  ماه
                  <input
                    type="number"
                    name="month"
                    required
                    min={1}
                    max={12}
                    defaultValue={record.month}
                  />
                </label>
                <label>
                  روز
                  <input
                    type="number"
                    name="day"
                    required
                    min={1}
                    max={31}
                    defaultValue={record.day}
                  />
                </label>
              </div>
              <label>
                تکرار
                <select
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                >
                  <option value="yearly">هر سال</option>
                  <option value="none">یک‌باره</option>
                </select>
              </label>
              <label>
                سال {repeat === "yearly" ? "(اختیاری)" : ""}
                <input
                  type="number"
                  name="original_year"
                  required={repeat === "none"}
                  min={1}
                  max={9999}
                  defaultValue={record.original_year ?? ""}
                />
              </label>
              <label>
                روز کبیسه در سال غیرکبیسه
                <select
                  name="leap_policy"
                  defaultValue={record.leap_policy ?? "last_valid_day"}
                >
                  <option value="last_valid_day">آخرین روز معتبر ماه</option>
                  <option value="skip">انتظار تا سال کبیسه بعدی</option>
                </select>
              </label>
            </>
          )}
          {w.type === "relationship" && (
            <>
              <p className="muted">
                از طرف {p?.display_name ?? record.person_a_name}؛ در رابطه
                جهت‌دار، این شخص مبدأ است.
              </p>
              {personField("طرف رابطه")}
              <label>
                نوع رابطه
                <select
                  name="relationship_type_id"
                  required
                  defaultValue={record.relationship_type_id ?? ""}
                >
                  <option value="">انتخاب کنید</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {t.is_directed ? " ← " + t.reverse_label : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                یادداشت
                <textarea name="notes" defaultValue={record.notes} />
              </label>
            </>
          )}
          {w.type === "florist" && (
            <>
              <label>
                نام گلفروش
                <input
                  name="name"
                  autoFocus
                  required
                  defaultValue={record.name}
                />
              </label>
              <label>
                موبایل
                <input
                  name="mobile"
                  dir="ltr"
                  required
                  defaultValue={record.mobile}
                />
              </label>
              <label>
                توضیحات
                <textarea name="notes" defaultValue={record.notes} />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={record.is_active ?? true}
                />
                فعال
              </label>
            </>
          )}
          {w.type === "reminder" && (
            <>
              {personField()}
              <label>
                مناسبت مرتبط
                <select
                  value={dateId}
                  onChange={(e) => setDateId(e.target.value)}
                >
                  <option value="">یادآوری یک‌باره برای شخص</option>
                  {dates.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.title} · هر نوبت مناسبت
                    </option>
                  ))}
                </select>
              </label>
              {dateId ? (
                <div className="form-two">
                  <label>
                    فاصله روز <small>منفی یعنی قبل از مناسبت</small>
                    <input
                      name="offset_days"
                      type="number"
                      min={-365}
                      max={365}
                      defaultValue={-1}
                      required
                    />
                  </label>
                  <label>
                    ساعت
                    <input
                      type="time"
                      name="local_time"
                      defaultValue="09:00"
                      required
                    />
                  </label>
                </div>
              ) : (
                <label>
                  موعد
                  <input
                    name="scheduled_at"
                    type="datetime-local"
                    defaultValue={now
                      .plus({ days: 1 })
                      .toFormat("yyyy-MM-dd'T'HH:mm")}
                    required
                  />
                </label>
              )}
              <div className="form-two">
                <label>
                  کانال
                  <select name="channel">
                    <option value="in_app">اعلان داخل برنامه</option>
                    <option value="sms">پیامک</option>
                  </select>
                </label>
                <label>
                  گیرنده پیامک
                  <select name="recipient">
                    <option value="user">خودم</option>
                    <option value="person">شخص انتخاب‌شده</option>
                  </select>
                </label>
              </div>
              <label>
                متن یادآوری
                <textarea name="message" required rows={3} />
              </label>
              <p className="muted">
                منطقه زمانی: {zone}. اعلان داخل برنامه همیشه به حساب شما می‌رسد.
              </p>
            </>
          )}
          {w.type === "sms" &&
            (!preview && !error ? (
              <Busy />
            ) : (
              preview && (
                <>
                  <div className="sms-preview">
                    <span>
                      <MessageSquare size={18} />
                      گیرنده واقعی پیام: <b dir="ltr">{preview.to}</b>
                    </span>
                    <p className="pre-wrap">{preview.text}</p>
                  </div>
                  <div className="soft-notice">
                    {preview.mode === "sandbox"
                      ? "حالت آزمایشی؛ هیچ پیامک واقعی ارسال نمی‌شود."
                      : "با تأیید، این متن و نشانی برای گلفروش ارسال می‌شوند."}
                    <br />
                    پذیرش پیام توسط سرویس، به معنی تحویل گل یا پیام نیست.
                  </div>
                </>
              )
            ))}
          {w.type === "archive" && (
            <p>
              «{p?.display_name}» بایگانی می‌شود. اقدامات باز و یادآوری‌های
              آینده متوقف می‌شوند و تاریخچه حفظ خواهد شد.
            </p>
          )}
          {w.type === "password" && (
            <>
              <label>
                رمز فعلی
                <input
                  name="current_password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
              <label>
                رمز جدید <small>حداقل ۱۲ نویسه</small>
                <input
                  name="new_password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
              </label>
              <p className="muted">
                پس از تغییر رمز، همه نشست‌ها بسته می‌شوند.
              </p>
            </>
          )}
          {w.type !== "flower" && btn}
        </form>
      </DialogContent>
    </Dialog>
  );
}
