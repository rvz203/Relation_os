"use client";
import { useEffect, useState } from "react";
import { Network, Search, LoaderCircle } from "lucide-react";
import { api, type Person } from "@/lib/client";
export function Avatar({
  p,
  large = false,
}: {
  p: Partial<Person>;
  large?: boolean;
}) {
  const colors = ["blue", "purple", "orange", "pink", "teal", "indigo", "rose"];
  const color =
    colors[
      (p.id ?? "").split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) %
        colors.length
    ];
  return (
    <span className={`avatar ${color} ${large ? "large" : ""}`}>
      {p.photo_key ? (
        <img src={`/api/v1/people/${p.id}/photo?v=${p.photo_key}`} alt="" />
      ) : p.is_self ? (
        <Network size={24} />
      ) : (
        p.display_name
          ?.split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join(" ")
      )}
    </span>
  );
}
export function PersonPicker({
  name = "person_id",
  value,
  onChange,
  label = "شخص",
  initial,
}: {
  name?: string;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  initial?: Person;
}) {
  const [q, setQ] = useState(""),
    [items, setItems] = useState<Person[]>(initial ? [initial] : []),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      api("people?limit=30&q=" + encodeURIComponent(q))
        .then((d) => {
          if (alive) {
            setItems(
              initial && !d.items.some((p: Person) => p.id === initial.id)
                ? [initial, ...d.items]
                : d.items,
            );
            setError("");
          }
        })
        .catch(() => alive && setError("جست‌وجو انجام نشد."));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, initial]);
  return (
    <label>
      {label}
      <div className="picker-search">
        <Search size={16} />
        <input
          aria-label={"جست‌وجوی " + label}
          placeholder="جست‌وجوی نام…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <select
        name={name}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">انتخاب کنید</option>
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
export function Empty({
  title = "چیزی در این فهرست نیست",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Network size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Busy() {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle className="spin" size={28} />
      <p>در حال دریافت اطلاعات…</p>
    </div>
  );
}
export function ErrorBox({ error }: { error?: Error | null }) {
  return error ? (
    <div className="error-box" role="alert">
      <p>{error.message}</p>
      {Object.entries((error as any).fields ?? {}).map(([field, errors]) => (
        <small key={field}>
          {field}: {(errors as string[]).join("، ")}
        </small>
      ))}
    </div>
  ) : null;
}
