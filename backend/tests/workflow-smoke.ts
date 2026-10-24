import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../src/server.ts';
import { pool, transaction } from '../src/core/db.ts';
import { today } from '../src/core/validation.ts';
if (!process.env.PGDATABASE?.startsWith('bloom_backend_test'))
  throw new Error('Test database required');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
let checks = 0;
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
  const response = await call('/auth/login', '', { login: name, password: '12345' });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0].split(';')[0];
}
async function command(
  cookie: string,
  type: string,
  payload: unknown,
  status = 204,
  key = crypto.randomUUID(),
) {
  const r = await call('/commands', cookie, { type, payload }, key);
  checks++;
  assert.equal(r.status, status, `${type}: ${await r.text()}`);
}
const select = async (sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows[0];
const tag = crypto.randomUUID().slice(0, 8);
try {
  const manager = await login('manager'),
    employee = await login('employee');
  const material = { id: '', name: '', unit: 'kg', stock: 0, minStock: 10, createdAt: '' };
  await command(manager, 'save-material', { ...material, name: `WF flour ${tag}` });
  await command(manager, 'save-material', { ...material, name: `WF butter ${tag}`, minStock: 2 });
  const flour = (
      await select('SELECT material_id AS id FROM materials WHERE material_name=$1', [
        `WF flour ${tag}`,
      ])
    ).id,
    butter = (
      await select('SELECT material_id AS id FROM materials WHERE material_name=$1', [
        `WF butter ${tag}`,
      ])
    ).id;
  const product = { id: '', name: '', unit: 'cái', stock: 0, image: '', createdAt: '' };
  await command(manager, 'save-product', { ...product, name: `WF cake ${tag}` });
  await command(manager, 'save-product', { ...product, name: `WF bun ${tag}` });
  const cake = (
      await select('SELECT product_id AS id FROM products WHERE product_name=$1', [
        `WF cake ${tag}`,
      ])
    ).id,
    bun = (
      await select('SELECT product_id AS id FROM products WHERE product_name=$1', [`WF bun ${tag}`])
    ).id;
  await command(manager, 'save-bom', {
    id: '',
    productId: cake,
    version: '1.0',
    active: true,
    createdAt: '',
    lines: [
      { materialId: flour, quantity: 0.8 },
      { materialId: butter, quantity: 0.2 },
    ],
  });
  await command(manager, 'save-bom', {
    id: '',
    productId: bun,
    version: '1.0',
    active: true,
    createdAt: '',
    lines: [{ materialId: flour, quantity: 0.2 }],
  });
  const cakeBom = (
      await select('SELECT bom_id AS id FROM bom WHERE product_id=$1 AND is_active', [cake])
    ).id,
    bunBom = (await select('SELECT bom_id AS id FROM bom WHERE product_id=$1 AND is_active', [bun]))
      .id;
  await command(manager, 'save-order', {
    id: '',
    items: [
      { productId: cake, bomId: cakeBom, target: 10 },
      { productId: bun, bomId: bunBom, target: 10 },
    ],
    assignedTo: 'U03',
    dueDate: today(),
    note: `WF order ${tag}`,
  });
  const po = (
    await select('SELECT production_order_id AS id FROM production_orders WHERE note=$1', [
      `WF order ${tag}`,
    ])
  ).id;
  const base = {
    id: '',
    kind: 'requests',
    orderId: po,
    source: 'order',
    createdBy: 'forged',
    createdAt: '',
    note: `WF MR ${tag}`,
    supplier: '',
    receiptDate: '',
    lines: [
      { itemId: flour, quantity: 10 },
      { itemId: butter, quantity: 2 },
    ],
    timeline: [],
  };
  await command(employee, 'save-document', base);
  const mr = (
    await select(
      'SELECT material_replenishment_request_id AS id FROM material_replenishment_requests WHERE note=$1',
      [base.note],
    )
  ).id;
  await command(employee, 'document-action', { id: mr, action: 'approve' }, 403);
  await command(manager, 'document-action', { id: mr, action: 'reject', reason: '' }, 422);
  await command(manager, 'document-action', { id: mr, action: 'approve' });
  const receipt = {
    ...base,
    kind: 'receipts',
    requestId: mr,
    note: `WF RN ${tag}`,
    supplier: `WF supplier ${tag}`,
    receiptDate: today(),
    lines: [
      { itemId: flour, quantity: 12 },
      { itemId: butter, quantity: 3 },
    ],
  };
  await command(
    manager,
    'save-document',
    {
      ...receipt,
      lines: [
        { itemId: flour, quantity: 9 },
        { itemId: butter, quantity: 2 },
      ],
    },
    422,
  );
  await command(manager, 'save-document', { ...receipt, receiptDate: '2099-01-01' }, 422);
  await command(manager, 'save-document', receipt);
  const rn = (
    await select(
      'SELECT material_receipt_note_id AS id FROM material_receipt_notes WHERE note=$1',
      [receipt.note],
    )
  ).id;
  await command(manager, 'save-document', receipt, 409);
  await command(manager, 'document-action', { id: rn, action: 'complete' }, 409);
  await command(manager, 'document-action', { id: rn, action: 'submit' });
  await command(manager, 'save-document', { ...receipt, id: rn, receiptDate: '2020-01-01' }, 409);
  await command(manager, 'document-action', { id: rn, action: 'complete' });
  assert.equal(
    Number(
      (await select('SELECT stock_quantity FROM materials WHERE material_id=$1', [flour]))
        .stock_quantity,
    ),
    12,
  );
  assert.equal(
    (
      await select(
        'SELECT status FROM material_replenishment_requests WHERE material_replenishment_request_id=$1',
        [mr],
      )
    ).status,
    'fulfilled',
  );
  const issue = { ...base, kind: 'material-issues', note: `WF MI ${tag}` };
  assert.match(po, /^PO0\d+$/);
  assert.match(mr, /^MR0\d+$/);
  assert.match(rn, /^RN0\d+$/);
  await command(
    employee,
    'save-document',
    { ...base, note: 'Must reject replenishment with sufficient stock' },
    422,
  );
  await command(
    employee,
    'save-document',
    {
      ...issue,
      lines: [
        { itemId: flour, quantity: 6 },
        { itemId: butter, quantity: 2 },
      ],
    },
    422,
  );
  const responses = await Promise.all([
    call('/commands', employee, { type: 'save-document', payload: issue }),
    call('/commands', employee, { type: 'save-document', payload: issue }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [204, 409]);
  checks += 2;
  const mi = (
    await select(
      'SELECT material_issue_request_id AS id FROM material_issue_requests WHERE note=$1',
      [issue.note],
    )
  ).id;
  await command(employee, 'order-action', { id: po, action: 'start' }, 422);
  await assert.rejects(
    transaction(async (db) => {
      await db.query(
        "UPDATE material_issue_requests SET status='approved',approved_by='U02' WHERE material_issue_request_id=$1",
        [mi],
      );
      throw new Error('Simulated event failure');
    }),
    /Simulated event failure/,
  );
  assert.equal(
    Number(
      (await select('SELECT stock_quantity FROM materials WHERE material_id=$1', [flour]))
        .stock_quantity,
    ),
    12,
  );
  assert.equal(
    (
      await select(
        'SELECT status FROM material_issue_requests WHERE material_issue_request_id=$1',
        [mi],
      )
    ).status,
    'pending',
  );
  assert.equal(
    (await select('SELECT count(*)::int AS n FROM material_transactions WHERE record_id=$1', [mi]))
      .n,
    0,
  );
  const approveKey = crypto.randomUUID();
  await command(manager, 'document-action', { id: mi, action: 'approve' }, 204, approveKey);
  await command(manager, 'document-action', { id: mi, action: 'approve' }, 204, approveKey);
  await command(manager, 'document-action', { id: mi, action: 'approve' }, 409);
  await command(employee, 'save-document', issue, 409);
  assert.equal(
    Number(
      (await select('SELECT stock_quantity FROM materials WHERE material_id=$1', [flour]))
        .stock_quantity,
    ),
    2,
  );
  await command(employee, 'order-action', { id: po, action: 'start' });
  await command(
    employee,
    'order-action',
    { id: po, action: 'progress', quantities: { [cake]: 11, [bun]: 9 } },
    422,
  );
  await command(employee, 'order-action', {
    id: po,
    action: 'progress',
    quantities: { [cake]: 8, [bun]: 9 },
  });
  await command(employee, 'order-action', { id: po, action: 'complete' });
  assert.equal(
    (await select('SELECT stock_quantity FROM products WHERE product_id=$1', [cake]))
      .stock_quantity,
    8,
  );
  await command(employee, 'order-action', { id: po, action: 'complete' }, 409);
  const output = {
    ...base,
    kind: 'product-issues',
    orderId: undefined,
    source: undefined,
    note: `WF PI ${tag}`,
    lines: [{ itemId: cake, quantity: 3 }],
  };
  await command(employee, 'save-document', output);
  const pi = (
    await select(
      'SELECT product_issue_request_id AS id FROM product_issue_requests WHERE note=$1',
      [output.note],
    )
  ).id;
  await command(manager, 'document-action', { id: pi, action: 'approve' });
  assert.equal(
    (await select('SELECT stock_quantity FROM products WHERE product_id=$1', [cake]))
      .stock_quantity,
    5,
  );
  const own = (
    await select(
      'SELECT created_by FROM material_replenishment_requests WHERE material_replenishment_request_id=$1',
      [mr],
    )
  ).created_by;
  assert.equal(own, 'U03');
  assert.ok(
    (await select('SELECT count(*)::int AS n FROM business_events WHERE object_id=$1', [po])).n >=
      4,
  );
  const notice = await select(
    "SELECT notification_id FROM notifications WHERE user_id='U02' AND record_id=$1 LIMIT 1",
    [mr],
  );
  await command(employee, 'read-notification', notice.notification_id, 404);
  console.log(
    `PASS: ${checks} HTTP workflow checks, one-issue concurrency, transaction rollback, source identity and timeline`,
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
