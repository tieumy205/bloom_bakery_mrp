import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../src/server.ts';
import { pool } from '../src/core/db.ts';
import { today } from '../src/core/validation.ts';
if (!process.env.PGDATABASE?.startsWith('bloom_backend_test'))
  throw new Error('Test database required');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
async function login(name: string) {
  const r = await fetch(root + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bloom-Request': '1' },
    body: JSON.stringify({ login: name, password: '12345' }),
  });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie()[0].split(';')[0];
}
try {
  const manager = await login('manager'),
    employee = await login('employee');
  const item = (
    await pool.query(
      "SELECT material_id FROM materials WHERE material_name LIKE 'WF flour %' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0].material_id;
  for (const group of ['day', 'month', 'quarter', 'year']) {
    const r = await fetch(
      `${root}/reports?${new URLSearchParams({ item, from: today(), to: today(), group, mode: 'material-use' })}`,
      { headers: { cookie: manager } },
    );
    assert.equal(r.status, 200);
    const data = (await r.json()) as {
      points: { incoming: number; outgoing: number; stock: number }[];
    };
    assert.equal(data.points.length, 1);
    assert.equal(data.points[0].incoming, 12);
    assert.equal(data.points[0].outgoing, 10);
    assert.equal(data.points[0].stock, 2);
  }
  const query = new URLSearchParams({
    item,
    from: today(),
    to: today(),
    group: 'day',
    mode: 'stock',
  });
  assert.equal(
    (await fetch(`${root}/reports?${query}`, { headers: { cookie: employee } })).status,
    403,
  );
  const badGroup = new URLSearchParams(query);
  badGroup.set('group', 'bad');
  assert.equal(
    (await fetch(`${root}/reports?${badGroup}`, { headers: { cookie: manager } })).status,
    422,
  );
  const invalid = new URLSearchParams(query);
  invalid.set('from', 'not-a-date');
  assert.equal(
    (await fetch(`${root}/reports?${invalid}`, { headers: { cookie: manager } })).status,
    422,
  );
  const list = await fetch(`${root}/lists/orders?page=1&size=2&sort=id&direction=asc`, {
    headers: { cookie: employee },
  });
  assert.equal(list.status, 200);
  const rows = (await list.json()) as { rows: { assignedTo: string }[] };
  assert.ok(rows.rows.length <= 2 && rows.rows.every((o) => o.assignedTo === 'U03'));
  const permission = (
    await pool.query(
      "SELECT p.permission_id FROM permissions p JOIN modules m USING(module_id) WHERE m.code='statistics' AND p.action='read'",
    )
  ).rows[0].permission_id;
  await pool.query(
    'INSERT INTO user_permissions(user_id,permission_id,is_allowed) VALUES($1,$2,false) ON CONFLICT(user_id,permission_id) DO UPDATE SET is_allowed=false',
    ['U02', permission],
  );
  assert.equal(
    (await fetch(`${root}/reports?${query}`, { headers: { cookie: manager } })).status,
    403,
  );
  const snap = (await (
    await fetch(root + '/snapshot', { headers: { cookie: manager } })
  ).json()) as { movements: unknown[] };
  assert.equal(snap.movements.length, 0);
  await pool.query('DELETE FROM user_permissions WHERE user_id=$1 AND permission_id=$2', [
    'U02',
    permission,
  ]);
  console.log(
    'PASS: SQL reports day/month/quarter/year, ledger reconciliation, invalid date, scoped pagination and immediate permission revocation',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
