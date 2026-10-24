import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.ts';
import { createToken, parseToken, allowed } from '../src/modules/auth/session.ts';
test('Mật khẩu có salt, kiểm tra đúng/sai và không chứa plaintext', async () => {
  const a = await hashPassword('12345'),
    b = await hashPassword('12345');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('12345', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(a.includes('12345'), false);
});
test('Token sửa nội dung và cờ thiếu/false đều bị từ chối', () => {
  process.env.SESSION_SECRET = 'test-only-secret-with-at-least-32-characters';
  const token = createToken('U01', 0);
  assert.equal(parseToken(token)?.id, 'U01');
  assert.equal(parseToken(token + 'x'), null);
  const actor = {
    id: 'U01',
    name: 'x',
    email: '',
    role: 'admin' as const,
    active: true,
    createdAt: '',
    flags: { 'users.read': false },
  };
  assert.equal(allowed(actor, 'users'), false);
  assert.equal(allowed(actor, 'users', 'delete'), false);
});
