import { id, one, nextCode } from '../../core/db.ts';
import type { Db } from '../../core/db.ts';
import { ensure } from '../../core/errors.ts';
import { text, quantity, date, lines, today } from '../../core/validation.ts';
import type { Actor } from '../auth/session.ts';
import { requirePermission } from '../auth/session.ts';
import { documents } from '../data/snapshot.ts';
import type { DocumentKind } from '../data/snapshot.ts';
import type { StockDocument } from '../../../../src/shared/domain/types.ts';
import { lockOrder, requirements } from '../production/service.ts';
import { event, notify, notifyManagers } from '../events/service.ts';
export async function findDocument(db: Db, key: string) {
  text(key, 'Mã phiếu', 20);
  for (const [kind, meta] of Object.entries(documents)) {
    const row = await one<Record<string, any>>(
      db,
      `SELECT * FROM ${meta.table} WHERE ${meta.key}=$1`,
      [key],
    );
    if (row) return { kind: kind as DocumentKind, meta, row };
  }
  ensure(false, 'Phiếu không tồn tại.', 404);
}
async function context(
  db: Db,
  actor: Actor,
  kind: DocumentKind,
  key: string | undefined,
  orderId?: string,
  requestId?: string,
) {
  const meta = documents[kind];
  const old = key
    ? await one<Record<string, any>>(db, `SELECT * FROM ${meta.table} WHERE ${meta.key}=$1`, [key])
    : undefined;
  ensure(!key || old, 'Phiếu không tồn tại.', 404);
  let sourceRequest =
    kind === 'receipts'
      ? await one<Record<string, any>>(
          db,
          'SELECT * FROM material_replenishment_requests WHERE material_replenishment_request_id=$1',
          [old?.material_replenishment_request_id || requestId],
        )
      : undefined;
  if (kind === 'receipts') ensure(sourceRequest, 'Phiếu bổ sung không tồn tại.');
  const sourceOrder =
    kind === 'receipts' ? sourceRequest?.production_id : old?.production_id || orderId;
  const order = sourceOrder ? await lockOrder(db, actor, sourceOrder) : undefined;
  if (sourceRequest)
    sourceRequest = await one<Record<string, any>>(
      db,
      'SELECT * FROM material_replenishment_requests WHERE material_replenishment_request_id=$1 FOR UPDATE',
      [sourceRequest.material_replenishment_request_id],
    );
  const current = key
    ? await one<Record<string, any>>(
        db,
        `SELECT * FROM ${meta.table} WHERE ${meta.key}=$1 FOR UPDATE`,
        [key],
      )
    : undefined;
  if (current && actor.role === 'employee')
    ensure(current.created_by === actor.id, 'Chỉ thao tác phiếu của mình.', 403);
  return { meta, old: current, order, sourceRequest };
}
async function lockStock(db: Db, kind: DocumentKind, itemIds: string[]) {
  const product = kind === 'product-issues',
    table = product ? 'products' : 'materials',
    key = product ? 'product_id' : 'material_id';
  const rows = (
    await db.query(`SELECT * FROM ${table} WHERE ${key}=ANY($1) ORDER BY ${key} FOR UPDATE`, [
      itemIds,
    ])
  ).rows;
  ensure(rows.length === itemIds.length, 'Vật tư không tồn tại.');
  return new Map(rows.map((row) => [row[key], row]));
}
async function minimum(
  db: Db,
  request: Record<string, any>,
  materialId: string,
  stock: Record<string, any>,
) {
  if (request.request_type === 'minStock')
    return Math.max(0, Number(stock.min_stock) - Number(stock.stock_quantity));
  const order = await one<{ status: string }>(
    db,
    'SELECT status FROM production_orders WHERE production_order_id=$1',
    [request.production_id],
  );
  if (order?.status !== 'pending') return 0;
  const need =
    (await requirements(db, request.production_id)).find((n) => n.materialId === materialId)
      ?.quantity || 0;
  const issued = (
    await db.query(
      "SELECT coalesce(sum(d.request_quantity),0) AS quantity FROM material_issue_requests h JOIN material_issue_request_details d USING(material_issue_request_id) WHERE h.production_id=$1 AND h.status='approved' AND d.material_id=$2",
      [request.production_id, materialId],
    )
  ).rows[0];
  return (
    Math.round(Math.max(0, need - Number(issued.quantity) - Number(stock.stock_quantity)) * 1e6) /
    1e6
  );
}
async function validateIssue(
  db: Db,
  key: string,
  orderId: string,
  items: { itemId: string; quantity: number }[],
  stock: Map<string, Record<string, any>>,
) {
  ensure(
    !(
      await db.query(
        "SELECT 1 FROM material_issue_requests WHERE production_id=$1 AND status IN ('pending','approved') AND material_issue_request_id<>$2",
        [orderId, key],
      )
    ).rowCount,
    'Lệnh đã có phiếu xuất NVL chờ duyệt hoặc đã duyệt; chỉ xuất một lần.',
    409,
  );
  const need = await requirements(db, orderId);
  ensure(
    need.length > 0 &&
      need.length === items.length &&
      need.every((n) =>
        items.some(
          (line) => line.itemId === n.materialId && Math.abs(line.quantity - n.quantity) < 1e-6,
        ),
      ),
    'Phiếu xuất phải đủ toàn bộ NVL và số lượng theo BOM.',
  );
  for (const item of items)
    ensure(
      Number(stock.get(item.itemId)?.stock_quantity) >= item.quantity,
      'Không đủ tồn NVL; cần bổ sung trước khi xuất.',
    );
}
async function supplier(db: Db, name: string) {
  text(name, 'Nhà cung cấp', 255);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `supplier:${name.trim().toLowerCase()}`,
  ]);
  const found = await one<{ supplier_id: string; is_active: boolean }>(
    db,
    'SELECT supplier_id,is_active FROM suppliers WHERE lower(supplier_name)=lower($1)',
    [name.trim()],
  );
  if (found) {
    ensure(found.is_active, 'Nhà cung cấp đã ngừng hoạt động.');
    return found.supplier_id;
  }
  const key = id('S');
  await db.query('INSERT INTO suppliers(supplier_id,supplier_name) VALUES($1,$2)', [
    key,
    name.trim(),
  ]);
  return key;
}
export async function saveDocument(db: Db, actor: Actor, value: StockDocument) {
  ensure(Object.hasOwn(documents, value.kind), 'Loại phiếu không hợp lệ.');
  const kind = value.kind;
  requirePermission(actor, kind, value.id ? 'update' : 'create');
  lines(value.lines, (line) => line.itemId);
  const items = value.lines.map((line) => ({
    itemId: line.itemId,
    quantity: quantity(line.quantity, 'Số lượng', false, kind === 'product-issues'),
  }));
  const note = text(value.note, 'Ghi chú', 4000, true);
  const { meta, old, order, sourceRequest } = await context(
    db,
    actor,
    kind,
    value.id || undefined,
    value.orderId,
    value.requestId,
  );
  ensure(
    !old || old.status === (kind === 'receipts' ? 'draft' : 'pending'),
    'Chứng từ đã được xử lý, không sửa.',
    409,
  );
  if (kind === 'requests' || kind === 'material-issues') {
    if (kind === 'requests')
      ensure(
        (value.source === 'order' && !!value.orderId) ||
          (value.source === 'min-stock' && !value.orderId),
        'Nguồn bổ sung không hợp lệ.',
      );
    if (old)
      ensure(
        (old.production_id || null) === (value.orderId || null) &&
          (kind !== 'requests' ||
            old.request_type === (value.source === 'order' ? 'production' : 'minStock')),
        'Không đổi nguồn phiếu.',
      );
    if (kind === 'material-issues' || value.source === 'order')
      ensure(
        order && order.status === 'pending' && order.production_order_id === value.orderId,
        'Lệnh nguồn không còn chờ xử lý.',
      );
  }
  if (kind === 'product-issues')
    ensure(!value.orderId && !value.requestId, 'Chỉ xuất thành phẩm từ kho, không gắn lệnh.');
  if (kind === 'receipts') {
    ensure(sourceRequest?.status === 'approved', 'Chỉ nhập từ phiếu bổ sung đã duyệt.');
    ensure(
      value.requestId === sourceRequest.material_replenishment_request_id &&
        (value.orderId || null) === (sourceRequest.production_id || null),
      'Không đổi nguồn phiếu nhập.',
    );
    ensure(
      !(
        await db.query(
          'SELECT 1 FROM material_receipt_notes WHERE material_replenishment_request_id=$1 AND material_receipt_note_id<>$2',
          [value.requestId, value.id || ''],
        )
      ).rowCount,
      'Phiếu bổ sung đã có phiếu nhập.',
      409,
    );
    date(value.receiptDate, 'Ngày nhập');
    ensure(value.receiptDate <= today(), 'Ngày nhập không được ở tương lai.');
  }
  const stock = await lockStock(
    db,
    kind,
    items.map((line) => line.itemId),
  );
  if (kind === 'material-issues')
    await validateIssue(db, value.id || '', order!.production_order_id, items, stock);
  if (kind === 'product-issues')
    for (const item of items)
      ensure(
        item.quantity <= 2147483647 &&
          Number(stock.get(item.itemId)?.stock_quantity) >= item.quantity,
        'Không đủ tồn thành phẩm.',
      );
  const need = order ? await requirements(db, order.production_order_id) : [];
  if (kind === 'requests') {
    const shortage = items.some((line) => {
      const material = stock.get(line.itemId)!;
      const required = order
        ? need.find((n) => n.materialId === line.itemId)?.quantity || 0
        : Number(material.min_stock);
      return required > Number(material.stock_quantity);
    });
    ensure(shortage, 'Không được tạo phiếu bổ sung khi NVL còn đủ.');
  }
  if (kind === 'requests' && order)
    ensure(
      items.every((line) => need.some((n) => n.materialId === line.itemId)),
      'Nguyên liệu không thuộc BOM của lệnh.',
    );
  if (kind === 'receipts') {
    const requested = (
      await db.query(
        'SELECT material_id FROM material_replenishment_request_details WHERE material_replenishment_request_id=$1',
        [value.requestId],
      )
    ).rows;
    ensure(
      requested.length === items.length &&
        requested.every((r) => items.some((line) => line.itemId === r.material_id)),
      'Nguyên liệu phải khớp phiếu bổ sung.',
    );
    for (const item of items)
      ensure(
        item.quantity + 1e-6 >=
          (await minimum(db, sourceRequest!, item.itemId, stock.get(item.itemId)!)),
        'Số lượng nhập dưới mức tối thiểu cần thiết.',
      );
  }
  const key =
    value.id ||
    (await nextCode(
      db,
      (
        { requests: 'MR', receipts: 'RN', 'material-issues': 'MI', 'product-issues': 'PI' } as const
      )[kind],
    ));
  const supplierId = kind === 'receipts' ? await supplier(db, value.supplier) : null;
  if (old) {
    if (kind === 'receipts')
      await db.query(
        'UPDATE material_receipt_notes SET supplier_id=$2,receipt_date=$3,note=$4 WHERE material_receipt_note_id=$1',
        [key, supplierId, value.receiptDate, note],
      );
    else await db.query(`UPDATE ${meta.table} SET note=$2 WHERE ${meta.key}=$1`, [key, note]);
    await db.query(`DELETE FROM ${meta.details} WHERE ${meta.key}=$1`, [key]);
  } else if (kind === 'receipts')
    await db.query(
      'INSERT INTO material_receipt_notes(material_receipt_note_id,created_by,supplier_id,receipt_date,note,material_replenishment_request_id) VALUES($1,$2,$3,$4,$5,$6)',
      [key, actor.id, supplierId, value.receiptDate, note, value.requestId],
    );
  else if (kind === 'requests')
    await db.query(
      'INSERT INTO material_replenishment_requests(material_replenishment_request_id,created_by,request_type,production_id,note) VALUES($1,$2,$3,$4,$5)',
      [
        key,
        actor.id,
        value.source === 'order' ? 'production' : 'minStock',
        value.orderId || null,
        note,
      ],
    );
  else if (kind === 'material-issues')
    await db.query(
      'INSERT INTO material_issue_requests(material_issue_request_id,created_by,production_id,note) VALUES($1,$2,$3,$4)',
      [key, actor.id, value.orderId, note],
    );
  else
    await db.query(
      'INSERT INTO product_issue_requests(product_issue_request_id,created_by,note) VALUES($1,$2,$3)',
      [key, actor.id, note],
    );
  for (const item of items) {
    const reference =
      kind === 'requests'
        ? order
          ? need.find((n) => n.materialId === item.itemId)!.quantity
          : Number(stock.get(item.itemId)!.min_stock)
        : kind === 'material-issues'
          ? need.find((n) => n.materialId === item.itemId)!.quantity
          : undefined;
    const column =
      kind === 'requests'
        ? 'requirement_quantity'
        : kind === 'material-issues'
          ? 'material_requirement'
          : null;
    await db.query(
      `INSERT INTO ${meta.details}(${meta.detailKey},${meta.key},${meta.item},${meta.quantity}${column ? ',' + column : ''}) VALUES($1,$2,$3,$4${column ? ',$5' : ''})`,
      column
        ? [id('D'), key, item.itemId, item.quantity, reference]
        : [id('D'), key, item.itemId, item.quantity],
    );
  }
  await event(
    db,
    actor,
    meta.table,
    key,
    old ? 'update' : 'create',
    old?.status || null,
    old?.status || (kind === 'receipts' ? 'draft' : 'pending'),
    { note },
  );
  if (!old && kind !== 'receipts')
    await notifyManagers(db, meta.table, key, `Phiếu ${key} chờ duyệt`);
  return key;
}
export async function documentAction(
  db: Db,
  actor: Actor,
  value: { id: string; action: string; reason?: string },
) {
  const found = await findDocument(db, value.id);
  const { kind, meta } = found;
  ensure(
    ['approve', 'reject', 'submit', 'complete'].includes(value.action),
    'Thao tác phiếu không hợp lệ.',
  );
  requirePermission(actor, kind, value.action === 'submit' ? 'update' : value.action);
  const { old, order, sourceRequest } = await context(db, actor, kind, value.id);
  ensure(old, 'Phiếu không tồn tại.', 404);
  const detailRows = (
    await db.query(`SELECT * FROM ${meta.details} WHERE ${meta.key}=$1`, [value.id])
  ).rows;
  const items = detailRows.map((line) => ({
    itemId: line[meta.item] as string,
    quantity: Number(line[meta.quantity]),
  }));
  ensure(items.length > 0, 'Phiếu chưa có chi tiết.');
  let status: string;
  if (kind === 'receipts') {
    ensure(
      (value.action === 'submit' && old.status === 'draft') ||
        (value.action === 'complete' && old.status === 'pending'),
      'Phiếu nhập không đúng bước xử lý.',
      409,
    );
    ensure(sourceRequest?.status === 'approved', 'Phiếu bổ sung nguồn không còn hợp lệ.');
    ensure(old.receipt_date <= today(), 'Ngày nhập không được ở tương lai.');
    status = value.action === 'submit' ? 'pending' : 'completed';
    const stock = await lockStock(
      db,
      kind,
      items.map((item) => item.itemId),
    );
    for (const item of items)
      ensure(
        item.quantity + 1e-6 >=
          (await minimum(db, sourceRequest!, item.itemId, stock.get(item.itemId)!)),
        'Nhu cầu thay đổi; số lượng nhập dưới mức tối thiểu.',
      );
  } else {
    ensure(
      old.status === 'pending' && ['approve', 'reject'].includes(value.action),
      'Phiếu không còn chờ duyệt.',
      409,
    );
    status = value.action === 'approve' ? 'approved' : 'rejected';
    if (value.action === 'reject') text(value.reason, 'Lý do từ chối', 4000);
    else {
      if (order) ensure(order.status === 'pending', 'Lệnh nguồn không còn chờ xử lý.');
      const stock = await lockStock(
        db,
        kind,
        items.map((item) => item.itemId),
      );
      if (kind === 'material-issues')
        await validateIssue(db, value.id, order!.production_order_id, items, stock);
      if (kind === 'product-issues')
        for (const item of items)
          ensure(
            Number(stock.get(item.itemId)?.stock_quantity) >= item.quantity,
            'Không đủ tồn thành phẩm.',
          );
    }
  }
  if (kind === 'receipts')
    await db.query(`UPDATE ${meta.table} SET status=$2 WHERE ${meta.key}=$1`, [value.id, status]);
  else
    await db.query(
      `UPDATE ${meta.table} SET status=$2,approved_by=$3,rejection_reason=$4 WHERE ${meta.key}=$1`,
      [value.id, status, actor.id, value.action === 'reject' ? value.reason!.trim() : null],
    );
  await event(db, actor, meta.table, value.id, value.action, old.status, status, {
    note: value.action === 'reject' ? value.reason!.trim() : '',
  });
  await notify(db, old.created_by, meta.table, value.id, `Phiếu ${value.id}: ${status}`);
  if (kind === 'receipts' && value.action === 'complete') {
    await event(
      db,
      actor,
      'material_replenishment_requests',
      sourceRequest!.material_replenishment_request_id,
      'fulfill',
      'approved',
      'fulfilled',
    );
    await notify(
      db,
      sourceRequest!.created_by,
      'material_replenishment_requests',
      sourceRequest!.material_replenishment_request_id,
      'Nguyên liệu đã được nhập kho',
    );
  }
}
export async function deleteDocument(db: Db, actor: Actor, key: string) {
  const found = await findDocument(db, key);
  requirePermission(actor, found.kind, 'delete');
  const { old, meta } = await context(db, actor, found.kind, key);
  ensure(
    old && old.status === (found.kind === 'receipts' ? 'draft' : 'pending'),
    'Chỉ xóa phiếu chưa xử lý.',
    409,
  );
  await db.query(`DELETE FROM ${meta.details} WHERE ${meta.key}=$1`, [key]);
  await db.query(`DELETE FROM ${meta.table} WHERE ${meta.key}=$1`, [key]);
  await event(db, actor, meta.table, key, 'delete', old.status, null);
}
export async function readNotification(db: Db, actor: Actor, key: string) {
  requirePermission(actor, 'notifications');
  text(key, 'Thông báo', 100);
  const result = await db.query(
    "UPDATE notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE user_id=$1 AND ($2='all' OR notification_id=$2)",
    [actor.id, key],
  );
  ensure(key === 'all' || result.rowCount, 'Thông báo không tồn tại.', 404);
}
