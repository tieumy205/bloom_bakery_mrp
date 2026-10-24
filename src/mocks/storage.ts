import type { Database } from '../shared/domain/types';
import { createSeed } from './fixtures';

const KEY = 'bloom-mrp-v1';
let memory: Database | undefined;
export function readDatabase(): Database {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) memory = JSON.parse(saved) as Database;
  } catch {
    /* Storage unavailable; use memory. */
  }
  if (!memory) {
    memory = createSeed();
  }
  // Seed is persisted on the first read, so creating a fresh demo session has stable timestamps.
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* Memory-only mode. */
  }
  return structuredClone(memory);
}
export function writeDatabase(db: Database) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new Error(
        'Bộ nhớ trình duyệt đã đầy. Vui lòng giảm kích thước ảnh thành phẩm trước khi lưu.',
      );
    // A browser that blocks storage can still use a temporary in-memory demo session.
  }
  memory = structuredClone(db);
}
