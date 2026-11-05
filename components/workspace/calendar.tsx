"use client";
import { useEffect, useState } from "react";
import * as jalaali from "jalaali-js";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, fa } from "@/lib/client";
import { faDate } from "@/lib/calendar";
import { Busy, Empty, ErrorBox } from "./common";
export function CalendarView({
  zone,
  calendar = "jalali",
  onPerson,
  onFlower,
  revision,
}: {
  zone: string;
  calendar?: string;
  onPerson: (id: string) => void;
  onFlower: (id: string, event?: any) => void;
  revision: number;
}) {
  const today = DateTime.now().setZone(zone),
    j = jalaali.toJalaali(today.year, today.month, today.day);
  const [month, setMonth] = useState({
      year: calendar === "jalali" ? j.jy : today.year,
      month: calendar === "jalali" ? j.jm : today.month,
    }),
    [selected, setSelected] = useState(today.toISODate()!),
    [events, setEvents] = useState<any[] | null>(null),
    [error, setError] = useState<Error | null>(null);
  const first =
      calendar === "jalali"
        ? jalaali.toGregorian(month.year, month.month, 1)
        : { gy: month.year, gm: month.month, gd: 1 },
    length =
      calendar === "jalali"
        ? jalaali.jalaaliMonthLength(month.year, month.month)
        : DateTime.utc(month.year, month.month).daysInMonth!,
    start = DateTime.utc(first.gy, first.gm, first.gd),
    end = start.plus({ days: length - 1 }),
    offset = (start.weekday + 1) % 7;
  useEffect(() => {
    let alive = true;
    setEvents(null);
    api(`calendar?from=${start.toISODate()}&to=${end.toISODate()}`)
      .then((d) => {
        if (alive) {
          setEvents(d.items);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [month.year, month.month, revision]);
  const move = (delta: number) => {
    let m = month.month + delta,
      y = month.year;
    if (m === 13) {
      m = 1;
      y++;
    }
    if (m === 0) {
      m = 12;
      y--;
    }
    setMonth({ year: y, month: m });
    const g =
      calendar === "jalali"
        ? jalaali.toGregorian(y, m, 1)
        : { gy: y, gm: m, gd: 1 };
    setSelected(DateTime.utc(g.gy, g.gm, g.gd).toISODate()!);
  };
  return (
    <div className="calendar-layout">
      <section className="panel calendar-mobile-list">
        <div className="section-head">
          <h2>
            {faDate(start.toISODate()!, {
              month: "long",
              year: "numeric",
              day: undefined,
            })}
          </h2>
          <div className="calendar-controls">
            <button aria-label="ماه قبل در فهرست" onClick={() => move(-1)}>
              <ChevronRight size={19} />
            </button>
            <button
              onClick={() => {
                setMonth({
                  year: calendar === "jalali" ? j.jy : today.year,
                  month: calendar === "jalali" ? j.jm : today.month,
                });
                setSelected(today.toISODate()!);
              }}
            >
              امروز
            </button>
            <button aria-label="ماه بعد در فهرست" onClick={() => move(1)}>
              <ChevronLeft size={19} />
            </button>
          </div>
        </div>
        <ErrorBox error={error} />
        {events === null ? (
          <Busy />
        ) : events.length ? (
          events.map((e) => (
            <button
              key={e.id + e.occurrence_date}
              className="calendar-list-event"
              onClick={() => {
                setSelected(e.occurrence_date);
                onPerson(e.person_id);
              }}
            >
              <span className="date-tile">
                <strong>
                  {faDate(e.occurrence_date, {
                    day: "numeric",
                    month: undefined,
                  })}
                </strong>
                <small>
                  {faDate(e.occurrence_date, {
                    month: "short",
                    day: undefined,
                  })}
                </small>
              </span>
              <span>
                <strong>{e.title}</strong>
                <small>
                  {e.person_name} ·{" "}
                  {e.event_type === "occasion" ? "مناسبت" : "اقدام"}
                </small>
              </span>
              <ChevronLeft size={16} />
            </button>
          ))
        ) : (
          <Empty title="برنامه‌ای برای این ماه نیست" />
        )}
      </section>
      <section className="panel calendar-panel">
        <div className="section-head">
          <h2>
            {faDate(start.toISODate()!, {
              month: "long",
              year: "numeric",
              day: undefined,
            })}
          </h2>
          <div className="calendar-controls">
            <button aria-label="ماه قبل" onClick={() => move(-1)}>
              <ChevronRight size={19} />
            </button>
            <button
              onClick={() => {
                setMonth({
                  year: calendar === "jalali" ? j.jy : today.year,
                  month: calendar === "jalali" ? j.jm : today.month,
                });
                setSelected(today.toISODate()!);
              }}
            >
              امروز
            </button>
            <button aria-label="ماه بعد" onClick={() => move(1)}>
              <ChevronLeft size={19} />
            </button>
          </div>
        </div>
        <ErrorBox error={error} />
        {events === null ? (
          <Busy />
        ) : (
          <>
            <div className="calendar-week">
              {[
                "شنبه",
                "یکشنبه",
                "دوشنبه",
                "سه‌شنبه",
                "چهارشنبه",
                "پنجشنبه",
                "جمعه",
              ].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: offset }, (_, i) => (
                <div key={"blank" + i} />
              ))}
              {Array.from({ length }, (_, i) => {
                const date = start.plus({ days: i }).toISODate()!;
                return (
                  <button
                    key={date}
                    onClick={() => setSelected(date)}
                    className={`${date === today.toISODate() ? "is-today" : ""} ${date === selected ? "selected-day" : ""}`}
                    aria-label={faDate(date)}
                  >
                    <span>{fa(i + 1)}</span>
                    {events
                      .filter((e) => e.occurrence_date === date)
                      .slice(0, 3)
                      .map((e) => (
                        <small key={e.id}>{e.title}</small>
                      ))}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
      <aside className="calendar-agenda panel">
        <div className="section-head">
          <h2>{faDate(selected)}</h2>
        </div>
        {events?.filter((e) => e.occurrence_date === selected).length ? (
          events
            .filter((e) => e.occurrence_date === selected)
            .map((e) => (
              <div className="agenda-event" key={e.id}>
                <button
                  className="text-button"
                  onClick={() => onPerson(e.person_id)}
                >
                  <h3>
                    {e.title} · {e.person_name}
                  </h3>
                </button>
                <span>
                  {e.event_type === "occasion"
                    ? e.recurrence === "yearly"
                      ? "تکرار سالانه"
                      : "یک‌باره"
                    : e.status === "done"
                      ? "انجام‌شده"
                      : "اقدام برنامه‌ریزی‌شده"}
                </span>
                {e.event_type === "occasion" && (
                  <button
                    className="secondary"
                    onClick={() => onFlower(e.person_id, e)}
                  >
                    برنامه‌ریزی گل
                  </button>
                )}
              </div>
            ))
        ) : (
          <Empty title="مناسبتی برای این روز نیست" />
        )}
      </aside>
    </div>
  );
}
