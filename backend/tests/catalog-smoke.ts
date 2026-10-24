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
try {
  const response = await call('/auth/login', '', { login: 'manager', password: '12345' });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  const tag = crypto.randomUUID().slice(0, 8);
  assert.equal(
    (
      await call('/commands', cookie, {
        type: 'save-material',
        payload: {
          id: '',
          name: `API flour ${tag}`,
          unit: 'kg',
          minStock: 1,
          stock: 0,
          createdAt: '',
        },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await call('/commands', cookie, {
        type: 'save-product',
        payload: {
          id: '',
          name: `API cake ${tag}`,
          unit: 'cái',
          image: '',
          stock: 0,
          createdAt: '',
        },
      })
    ).status,
    204,
  );
  const p = (
    await pool.query('SELECT product_id FROM products WHERE product_name=$1', [`API cake ${tag}`])
  ).rows[0].product_id;
  const m = (
    await pool.query('SELECT material_id FROM materials WHERE material_name=$1', [
      `API flour ${tag}`,
    ])
  ).rows[0].material_id;
  const bom = {
    id: '',
    productId: p,
    version: '1.0',
    active: true,
    createdAt: '',
    lines: [{ materialId: m, quantity: 0.125678 }],
  };
  assert.match(m, /^M0\d+$/);
  assert.match(p, /^B0\d+$/);
  const concurrent = await Promise.all(
    [1, 2, 3].map((n) =>
      call('/commands', cookie, {
        type: 'save-material',
        payload: {
          id: '',
          name: `Concurrent ${tag} ${n}`,
          unit: 'kg',
          minStock: 0.3,
          stock: 0,
          createdAt: '',
        },
      }),
    ),
  );
  assert.deepEqual(
    concurrent.map((r) => r.status),
    [204, 204, 204],
  );
  const codes = (
    await pool.query('SELECT material_id FROM materials WHERE material_name LIKE $1', [
      `Concurrent ${tag}%`,
    ])
  ).rows.map((r) => r.material_id);
  assert.equal(new Set(codes).size, 3);
  codes.forEach((code) => assert.match(code, /^M0\d+$/));
  assert.equal((await call('/commands', cookie, { type: 'save-bom', payload: bom })).status, 204);
  assert.equal((await call('/commands', cookie, { type: 'save-bom', payload: bom })).status, 409);
  assert.equal(
    (await call('/commands', cookie, { type: 'save-bom', payload: { ...bom, version: '2.0' } }))
      .status,
    204,
  );
  const versions = (
    await pool.query('SELECT bom_id,is_active FROM bom WHERE product_id=$1 ORDER BY version_code', [
      p,
    ])
  ).rows;
  assert.equal(versions.length, 2);
  versions.forEach((v) => assert.match(v.bom_id, /^BOM0\d+$/));
  assert.equal(versions[0].is_active, false);
  assert.equal(versions[1].is_active, true);
  assert.equal(
    (
      await call('/commands', cookie, {
        type: 'set-bom-active',
        payload: { id: versions[0].bom_id, active: true },
      })
    ).status,
    204,
  );
  const permission = (
    await pool.query(
      "SELECT permission_id FROM permissions p JOIN modules m USING(module_id) WHERE m.code='bom' AND action='create'",
    )
  ).rows[0].permission_id;
  await pool.query(
    'INSERT INTO user_permissions(user_id,permission_id,is_allowed) VALUES($1,$2,false) ON CONFLICT(user_id,permission_id) DO UPDATE SET is_allowed=false',
    ['U02', permission],
  );
  assert.equal(
    (await call('/commands', cookie, { type: 'save-bom', payload: { ...bom, version: '3.0' } }))
      .status,
    403,
  );
  await pool.query('DELETE FROM user_permissions WHERE user_id=$1 AND permission_id=$2', [
    'U02',
    permission,
  ]);
  console.log(
    'PASS: catalog APIs, 6-decimal BOM, multiple versions, duplicate version, active switch and permission deny',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
