import { fail, uuid } from "./core";
import { query } from "@/db";
export async function boundedBody(req: Request, limit = 262144) {
  if (Number(req.headers.get("content-length") ?? 0) > limit)
    fail("درخواست بیش از حد بزرگ است.", 413);
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        fail("درخواست بیش از حد بزرگ است.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req: Request) {
  try {
    return JSON.parse((await boundedBody(req)).toString());
  } catch (error) {
    if (error instanceof SyntaxError)
      fail("بدنه JSON معتبر نیست.", 400, "INVALID_JSON");
    throw error;
  }
}
export async function formBody(req: Request) {
  return new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: await boundedBody(req, 6 * 1024 * 1024),
  }).formData();
}
export function pagination(params: URLSearchParams) {
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.get("limit")) || 30)),
  );
  return { limit, cursor: params.get("cursor") };
}
export function pageArray(
  items: Record<string, any>[],
  params: URLSearchParams,
) {
  const { limit, cursor } = pagination(params);
  if (cursor) uuid.parse(cursor);
  const rows = items
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((r) => !cursor || r.id > cursor);
  return {
    items: rows.slice(0, limit),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function pageQuery(
  sql: string,
  values: unknown[],
  params: URLSearchParams,
  map: (r: Record<string, any>) => any = (r) => r,
  recent = false,
) {
  const { limit, cursor } = pagination(params),
    i = values.length + 1;
  let rows;
  if (recent) {
    let point: { time: string; id: string } | null = null;
    if (cursor) {
      try {
        point = JSON.parse(Buffer.from(cursor, "base64url").toString());
        uuid.parse(point?.id);
        if (!point?.time || !Number.isFinite(Date.parse(point.time)))
          throw new Error();
      } catch {
        fail("نشانگر صفحه معتبر نیست.");
      }
    }
    rows = await query(
      `SELECT t.*,t.created_at::text _cursor_time FROM (${sql}) t WHERE ($${i}::timestamptz IS NULL OR (t.created_at,t.id)<($${i},$${i + 1}::uuid)) ORDER BY t.created_at DESC,t.id DESC LIMIT $${i + 2}`,
      [...values, point?.time ?? null, point?.id ?? null, limit + 1],
    );
  } else {
    if (cursor) uuid.parse(cursor);
    rows = await query(
      `SELECT * FROM (${sql}) t WHERE ($${i}::uuid IS NULL OR t.id>$${i}) ORDER BY t.id LIMIT $${i + 1}`,
      [...values, cursor, limit + 1],
    );
  }
  const last = rows[limit - 1];
  return {
    items: rows.slice(0, limit).map(({ _cursor_time, ...r }) => map(r)),
    next_cursor:
      rows.length > limit
        ? recent
          ? Buffer.from(
              JSON.stringify({ time: last._cursor_time, id: last.id }),
            ).toString("base64url")
          : last.id
        : null,
  };
}
