"use client";
import { useEffect, useState } from "react";
import { Check, Download, Flower2, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, apiAll, fa, labels, type User } from "@/lib/client";
import { faDate } from "@/lib/calendar";
import { Busy, Empty, ErrorBox, PersonPicker } from "./common";
import type { Workflow } from "./workflow-modal";
export function ImportPanel({ onChanged }: { onChanged: () => void }) {
  const [job, setJob] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [page, setPage] = useState(0),
    [allowDuplicate, setAllowDuplicate] = useState(false);
  const locked = busy || ["queued", "processing"].includes(job?.status);
  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    const timer = setInterval(
      () =>
        api("imports/" + job.id)
          .then((next) => {
            setJob(next);
            if (next.status === "committed") {
              onChanged();
              toast.success("ورود اطلاعات ثبت شد.");
            }
          })
          .catch(setError),
      1500,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status, onChanged]);
  const load = async (id: string) => setJob(await api("imports/" + id));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const update = async (input: any) =>
    run(async () => {
      await api("imports/" + job.id + "/mapping", "PATCH", input);
      await load(job.id);
    });
  return (
    <section className="panel settings-panel">
      <div className="section-head">
        <h2>
          <Upload size={19} />
          ورود افراد از فایل
        </h2>
        <a className="text-button" href="/api/v1/imports/template" download>
          <Download size={16} />
          قالب CSV
        </a>
      </div>
      <p className="muted">
        CSV با UTF-8 یا XLSX بدون فرمول؛ حداکثر ۵ مگابایت و ۵۰۰۰ ردیف. ابتدا
        پیش‌نمایش را بررسی و سپس ثبت نهایی کنید.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={allowDuplicate}
          onChange={(e) => setAllowDuplicate(e.target.checked)}
        />
        ورود دوباره عمدی فایل یکسان
      </label>
      <label className="file-input-label">
        انتخاب فایل
        <input
          aria-label="فایل ورود افراد"
          type="file"
          accept=".csv,.xlsx"
          disabled={locked}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              run(async () => {
                const form = new FormData();
                form.set("file", file);
                if (allowDuplicate) form.set("allow_duplicate", "true");
                const result = await api("imports/people", "POST", form);
                await load(result.job_id);
                setPage(0);
                if (result.duplicate)
                  toast.info(
                    "این فایل قبلاً بارگذاری شده است؛ همان پیش‌نمایش باز شد.",
                  );
              });
            e.target.value = "";
          }}
        />
      </label>
      <ErrorBox error={error} />
      {busy && (
        <p role="status" className="muted">
          در حال پردازش…
        </p>
      )}
      {job && (
        <div className="import-preview">
          <div className="detail-line">
            <strong>{job.filename}</strong>
            <span>
              {fa(job.rows.length)} سطر ·{" "}
              {job.status === "committed" ? "ثبت‌شده" : "پیش‌نمایش"}
            </span>
          </div>
          {job.status === "committed" ? (
            <div className="soft-notice">
              {fa(job.result.created)} فرد جدید، {fa(job.result.linked)} اتصال،{" "}
              {fa(job.result.skipped)} سطر نادیده گرفته‌شده.
            </div>
          ) : ["queued", "processing"].includes(job.status) ? (
            <div className="soft-notice" role="status">
              در صف پردازش؛ پس از ثبت نهایی نتیجه خودکار نمایش داده می‌شود.
            </div>
          ) : (
            <>
              {job.error_message && (
                <div className="error-box" role="alert">
                  {job.error_message}
                </div>
              )}
              <details>
                <summary>نگاشت ستون‌ها</summary>
                <div className="mapping-grid">
                  {[
                    "person_name",
                    "mobile",
                    "company",
                    "job_title",
                    "expertise",
                    "tags",
                    "notes",
                    "external_id",
                    "introduced_by_external_id",
                    "parent",
                    "relationship_type",
                  ].map((field) => (
                    <label key={field}>
                      <span dir="ltr">{field}</span>
                      <select
                        disabled={locked}
                        value={
                          job.mapping[field] ??
                          (job.headers.includes(field) ? field : "")
                        }
                        onChange={(e) =>
                          update({
                            mapping: {
                              ...job.mapping,
                              [field]: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">بدون ستون</option>
                        {job.headers.map((h: string) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
              <details>
                <summary>نگاشت معرفی‌کننده خارج از فایل</summary>
                {[
                  ...new Set<string>(
                    job.rows
                      .map((r: any) => r.data.introduced_by_external_id)
                      .filter(
                        (ref: string) =>
                          ref &&
                          !ref.startsWith("@") &&
                          !job.rows.some(
                            (r: any) => r.data.external_id === ref,
                          ),
                      ),
                  ),
                ].map((ref) => (
                  <PersonPicker
                    key={ref}
                    label={"شناسه " + ref}
                    value={job.external_references?.[ref] ?? ""}
                    onChange={(id) =>
                      update({
                        external_references: {
                          ...job.external_references,
                          [ref]: id,
                        },
                      })
                    }
                  />
                ))}
              </details>
              <div className="import-rows">
                {job.rows.slice(page * 25, (page + 1) * 25).map((row: any) => (
                  <div className="import-row" key={row.row_number}>
                    <div>
                      <strong>
                        {fa(row.row_number)} ·{" "}
                        {row.data.person_name || "بدون نام"}
                      </strong>
                      <small>{row.errors.join(" ") || "آماده ثبت"}</small>
                      <small>
                        معرفی‌کننده:{" "}
                        {row.data.parent ||
                          row.data.introduced_by_external_id ||
                          "نامشخص"}{" "}
                        · رابطه: {row.data.relationship_type || "فقط معرفی"} ·
                        تخصص: {row.data.expertise || "—"} · برچسب:{" "}
                        {row.data.tags || "—"}
                      </small>
                      {row.similar.length > 0 && (
                        <small>
                          افراد مشابه:{" "}
                          {row.similar
                            .map((p: any) => p.display_name)
                            .join("، ")}
                        </small>
                      )}
                    </div>
                    <select
                      aria-label={"تصمیم سطر " + row.row_number}
                      disabled={locked}
                      value={
                        row.decision.confirmed ? row.decision.operation : ""
                      }
                      onChange={(e) => {
                        const operation = e.target.value;
                        update({
                          decisions: {
                            [row.row_number]: {
                              operation,
                              confirmed: true,
                              person_id:
                                operation === "existing"
                                  ? row.similar[0]?.id
                                  : undefined,
                            },
                          },
                        });
                      }}
                    >
                      <option value="" disabled>
                        بررسی و انتخاب
                      </option>
                      <option value="new">ساخت فرد جدید</option>
                      <option value="existing">اتصال به فرد موجود</option>
                      <option value="skip">نادیده گرفتن</option>
                    </select>
                    {row.decision.operation === "existing" && (
                      <PersonPicker
                        label="فرد موجود"
                        value={row.decision.person_id ?? ""}
                        onChange={(id) =>
                          update({
                            decisions: {
                              [row.row_number]: {
                                operation: "existing",
                                person_id: id,
                                confirmed: true,
                              },
                            },
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="form-footer">
                <button
                  className="secondary"
                  disabled={page === 0 || busy}
                  onClick={() => setPage((v) => v - 1)}
                >
                  صفحه قبل
                </button>
                <span className="muted">
                  {fa(page + 1)} / {fa(Math.ceil(job.rows.length / 25))}
                </span>
                <button
                  className="secondary"
                  disabled={(page + 1) * 25 >= job.rows.length || busy}
                  onClick={() => setPage((v) => v + 1)}
                >
                  صفحه بعد
                </button>
              </div>
              <div className="form-footer">
                <button
                  className="primary"
                  disabled={!job.valid || locked}
                  onClick={() =>
                    run(async () => {
                      await api("imports/" + job.id + "/commit", "POST", {
                        checksum: job.checksum,
                      });
                      await load(job.id);
                      toast.info("درخواست در صف پردازش قرار گرفت.");
                    })
                  }
                >
                  <Check size={17} />
                  ثبت نهایی{" "}
                  {fa(
                    job.rows.filter((r: any) => r.decision.operation !== "skip")
                      .length,
                  )}{" "}
                  سطر
                </button>
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() =>
                    run(async () => {
                      await api("imports/" + job.id + "/validate", "POST", {});
                      await load(job.id);
                    })
                  }
                >
                  <RefreshCw size={15} />
                  اعتبارسنجی
                </button>
                <a
                  className="text-button"
                  href={"/api/v1/imports/" + job.id + "/errors"}
                  download
                >
                  گزارش خطاها
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
export function SettingsView({
  user,
  revision,
  onChanged,
  onWorkflow,
}: {
  user: User;
  revision: number;
  onChanged: () => void;
  onWorkflow: (w: Workflow) => void;
}) {
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState<Error | null>(null),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiAll("florists"),
      api("messages"),
      apiAll("reminders"),
      api("settings"),
      api("operations"),
    ])
      .then(
        ([f, m, r, s, ops]) =>
          alive &&
          setData({
            florists: f.items,
            messages: m.items,
            reminders: r.items,
            settings: s,
            operations: ops,
            messageCursor: m.next_cursor,
          }),
      )
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [revision]);
  return (
    <div className="settings-grid">
      <ErrorBox error={error} />
      <section className="panel settings-panel">
        <div className="section-head">
          <h2>تنظیمات فضای شما</h2>
          <button
            className="text-button"
            onClick={() => onWorkflow({ type: "password" })}
          >
            تغییر رمز
          </button>
        </div>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            setSaving(true);
            setError(null);
            try {
              await api("settings", "PATCH", {
                ...d,
                sms_enabled: d.sms_enabled === "on",
              });
              onChanged();
              toast.success("تنظیمات ذخیره شد.");
            } catch (e) {
              setError(e as Error);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            نام حساب
            <input
              name="display_name"
              defaultValue={user.display_name}
              required
            />
          </label>
          <div className="form-two">
            <label>
              منطقه زمانی
              <input
                name="timezone"
                dir="ltr"
                defaultValue={user.timezone}
                required
              />
            </label>
            <label>
              ساعت پیامک گلفروش
              <input
                name="florist_send_local_time"
                type="time"
                defaultValue={user.florist_send_local_time}
                required
              />
            </label>
          </div>
          <label>
            تقویم نمایش
            <select
              name="ui_calendar"
              defaultValue={user.ui_calendar ?? "jalali"}
            >
              <option value="jalali">هجری شمسی</option>
              <option value="gregorian">میلادی</option>
            </select>
          </label>
          <label>
            شماره موبایل خودم <small>برای یادآوری پیامکی به خودتان</small>
            <input
              name="owner_mobile"
              dir="ltr"
              defaultValue={data?.settings.owner_mobile ?? ""}
              key={data?.settings.owner_mobile ?? "empty"}
            />
          </label>
          <label className="check-label">
            <input
              name="sms_enabled"
              type="checkbox"
              defaultChecked={user.sms_enabled}
            />
            فعال بودن پیامک
          </label>
          <div className="soft-notice">
            {user.sms_mode === "sandbox"
              ? "سرویس در حالت sandbox است؛ پیامک واقعی ارسال نمی‌شود."
              : "سرویس پیامک عملیاتی فعال است."}
          </div>
          <button className="primary" disabled={saving}>
            ذخیره تنظیمات
          </button>
        </form>
      </section>
      <section className="panel settings-panel">
        <div className="section-head">
          <h2>
            <Flower2 size={19} />
            گلفروش‌ها
          </h2>
          <button
            className="text-button"
            onClick={() => onWorkflow({ type: "florist" })}
          >
            افزودن
          </button>
        </div>
        {!data ? (
          <Busy />
        ) : data.florists.length ? (
          data.florists.map((f: any) => (
            <button
              className="settings-record"
              key={f.id}
              onClick={() => onWorkflow({ type: "florist", record: f })}
            >
              <div>
                <strong>{f.name}</strong>
                <small dir="ltr">{f.mobile}</small>
              </div>
              <span>{f.is_active ? "فعال" : "غیرفعال"}</span>
            </button>
          ))
        ) : (
          <Empty title="گلفروشی ثبت نشده" />
        )}
      </section>
      <section className="panel settings-panel">
        <div className="section-head">
          <h2>سلامت زمان‌بندی</h2>
        </div>
        {data?.operations ? (
          <div className="monitor-summary">
            <p>
              وضعیت پردازشگر:{" "}
              {data.operations.worker_age_seconds !== null &&
              data.operations.worker_age_seconds <= 600
                ? "فعال"
                : "نیاز به بررسی"}
            </p>
            <p>
              قدیمی‌ترین پیام آماده: {fa(data.operations.queue_age_seconds)}{" "}
              ثانیه
            </p>
            <p>
              پیام نامشخص: {fa(data.operations.unknown)} · ناموفق:{" "}
              {fa(data.operations.failed)}
            </p>
            <p>خطاهای اخیر API: {fa(data.operations.api_errors_recent ?? 0)}</p>
            <p>
              {data.operations.credit_status === "sandbox"
                ? "پیامک آزمایشی؛ اعتبار مالی مصرف نمی‌شود."
                : data.operations.sms_balance !== null
                  ? "اعتبار پیامک: " + fa(data.operations.sms_balance)
                  : "استعلام اعتبار درگاه پیامک تنظیم نشده است."}
            </p>
          </div>
        ) : (
          <Busy />
        )}
      </section>
      <VocabularySettings revision={revision} onChanged={onChanged} />
      <ImportPanel onChanged={onChanged} />
      <section className="panel settings-panel">
        <div className="section-head">
          <h2>یادآوری‌ها</h2>
          <button
            className="text-button"
            onClick={() => onWorkflow({ type: "reminder" })}
          >
            افزودن
          </button>
        </div>
        {data?.reminders.length ? (
          data.reminders.map((r: any) => (
            <div key={r.id} className="settings-record">
              <div>
                <strong>{r.message}</strong>
                <small>
                  {r.channel === "in_app" ? "داخل برنامه" : "پیامک"} ·{" "}
                  {r.schedule_mode === "per_occurrence"
                    ? "هر نوبت مناسبت"
                    : faDate(r.scheduled_at)}{" "}
                  · {r.is_enabled ? "فعال" : "متوقف"}
                </small>
              </div>
              <button
                className="text-button"
                onClick={async () => {
                  const personId = r.target_person_id ?? r.person_id;
                  const person = personId
                    ? await api("people/" + personId)
                    : undefined;
                  onWorkflow({ type: "reminder", record: r, person });
                }}
              >
                ویرایش
              </button>
              {r.is_enabled && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("reminders/" + r.id, "DELETE");
                      onChanged();
                    } catch (e) {
                      setError(e as Error);
                    }
                  }}
                >
                  توقف
                </button>
              )}
            </div>
          ))
        ) : (
          <Empty title="یادآوری ثبت نشده" />
        )}
      </section>
      <section className="panel settings-panel message-settings">
        <div className="section-head">
          <h2>وضعیت پیام‌ها</h2>
          <button className="text-button" onClick={onChanged}>
            <RefreshCw size={16} />
            بازخوانی
          </button>
        </div>
        <p className="muted">
          پیام نامشخص خودکار دوباره ارسال نمی‌شود. پذیرش سرویس و رسید تحویل جدا
          هستند.
        </p>
        {data?.messages.length ? (
          data.messages.map((m: any) => (
            <div className="settings-record" key={m.id}>
              <div>
                <strong>
                  {m.channel === "sms" ? "پیامک" : "اعلان"} ·{" "}
                  {labels[m.state] ?? m.state}
                </strong>
                <small>
                  {faDate(m.scheduled_at, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {fa(m.attempt_count)} تلاش{" "}
                  {m.error_code && " · " + m.error_code}
                </small>
              </div>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    setSelectedMessage(await api("messages/" + m.id));
                  } catch (e) {
                    setError(e as Error);
                  }
                }}
              >
                جزئیات
              </button>
              {["unknown", "accepted"].includes(m.state) &&
                m.channel === "sms" && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        const result = await api(
                          "messages/" + m.id + "/reconcile",
                          "POST",
                          {},
                        );
                        toast.info(result.notice ?? labels[result.state]);
                        onChanged();
                      } catch (e) {
                        setError(e as Error);
                      }
                    }}
                  >
                    استعلام
                  </button>
                )}
            </div>
          ))
        ) : (
          <Empty title="پیامی ثبت نشده" />
        )}
      </section>
      {data?.messageCursor && (
        <button
          className="add-inline"
          onClick={async () => {
            try {
              const next = await api(
                "messages?cursor=" + encodeURIComponent(data.messageCursor),
              );
              setData((prev: any) => ({
                ...prev,
                messages: [...prev.messages, ...next.items],
                messageCursor: next.next_cursor,
              }));
            } catch (e) {
              setError(e as Error);
            }
          }}
        >
          نمایش پیام‌های بیشتر
        </button>
      )}
      {selectedMessage && (
        <section className="panel settings-panel message-settings">
          <div className="section-head">
            <h2>جزئیات پیام</h2>
            <button
              className="text-button"
              onClick={() => setSelectedMessage(null)}
            >
              بستن
            </button>
          </div>
          <p dir="ltr">{selectedMessage.payload?.to}</p>
          <p className="pre-wrap">
            {selectedMessage.payload?.text ??
              "متن پیام هنوز نهایی نشده یا دوره نگهداری آن گذشته است."}
          </p>
          {selectedMessage.logs.map((log: any) => (
            <div className="settings-record" key={log.id}>
              <strong>
                تلاش {fa(log.attempt_no)} ·{" "}
                {labels[log.send_status] ?? log.send_status}
              </strong>
              <small>
                {log.delivery_status
                  ? labels[log.delivery_status]
                  : "رسید تحویل موجود نیست"}
                {log.error_code ? " · " + log.error_code : ""}
              </small>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function VocabularySettings({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState("tags"),
    [items, setItems] = useState<any[]>([]),
    [record, setRecord] = useState<any>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiAll(kind + "?active=all")
      .then((d) => setItems(d.items))
      .catch(setError);
    setRecord(null);
  }, [kind, revision]);
  return (
    <section className="panel settings-panel">
      <div className="section-head">
        <h2>تخصص‌ها، برچسب‌ها و نوع روابط</h2>
      </div>
      <label>
        مدیریت
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="tags">تخصص و برچسب</option>
          <option value="relationship-types">نوع رابطه</option>
        </select>
      </label>
      <label>
        ویرایش
        <select
          value={record?.id ?? ""}
          onChange={(e) =>
            setRecord(items.find((i) => i.id === e.target.value) ?? null)
          }
        >
          <option value="">ساخت مورد جدید</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name ?? i.label}
              {!i.is_active ? " · غیرفعال" : ""}
            </option>
          ))}
        </select>
      </label>
      <ErrorBox error={error} />
      <form
        className="form-stack"
        key={kind + (record?.id ?? "new") + revision}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const d = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api(
              kind + (record ? "/" + record.id : ""),
              record ? "PATCH" : "POST",
              {
                ...d,
                is_active: d.is_active === "on",
                ...(kind === "relationship-types"
                  ? { is_directed: d.is_directed === "on" }
                  : {}),
              },
            );
            onChanged();
            toast.success("ذخیره شد.");
          } catch (error) {
            setError(error as Error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind === "tags" ? (
          <>
            <label>
              نام
              <input
                name="name"
                maxLength={80}
                required
                defaultValue={record?.name}
              />
            </label>
            <label>
              نوع
              <select name="kind" defaultValue={record?.kind ?? "expertise"}>
                <option value="expertise">تخصص</option>
                <option value="label">برچسب</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              کد
              <input
                name="code"
                dir="ltr"
                pattern="[a-z][a-z_]{1,39}"
                required
                defaultValue={record?.code}
              />
            </label>
            <label>
              عنوان
              <input name="label" required defaultValue={record?.label} />
            </label>
            <label>
              عنوان جهت معکوس
              <input
                name="reverse_label"
                defaultValue={record?.reverse_label ?? ""}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                name="is_directed"
                defaultChecked={record?.is_directed}
              />
              جهت‌دار
            </label>
            <p className="muted">جهت نوعی که استفاده شده قابل تغییر نیست.</p>
          </>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={record?.is_active ?? true}
          />
          فعال
        </label>
        <button className="primary" disabled={busy}>
          ذخیره
        </button>
      </form>
    </section>
  );
}
