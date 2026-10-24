import type { Db } from '../../core/db.ts';
import type { Actor } from '../auth/session.ts';
import { requirePermission } from '../auth/session.ts';
import { date, text } from '../../core/validation.ts';
import { ensure } from '../../core/errors.ts';
export async function report(db: Db, actor: Actor, params: URLSearchParams) {
  requirePermission(actor, 'reports');
  const mode = params.get('mode') || 'in-out',
    group = params.get('group') || 'day';
  ensure(
    ['in-out', 'material-use', 'product-out', 'stock'].includes(mode) &&
      ['day', 'month', 'quarter', 'year'].includes(group) &&
      !(mode === 'stock' && group === 'quarter'),
    'Loại báo cáo hoặc nhóm thời gian không hợp lệ.',
  );
  const from = date(params.get('from'), 'Từ ngày'),
    to = date(params.get('to'), 'Đến ngày'),
    key = text(params.get('item'), 'Mặt hàng', 20);
  ensure(
    from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 3659,
    'Khoảng báo cáo tối đa 10 năm.',
  );
  const product =
      mode === 'product-out' || (mode === 'in-out' && params.get('warehouse') === 'product'),
    table = product ? 'product_transactions' : 'material_transactions',
    catalog = product ? 'products' : 'materials',
    column = product ? 'product_id' : 'material_id',
    name = product ? 'product_name' : 'material_name';
  const item = (
    await db.query(
      `SELECT c.${column} AS id,c.${name} AS name,u.symbol AS unit FROM ${catalog} c JOIN units u USING(unit_id) WHERE c.${column}=$1`,
      [key],
    )
  ).rows[0];
  ensure(item, 'Mặt hàng không tồn tại.', 404);
  const result = await db.query(
    `WITH days AS (SELECT generate_series($1::date,$2::date,interval '1 day')::date AS day), periods AS (SELECT date_trunc($3,day)::date AS period,min(day) AS start,max(day) AS cutoff FROM days GROUP BY 1), tx AS (SELECT business_date,quantity_change FROM ${table} WHERE ${column}=$4), opening AS (SELECT stock_quantity-coalesce((SELECT sum(quantity_change) FROM tx),0) AS value FROM ${catalog} WHERE ${column}=$4) SELECT p.period,p.cutoff,coalesce((SELECT sum(quantity_change) FROM tx WHERE quantity_change>0 AND business_date BETWEEN p.start AND p.cutoff),0) AS incoming,coalesce((SELECT -sum(quantity_change) FROM tx WHERE quantity_change<0 AND business_date BETWEEN p.start AND p.cutoff),0) AS outgoing,(SELECT value FROM opening)+coalesce((SELECT sum(quantity_change) FROM tx WHERE business_date<=p.cutoff),0) AS stock FROM periods p ORDER BY p.period`,
    [from, to, group, key],
  );
  const points = result.rows.map((r) => {
    const day = r.period as string;
    const period =
      group === 'year'
        ? day.slice(0, 4)
        : group === 'quarter'
          ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`
          : group === 'month'
            ? day.slice(0, 7)
            : day;
    const label =
      group === 'day'
        ? `${day.slice(8, 10)}/${day.slice(5, 7)}`
        : group === 'month'
          ? `${day.slice(5, 7)}/${day.slice(0, 4)}`
          : group === 'quarter'
            ? `Q${period.slice(-1)}/${day.slice(0, 4)}`
            : period;
    return {
      key: period,
      label,
      cutoff: r.cutoff,
      incoming: Number(r.incoming),
      outgoing: Number(r.outgoing),
      stock: Number(r.stock),
    };
  });
  return { item, points };
}
