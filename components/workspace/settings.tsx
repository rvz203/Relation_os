"use client";
import { useEffect, useState } from "react";
import { Check, Download, Flower2, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, fa, labels, type User } from "@/lib/client";
import { faDate } from "@/lib/calendar";
import { Busy, Empty, ErrorBox, PersonPicker } from "./common";
import type { Workflow } from "./workflow-modal";
export function ImportPanel({ onChanged }: { onChanged: () => void }) {
  const [job, setJob] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [page, setPage] = useState(0);
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
      <label className="file-input-label">
        انتخاب فایل
        <input
          aria-label="فایل ورود افراد"
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              run(async () => {
                const form = new FormData();
                form.set("file", file);
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
          ) : (
            <>
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
                        disabled={busy}
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
              <div className="import-rows">
                {job.rows.slice(page * 25, (page + 1) * 25).map((row: any) => (
                  <div className="import-row" key={row.row_number}>
                    <div>
                      <strong>
                        {fa(row.row_number)} ·{" "}
                        {row.data.person_name || "بدون نام"}
                      </strong>
                      <small>{row.errors.join(" ") || "آماده ثبت"}</small>
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
                      disabled={busy}
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
                  disabled={!job.valid || busy}
                  onClick={() =>
                    run(async () => {
                      await api("imports/" + job.id + "/commit", "POST", {
                        checksum: job.checksum,
                      });
                      await load(job.id);
                      onChanged();
                      toast.success("ورود اطلاعات ثبت شد.");
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
                  disabled={busy}
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
  const [data, setData] = useState<any>(null),
    [error, setError] = useState<Error | null>(null),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api("florists"),
      api("messages"),
      api("reminders"),
      api("settings"),
    ])
      .then(
        ([f, m, r, s]) =>
          alive &&
          setData({
            florists: f.items,
            messages: m.items,
            reminders: r.items,
            settings: s,
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
    </div>
  );
}
