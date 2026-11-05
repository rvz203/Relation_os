"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Network, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { api, type Person } from "@/lib/client";
import { Avatar, Busy, ErrorBox, PersonPicker } from "./common";
type Edge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  directed?: boolean;
};
type GraphData = {
  nodes: Person[];
  edges: Edge[];
  center_person_id: string;
  has_more: boolean;
  truncated: boolean;
};
export function Graph({
  onPerson,
  compact = false,
  revision = 0,
}: {
  onPerson: (id: string) => void;
  compact?: boolean;
  revision?: number;
}) {
  const [data, setData] = useState<GraphData | null>(null),
    [error, setError] = useState<Error | null>(null),
    [center, setCenter] = useState(""),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const drag = useRef<any>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    api("network?depth=1" + (center ? "&center_person_id=" + center : ""))
      .then((d) => {
        if (alive) {
          setData(d);
          setExpanded(new Set([d.center_person_id]));
          setError(null);
          setPositions({});
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [center, revision]);
  const toggle = async (id: string) => {
    if (expanded.has(id)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    try {
      const d: GraphData = await api("network?center_person_id=" + id);
      setData((prev) =>
        prev
          ? {
              ...prev,
              nodes: [
                ...prev.nodes,
                ...d.nodes.filter(
                  (n) => !prev.nodes.some((p) => p.id === n.id),
                ),
              ],
              edges: [
                ...prev.edges,
                ...d.edges.filter(
                  (e) => !prev.edges.some((p) => p.id === e.id),
                ),
              ],
              has_more: d.has_more,
              truncated: prev.truncated || d.truncated,
            }
          : d,
      );
      setExpanded((prev) => new Set([...prev, id]));
    } catch (e) {
      setError(e as Error);
    }
  };
  if (!data) return error ? <ErrorBox error={error} /> : <Busy />;
  const visible = new Set([data.center_person_id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of data.edges) {
      if (
        visible.has(edge.source) &&
        expanded.has(edge.source) &&
        !visible.has(edge.target)
      ) {
        visible.add(edge.target);
        changed = true;
      }
      if (
        visible.has(edge.target) &&
        expanded.has(edge.target) &&
        !visible.has(edge.source)
      ) {
        visible.add(edge.source);
        changed = true;
      }
    }
  }
  const nodes = data.nodes.filter((n) => visible.has(n.id)),
    edges = data.edges.filter(
      (e) => visible.has(e.source) && visible.has(e.target),
    );
  const coordinates = (id: string) => {
    if (positions[id]) return positions[id];
    if (id === data.center_person_id) return { x: 50, y: 48 };
    const i = nodes
        .filter((n) => n.id !== data.center_person_id)
        .findIndex((n) => n.id === id),
      count = Math.max(1, nodes.length - 1),
      angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 35, y: 49 + Math.sin(angle) * 31 };
  };
  return (
    <div className={`graph ${compact ? "compact" : ""}`}>
      <div className="graph-top">
        <div>
          <span className="graph-eyebrow">RELATIONSHIP MAP</span>
          <h3>ارتباط‌های شما، در یک نگاه</h3>
        </div>
        {!compact && (
          <div className="graph-person-picker">
            <PersonPicker
              value={center}
              onChange={(id) => {
                setCenter(id);
                setPan({ x: 0, y: 0 });
              }}
              label="مرکز نقشه"
            />
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      <div
        className="graph-stage"
        ref={stage}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = {
            kind: "pan",
            x: e.clientX,
            y: e.clientY,
            px: pan.x,
            py: pan.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (d.kind === "pan")
            setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
          else if (stage.current) {
            const box = stage.current.getBoundingClientRect();
            setPositions((prev) => ({
              ...prev,
              [d.id]: {
                x: d.px + (((e.clientX - d.x) / box.width) * 100) / zoom,
                y: d.py + (((e.clientY - d.y) / box.height) * 100) / zoom,
              },
            }));
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (
            d?.kind === "node" &&
            Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6
          )
            onPerson(d.id);
          drag.current = null;
        }}
      >
        <div
          className="graph-transform"
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            className="graph-lines"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={compact ? "compact-arrow" : "network-arrow"}
                markerWidth="2"
                markerHeight="2"
                refX="10"
                refY="5"
                viewBox="0 0 10 10"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill="#8ba0ca" />
              </marker>
            </defs>
            <circle cx="50" cy="48" r="12" className="orbit" />
            <circle cx="50" cy="48" r="21" className="orbit faint" />
            {edges.map((e) => {
              const a = coordinates(e.source),
                b = coordinates(e.target);
              return (
                <polyline
                  key={e.id}
                  markerMid={
                    e.directed
                      ? `url(#${compact ? "compact-arrow" : "network-arrow"})`
                      : undefined
                  }
                  points={`${a.x},${a.y} ${(a.x+b.x)/2},${(a.y+b.y)/2} ${b.x},${b.y}`}
                  fill="none"
                  className={e.kind === "relationship" ? "secondary-edge" : ""}
                />
              );
            })}
          </svg>
          {nodes.map((p) => {
            const xy = coordinates(p.id);
            return (
              <div
                key={p.id}
                className="graph-node-wrap"
                style={{ left: xy.x + "%", top: xy.y + "%" }}
              >
                <button
                  className={`graph-node ${p.is_self ? "me" : ""}`}
                  aria-label={"پروفایل " + p.display_name}
                  onClick={(e) => {
                    if (e.detail === 0) onPerson(p.id);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = {
                      kind: "node",
                      id: p.id,
                      x: e.clientX,
                      y: e.clientY,
                      px: xy.x,
                      py: xy.y,
                    };
                    stage.current?.setPointerCapture(e.pointerId);
                  }}
                >
                  <Avatar p={p} />
                  {!p.is_self && (
                    <span
                      className={
                        "level-badge node-importance level-" +
                        p.importance_level
                      }
                    >
                      {p.importance_level}
                    </span>
                  )}
                  <span className="node-name">
                    {p.is_self ? "شما" : p.display_name}
                  </span>
                  {!compact && (
                    <small>{p.company || "اولویت " + p.importance_level}</small>
                  )}
                </button>
                <button
                  className="branch-toggle"
                  aria-label={
                    (expanded.has(p.id) ? "بستن" : "بازکردن") +
                    " شاخه " +
                    p.display_name
                  }
                  onClick={() => toggle(p.id)}
                >
                  {expanded.has(p.id) ? (
                    <Minus size={11} />
                  ) : (
                    <Plus size={11} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="graph-bottom">
        <div className="graph-legend">
          <span />
          مسیر آشنایی <i />
          رابطه مشترک
        </div>
        <div className="graph-controls">
          <button
            aria-label="بزرگ‌نمایی"
            onClick={() => setZoom((v) => Math.min(v + 0.15, 2))}
          >
            <ZoomIn size={17} />
          </button>
          <button
            aria-label="کوچک‌نمایی"
            onClick={() => setZoom((v) => Math.max(v - 0.15, 0.5))}
          >
            <ZoomOut size={17} />
          </button>
          <button
            aria-label="بازنشانی نقشه"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setPositions({});
              setCenter("");
            }}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
      {!compact && (
        <div className="network-help">
          <Network size={15} />
          <span>
            با + همسایه‌ها را باز کنید. نام هر شخص، پروفایل او را باز می‌کند.
            نقشه و گره‌ها قابل جابه‌جایی‌اند.
          </span>
          {data.truncated && <b>نمایش به ۲۰۰ نفر محدود است.</b>}
        </div>
      )}
    </div>
  );
}
