import type { Database } from '../../shared/domain/types';
import { rounded } from '../../shared/domain/rules';

export type ReportMode = 'in-out' | 'material-use' | 'product-out' | 'stock';
export type Grouping = 'day' | 'month' | 'quarter' | 'year';
export interface ReportPoint {
  key: string;
  label: string;
  incoming: number;
  outgoing: number;
  stock: number;
  cutoff: string;
}
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function periodKey(day: string, grouping: Grouping) {
  return grouping === 'year'
    ? day.slice(0, 4)
    : grouping === 'quarter'
      ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`
      : grouping === 'month'
        ? day.slice(0, 7)
        : day;
}
function labelFor(key: string, grouping: Grouping) {
  return grouping === 'day'
    ? `${key.slice(8, 10)}/${key.slice(5, 7)}`
    : grouping === 'month'
      ? `${key.slice(5, 7)}/${key.slice(0, 4)}`
      : grouping === 'quarter'
        ? `Q${key.slice(-1)}/${key.slice(0, 4)}`
        : key;
}
export function aggregateReport(
  db: Database,
  itemId: string,
  from: string,
  to: string,
  grouping: Grouping,
): ReportPoint[] {
  if (
    !validDay(from) ||
    !validDay(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 3659
  )
    return [];
  const points = new Map<string, ReportPoint>();
  const cursor = new Date(`${from}T00:00:00Z`);
  let guard = 0;
  while (cursor.toISOString().slice(0, 10) <= to && guard++ < 3660) {
    const day = cursor.toISOString().slice(0, 10),
      key = periodKey(day, grouping);
    if (!points.has(key))
      points.set(key, {
        key,
        label: labelFor(key, grouping),
        incoming: 0,
        outgoing: 0,
        stock: 0,
        cutoff: day,
      });
    points.get(key)!.cutoff = day;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const movements = db.movements.filter((m) => m.itemId === itemId);
  for (const movement of movements.filter((m) => m.date >= from && m.date <= to)) {
    const point = points.get(periodKey(movement.date, grouping));
    if (point) {
      if (movement.delta > 0) point.incoming += movement.delta;
      else point.outgoing -= movement.delta;
    }
  }
  return [...points.values()].map((point) => ({
    ...point,
    incoming: rounded(point.incoming),
    outgoing: rounded(point.outgoing),
    stock: rounded(
      (db.openingStock[itemId] || 0) +
        movements.filter((m) => m.date <= point.cutoff).reduce((sum, m) => sum + m.delta, 0),
    ),
  }));
}
