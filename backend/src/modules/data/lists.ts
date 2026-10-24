import type { Db } from '../../core/db.ts';
import type { Actor } from '../auth/session.ts';
import { requirePermission } from '../auth/session.ts';
import { ensure } from '../../core/errors.ts';
import { date } from '../../core/validation.ts';
import { documents, snapshot } from './snapshot.ts';
const lists = {
  materials: { table: 'materials', key: 'material_id', name: 'material_name', status: null },
  products: { table: 'products', key: 'product_id', name: 'product_name', status: null },
  boms: { table: 'bom', key: 'bom_id', name: 'version_code', status: null },
  orders: {
    table: 'production_orders',
    key: 'production_order_id',
    name: 'note',
    status: 'status',
  },
  ...Object.fromEntries(
    Object.entries(documents).map(([kind, m]) => [
      kind,
      { table: m.table, key: m.key, name: 'note', status: 'status' },
    ]),
  ),
} as Record<string, { table: string; key: string; name: string; status: string | null }>;
export async function list(db: Db, actor: Actor, module: string, params: URLSearchParams) {
  requirePermission(actor, module);
  ensure(Object.hasOwn(lists, module), 'Danh sách không tồn tại.', 404);
  const meta = lists[module];
  const page = Number(params.get('page') || 1),
    size = Number(params.get('size') || 10);
  ensure(
    Number.isInteger(page) &&
      page > 0 &&
      page <= 100000 &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= 100,
    'Phân trang không hợp lệ.',
  );
  const values: unknown[] = [],
    where: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (actor.role === 'employee' && module === 'orders') where.push(`assigned_to=${bind(actor.id)}`);
  if (actor.role === 'employee' && Object.hasOwn(documents, module))
    where.push(`created_by=${bind(actor.id)}`);
  const search = params.get('q');
  if (search) {
    ensure(search.length <= 100, 'Từ khóa quá dài.');
    const key = bind(`%${search}%`);
    where.push(`(${meta.key} ILIKE ${key} OR ${meta.name} ILIKE ${key})`);
  }
  if (params.get('status') && meta.status)
    where.push(`${meta.status}=${bind(params.get('status'))}`);
  if (!['materials', 'products', 'boms'].includes(module)) {
    if (params.get('from')) where.push(`created_at>=${bind(date(params.get('from')))}::date`);
    if (params.get('to'))
      where.push(`created_at<${bind(date(params.get('to')))}::date+interval '1 day'`);
  }
  const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = Number(
    (await db.query(`SELECT count(*) FROM ${meta.table}${condition}`, values)).rows[0].count,
  );
  const sorting = {
    id: meta.key,
    name: meta.name,
    createdAt: 'created_at',
    ...(meta.status ? { status: meta.status } : {}),
  } as Record<string, string>;
  const sort = sorting[params.get('sort') || 'createdAt'] || meta.key,
    direction = params.get('direction') === 'asc' ? 'ASC' : 'DESC';
  const limit = bind(size),
    offset = bind((page - 1) * size);
  const ids = (
    await db.query(
      `SELECT ${meta.key} AS id FROM ${meta.table}${condition} ORDER BY ${sort} ${direction} NULLS LAST,${meta.key} ASC LIMIT ${limit} OFFSET ${offset}`,
      values,
    )
  ).rows;
  const data = await snapshot(db, actor);
  const collection = Object.hasOwn(documents, module)
    ? data.documents.filter((d) => d.kind === module)
    : data[module as 'materials' | 'products' | 'boms' | 'orders'];
  return {
    rows: ids.map((r) => collection.find((row) => row.id === r.id)).filter(Boolean),
    total,
    page,
    size,
  };
}
