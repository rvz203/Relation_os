import pg, { type PoolClient, type QueryResultRow } from "pg";
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));
const globalDb = globalThis as unknown as { pgPool?: pg.Pool };
export const pool =
  globalDb.pgPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalDb.pgPool = pool;
export type DB = Pick<PoolClient, "query">;
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: DB = pool,
) {
  return (await db.query<T>(sql, params)).rows;
}
export async function transaction<T>(work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function lockOwner(db: DB, userId: string) {
  await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
}
