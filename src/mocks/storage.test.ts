import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDatabase, writeDatabase } from './storage';

describe('Mock persistence', () => {
  beforeEach(() => {
    const cache = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => cache.get(key) ?? null,
      setItem: (key: string, value: string) => cache.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('Đọc lại phiên bản lưu mới nhất, không giữ snapshot cũ sau khi nguồn khác cập nhật', () => {
    const db = readDatabase();
    writeDatabase(db);
    const next = structuredClone(db);
    next.orders[0].status = 'in_progress';
    localStorage.setItem('bloom-mrp-v1', JSON.stringify(next));
    expect(readDatabase().orders[0].status).toBe('in_progress');
  });
  it('Không báo lưu thành công khi bộ nhớ trình duyệt đầy', () => {
    const db = readDatabase();
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError');
      },
    });
    expect(() => writeDatabase(db)).toThrow('đã đầy');
  });
});
