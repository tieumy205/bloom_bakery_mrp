import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../src/server.ts';
import { pool } from '../src/core/db.ts';
if (!process.env.PGDATABASE?.startsWith('bloom_backend_test'))
  throw new Error('Test database required');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const call = (path: string, cookie = '', body?: unknown, key = crypto.randomUUID()) =>
  fetch(root + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie,
      'Content-Type': 'application/json',
      'X-Bloom-Request': '1',
      'Idempotency-Key': key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
async function login(name: string) {
  const r = await call('/auth/login', '', { login: name, password: '12345' });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie()[0].split(';')[0];
}
try {
  const manager = await login('manager'),
    employee = await login('employee');
  const b = (
    await pool.query(
      "SELECT b.* FROM bom b JOIN products p USING(product_id) WHERE p.product_name LIKE 'API cake %' AND b.is_active ORDER BY b.created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.ok(b);
  const tag = crypto.randomUUID().slice(0, 8),
    key = crypto.randomUUID();
  const order = {
    id: '',
    items: [{ productId: b.product_id, bomId: b.bom_id, target: 10, completed: 999 }],
    assignedTo: 'U03',
    dueDate: '2026-12-31',
    note: `Order test ${tag}`,
    createdBy: 'forged',
  };
  const command = { type: 'save-order', payload: order };
  assert.equal((await call('/commands', manager, command, key)).status, 204);
  assert.equal((await call('/commands', manager, command, key)).status, 204);
  const saved = (await pool.query('SELECT * FROM production_orders WHERE note=$1', [order.note]))
    .rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].created_by, 'U02');
  const detail = (
    await pool.query('SELECT * FROM production_order_details WHERE production_order_id=$1', [
      saved[0].production_order_id,
    ])
  ).rows[0];
  assert.equal(detail.bom_id, b.bom_id);
  assert.equal(detail.completed_quantity, 0);
  assert.equal(
    (await call('/commands', employee, { type: 'save-order', payload: order })).status,
    403,
  );
  const other = (
    await pool.query('SELECT bom_id FROM bom WHERE product_id=$1 AND bom_id<>$2', [
      b.product_id,
      b.bom_id,
    ])
  ).rows[0];
  assert.ok(other);
  assert.equal(
    (
      await call('/commands', manager, {
        type: 'set-bom-active',
        payload: { id: other.bom_id, active: true },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await pool.query('SELECT bom_id FROM production_order_details WHERE production_order_id=$1', [
        saved[0].production_order_id,
      ])
    ).rows[0].bom_id,
    b.bom_id,
  );
  assert.equal((await call('/commands', manager, command)).status, 422);
  const snapshot = (await (await call('/snapshot', employee)).json()) as {
    orders: { id: string; assignedTo: string }[];
  };
  assert.ok(snapshot.orders.every((o) => o.assignedTo === 'U03'));
  const empty = await call('/commands', manager, {
    type: 'save-order',
    payload: { ...order, items: [] },
  });
  assert.equal(empty.status, 422);
  console.log(
    'PASS: pinned BOM, active switch, inactive selection rejected, idempotency, server-owned identity/progress and employee scope',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
