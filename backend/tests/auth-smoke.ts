import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../src/server.ts';
import { pool } from '../src/core/db.ts';
if (!process.env.PGDATABASE?.startsWith('bloom_backend_test'))
  throw new Error('Test database required');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as { port: number }).port;
try {
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  const missing = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
  assert.equal(missing.status, 401);
  for (const id of ['U01', 'U02', 'U03']) {
    const login = (await pool.query('SELECT username FROM users WHERE user_id=$1', [id])).rows[0]
      .username;
    const bad = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bloom-Request': '1' },
      body: JSON.stringify({ login, password: 'wrong' }),
    });
    assert.equal(bad.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bloom-Request': '1' },
      body: JSON.stringify({ login, password: '12345' }),
    });
    assert.equal(response.status, 200);
    const user = (await response.json()) as { id: string };
    assert.equal(user.id, id);
    assert.equal('password_hash' in user, false);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal(response.headers.getSetCookie()[0].includes('HttpOnly'), true);
    const current = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } });
    assert.equal(current.status, 200);
    const logout = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'X-Bloom-Request': '1' },
    });
    assert.equal(logout.status, 204);
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } })).status,
      401,
    );
  }
  console.log(
    'PASS: health, 3 default accounts, wrong password, HttpOnly cookie, logout/session revocation',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
