import { ensure } from './errors.ts';
export function text(value: unknown, label: string, max = 100, optional = false): string {
  ensure(
    typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0),
    `${label} không hợp lệ.`,
  );
  return value.trim();
}
export function quantity(
  value: unknown,
  label = 'Số lượng',
  zero = false,
  integer = false,
): number {
  ensure(
    typeof value === 'number' &&
      Number.isFinite(value) &&
      (zero ? value >= 0 : value > 0) &&
      value <= 9999999999.999999 &&
      (!integer || Number.isSafeInteger(value)),
    `${label} không hợp lệ.`,
  );
  return Math.round(value * 1e6) / 1e6;
}
export function date(value: unknown, label = 'Ngày'): string {
  const result = text(value, label, 10),
    time = new Date(`${result}T00:00:00Z`);
  ensure(
    /^\d{4}-\d{2}-\d{2}$/.test(result) &&
      Number.isFinite(time.getTime()) &&
      time.toISOString().slice(0, 10) === result,
    `${label} không hợp lệ.`,
  );
  return result;
}
export function lines<T>(items: T[], key: (item: T) => string) {
  ensure(
    Array.isArray(items) && items.length > 0 && items.length <= 200,
    'Cần từ 1 đến 200 dòng chi tiết.',
  );
  const keys = items.map(key);
  ensure(
    keys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 20) &&
      new Set(keys).size === keys.length,
    'Mã vật tư trống hoặc trùng dòng.',
  );
}
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
