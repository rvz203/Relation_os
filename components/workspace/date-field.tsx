"use client";
import { useState, useEffect, useRef } from "react";
import { DateTime } from "luxon";
import * as j from "jalaali-js";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { fa } from "@/lib/client";
const digits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
function parts(iso: string, calendar: string) {
  const d = DateTime.fromISO(iso || DateTime.now().toISODate()!);
  return calendar === "jalali"
    ? (() => {
        const x = j.toJalaali(d.year, d.month, d.day);
        return { year: x.jy, month: x.jm, day: x.jd };
      })()
    : { year: d.year, month: d.month, day: d.day };
}
function toISO(year: number, month: number, day: number, calendar: string) {
  try {
    if (calendar === "jalali") {
      if (!j.isValidJalaaliDate(year, month, day)) return "";
      const g = j.toGregorian(year, month, day);
      return DateTime.utc(g.gy, g.gm, g.gd).toISODate() ?? "";
    }
    const d = DateTime.utc(year, month, day);
    return d.isValid ? d.toISODate()! : "";
  } catch {
    return "";
  }
}
function DayGrid({
  year,
  month,
  calendar,
  onSelect,
}: {
  year: number;
  month: number;
  calendar: string;
  onSelect: (day: number) => void;
}) {
  let length = 0;
  try {
    length =
      calendar === "jalali"
        ? j.jalaaliMonthLength(year, month)
        : (DateTime.utc(year, month).daysInMonth ?? 0);
  } catch {}
  return (
    <div className="date-picker-grid">
      {Array.from({ length }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i + 1)}
          aria-label={"انتخاب روز " + fa(i + 1)}
        >
          {fa(i + 1)}
        </button>
      ))}
    </div>
  );
}
export function DateField({
  name,
  defaultValue = "",
  required = false,
  time = false,
  calendar = "jalali",
  label = "تاریخ",
  onChange,
}: {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  time?: boolean;
  calendar?: string;
  label?: string;
  onChange?: (iso: string) => void;
}) {
  const initial = parts(defaultValue?.slice(0, 10) ?? "", calendar),
    [value, setValue] = useState(
      defaultValue
        ? `${initial.year}/${String(initial.month).padStart(2, "0")}/${String(initial.day).padStart(2, "0")}`
        : "",
    ),
    [clock, setClock] = useState(defaultValue?.slice(11, 16) || "09:00"),
    [open, setOpen] = useState(false),
    [view, setView] = useState(initial);
  const manual = useRef<HTMLInputElement>(null);
  const parsed = digits(value).match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$/),
    iso = parsed
      ? toISO(Number(parsed[1]), Number(parsed[2]), Number(parsed[3]), calendar)
      : "";
  useEffect(() => {
    manual.current?.setCustomValidity(
      value && !iso ? "تاریخ معتبر وارد کنید." : "",
    );
  }, [value, iso]);
  const update = (text: string) => {
    setValue(text);
    const p = digits(text).match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$/);
    const day = p
      ? toISO(Number(p[1]), Number(p[2]), Number(p[3]), calendar)
      : "";
    onChange?.(day);
  };
  const move = (delta: number) =>
    setView((v) => {
      let month = v.month + delta,
        year = v.year;
      if (month === 13) {
        year++;
        month = 1;
      }
      if (month === 0) {
        year--;
        month = 12;
      }
      return { ...v, year, month };
    });
  return (
    <div className="date-field">
      <input
        name={name}
        type="hidden"
        value={iso ? (time ? iso + "T" + clock : iso) : ""}
      />
      <div className="date-manual">
        <input
          ref={manual}
          aria-label={label + (calendar === "jalali" ? " شمسی" : " میلادی")}
          required={required}
          dir="ltr"
          placeholder={calendar === "jalali" ? "1405/08/14" : "2026/11/05"}
          value={value}
          onChange={(e) => {
            update(e.target.value);
            const next = digits(e.target.value).match(
              /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$/,
            );
            e.target.setCustomValidity(
              e.target.value &&
                (!next ||
                  !toISO(
                    Number(next[1]),
                    Number(next[2]),
                    Number(next[3]),
                    calendar,
                  ))
                ? "تاریخ معتبر وارد کنید."
                : "",
            );
          }}
          onBlur={(e) =>
            e.target.setCustomValidity(
              value && !iso ? "تاریخ معتبر وارد کنید." : "",
            )
          }
        />
        <button
          type="button"
          aria-label={"بازکردن تقویم " + label}
          onClick={() => setOpen((v) => !v)}
        >
          <CalendarDays size={18} />
        </button>
        {time && (
          <input
            type="time"
            aria-label={"ساعت " + label}
            required={required}
            value={clock}
            onChange={(e) => setClock(e.target.value)}
          />
        )}
      </div>
      {open && (
        <div className="date-picker-popover">
          <div className="date-picker-head">
            <button
              type="button"
              aria-label="ماه قبل در انتخابگر"
              onClick={() => move(-1)}
            >
              <ChevronRight size={16} />
            </button>
            <span>
              {fa(view.year)} / {fa(view.month)}
            </span>
            <button
              type="button"
              aria-label="ماه بعد در انتخابگر"
              onClick={() => move(1)}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <DayGrid
            year={view.year}
            month={view.month}
            calendar={calendar}
            onSelect={(day) => {
              update(`${view.year}/${view.month}/${day}`);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
export function SourceDateFields({
  calendar,
  record,
  repeat,
}: {
  calendar: string;
  record: any;
  repeat: string;
}) {
  const [year, setYear] = useState(String(record.original_year ?? "")),
    [month, setMonth] = useState(String(record.month ?? 1)),
    [day, setDay] = useState(String(record.day ?? 1)),
    [open, setOpen] = useState(false);
  return (
    <>
      <div className="form-two">
        <label>
          ماه
          <input
            name="month"
            inputMode="numeric"
            required
            value={month}
            onChange={(e) => setMonth(digits(e.target.value))}
          />
        </label>
        <label>
          روز
          <input
            name="day"
            inputMode="numeric"
            required
            value={day}
            onChange={(e) => setDay(digits(e.target.value))}
          />
        </label>
      </div>
      <label>
        سال {repeat === "yearly" ? "(اختیاری؛ سال نامعلوم مجاز است)" : ""}
        <input
          name="original_year"
          inputMode="numeric"
          required={repeat === "none"}
          value={year}
          onChange={(e) => setYear(digits(e.target.value))}
        />
      </label>
      <button
        type="button"
        className="text-button"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarDays size={16} />
        انتخاب روز از تقویم {calendar === "jalali" ? "شمسی" : "میلادی"}
      </button>
      {open && (
        <DayGrid
          year={Number(year) || (calendar === "jalali" ? 1399 : 2000)}
          month={Math.min(12, Math.max(1, Number(month) || 1))}
          calendar={calendar}
          onSelect={(d) => {
            setDay(String(d));
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
