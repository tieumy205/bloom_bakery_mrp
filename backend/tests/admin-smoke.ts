import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../src/server.ts';
import { pool } from '../src/core/db.ts';
if (!process.env.PGDATABASE?.startsWith('bloom_backend_test'))
  throw new Error('Test database required');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const call = (path: string, cookie = '', body?: unknown) =>
  fetch(root + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie,
      'Content-Type': 'application/json',
      'X-Bloom-Request': '1',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
async function login(login: string, password: string) {
  const response = await call('/auth/login', '', { login, password });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0].split(';')[0];
}
try {
  await pool.query("DELETE FROM users WHERE email='permission-admin@example.invalid'");
  const admin = await login('admin', '12345');
  const make = {
    id: '',
    name: 'Permission test administrator',
    email: 'permission-admin@example.invalid',
    role: 'admin',
    active: true,
    createdAt: '',
    password: 'ChosenPassword1',
  };
  assert.equal((await call('/commands', admin, { type: 'save-user', payload: make })).status, 204);
  const row = (await pool.query('SELECT user_id,username FROM users WHERE email=$1', [make.email]))
    .rows[0];
  const target = await login(row.username, 'ChosenPassword1');
  const data = (await (await call('/permissions', admin)).json()) as {
    permissions: { id: string; module: string; action: string }[];
    users: { id: string; flags: Record<string, boolean> }[];
  };
  const flags = { ...data.users.find((u) => u.id === row.user_id)!.flags };
  const create = data.permissions.find((p) => p.module === 'users' && p.action === 'create')!.id;
  flags[create] = false;
  assert.equal((await call('/permissions', admin, { userIds: [row.user_id], flags })).status, 204);
  const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert.equal(
    (
      await call('/commands', target, {
        type: 'save-user',
        payload: { ...make, email: 'should-not-exist@example.invalid', role: 'employee' },
      })
    ).status,
    403,
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, before);
  assert.equal(
    (
      await pool.query("SELECT bakery_mrp.has_permission($1,'users','create') AS allowed", [
        row.user_id,
      ])
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (await call('/permissions', target, { userIds: [row.user_id], flags: {} })).status,
    422,
  );
  const current = (await (await call('/snapshot', admin)).json()) as {
    users: Record<string, unknown>[];
  };
  const user = current.users.find((u) => u.id === row.user_id)!;
  assert.equal('password_hash' in user, false);
  assert.equal('password' in user, false);
  assert.equal(
    (
      await call('/commands', admin, {
        type: 'save-user',
        payload: { ...user, password: 'ChangedPassword2' },
      })
    ).status,
    204,
  );
  assert.equal((await call('/auth/me', target)).status, 401);
  await login(row.username, 'ChangedPassword2');
  await call('/commands', admin, { type: 'save-user', payload: { ...user, active: false } });
  const locked = await call('/auth/login', '', {
    login: row.username,
    password: 'ChangedPassword2',
  });
  assert.equal(locked.status, 401);
  assert.equal(((await locked.json()) as { message: string }).message, 'Tài khoản không tồn tại');
  assert.equal(
    (await call('/commands', admin, { type: 'delete-user', payload: row.user_id })).status,
    204,
  );
  const employee = await login('employee', '12345');
  assert.equal((await call('/permissions', employee)).status, 403);
  console.log(
    'PASS: admin-created password, checkbox deny, direct API 403, no side effects, DB permission parity, self-lock protection, password change/session revocation and delete',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
