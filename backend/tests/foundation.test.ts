import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, translateError } from '../src/core/errors.ts';
test('Không đưa lỗi SQL nội bộ hoặc thông tin nhạy cảm ra HTTP', () => {
  assert.equal(
    translateError(new Error('private connection details')).message.includes('private'),
    false,
  );
  assert.equal(translateError({ code: '23505' }).status, 409);
  assert.equal(translateError({ code: '40P01' }).status, 409);
  assert.equal(translateError(new HttpError(403, 'Không có quyền')).status, 403);
});

test('Mất kết nối database trả 503 với thông báo rõ ràng và không lộ địa chỉ nội bộ', () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P03']) {
    const result = translateError({ code, message: 'private host and credentials' });
    assert.equal(result.status, 503);
    assert.equal(result.code, 'DATABASE_UNAVAILABLE');
    assert.match(result.message, /PostgreSQL/);
    assert.equal(result.message.includes('private'), false);
  }
});
