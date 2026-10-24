import pg from 'pg';
import type { PoolClient } from 'pg';
export const pool = new pg.Pool({
  max: 10,
  connectionTimeoutMillis: 5000,
  options: '-c search_path=bakery_mrp,public -c timezone=Asia/Ho_Chi_Minh',
});
pg.types.setTypeParser(1082, (value) => value);
export type Db = PoolClient;
export async function transaction<T>(work: (db: Db) => Promise<T>, readOnly = false): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function one<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query(sql, values)).rows[0] as T | undefined;
}
export const id = (prefix: string) => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 16);

const codeTables: Record<string, [string, string]> = {
  PO: ['production_orders', 'production_order_id'],
  M: ['materials', 'material_id'],
  B: ['products', 'product_id'],
  BOM: ['bom', 'bom_id'],
  MR: ['material_replenishment_requests', 'material_replenishment_request_id'],
  RN: ['material_receipt_notes', 'material_receipt_note_id'],
  MI: ['material_issue_requests', 'material_issue_request_id'],
  PI: ['product_issue_requests', 'product_issue_request_id'],
};
export async function nextCode(db: Db, prefix: string) {
  const pair = codeTables[prefix];
  if (!pair) throw new Error('Unsupported code prefix');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`code:${prefix}`]);
  const result = await db.query(
    `SELECT coalesce(max(substring(code from $1)::numeric),0)+1 AS next
     FROM (SELECT ${pair[1]} AS code FROM ${pair[0]}
       UNION SELECT object_id AS code FROM business_events WHERE object_type=$3) codes
     WHERE code ~ $2`,
    [`^${prefix}([0-9]+)$`, `^${prefix}[0-9]{1,12}$`, pair[0]],
  );
  return prefix + '0' + String(result.rows[0].next);
}
