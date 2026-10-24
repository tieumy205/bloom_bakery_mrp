import { describe, expect, it } from 'vitest';
import { createSeed } from '../../mocks/fixtures';
import { aggregateReport, periodKey } from './model';
import { today } from '../../shared/domain/format';

describe('Báo cáo thời gian', () => {
  it('Các chứng từ đã ghi sổ trong dữ liệu mẫu có đóng góp vào báo cáo', () => {
    const db = createSeed();
    expect(aggregateReport(db, 'NVL001', today(), today(), 'day')[0].outgoing).toBe(7);
    expect(aggregateReport(db, 'TP002', today(), today(), 'day')[0].incoming).toBe(145);
    expect(Object.values(db.openingStock).every((stock) => stock >= 0)).toBe(true);
  });
  it('Bộ lọc URL sai ngày hoặc quá dài không làm sập trang', () => {
    const db = createSeed();
    expect(aggregateReport(db, 'NVL001', 'invalid', today(), 'day')).toEqual([]);
    expect(aggregateReport(db, 'NVL001', '2026-02-31', today(), 'day')).toEqual([]);
    expect(aggregateReport(db, 'NVL001', '2000-01-01', today(), 'day')).toEqual([]);
  });
  it('Tồn cuối kỳ khớp tồn hiện tại và không cộng khác vật tư/đơn vị', () => {
    const db = createSeed();
    const points = aggregateReport(db, 'NVL001', '2026-01-01', today(), 'month');
    expect(points.at(-1)?.stock).toBe(db.materials[0].stock);
    expect(points.reduce((s, p) => s + p.incoming, 0)).toBe(
      db.movements
        .filter((m) => m.itemId === 'NVL001' && m.delta > 0)
        .reduce((s, m) => s + m.delta, 0),
    );
  });
  it('Tồn tại ngày chỉ định không lấy tồn hiện tại làm tồn quá khứ', () => {
    const db = createSeed();
    const first = db.movements[0].date;
    const point = aggregateReport(db, 'NVL001', first, first, 'day')[0];
    const expected =
      db.openingStock.NVL001 +
      db.movements
        .filter((m) => m.itemId === 'NVL001' && m.date <= first)
        .reduce((s, m) => s + m.delta, 0);
    expect(point.stock).toBeCloseTo(expected);
    expect(point.stock).not.toBe(db.materials[0].stock);
  });
  it('Quý và năm chuyển kỳ đúng', () => {
    expect(periodKey('2026-03-31', 'quarter')).toBe('2026-Q1');
    expect(periodKey('2026-04-01', 'quarter')).toBe('2026-Q2');
    expect(periodKey('2027-01-01', 'year')).toBe('2027');
  });
});
