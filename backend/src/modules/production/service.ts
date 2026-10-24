import { id, one, nextCode } from '../../core/db.ts';
import type { Db } from '../../core/db.ts';
import { ensure } from '../../core/errors.ts';
import { text, quantity, date, lines } from '../../core/validation.ts';
import { requirePermission } from '../auth/session.ts';
import type { Actor } from '../auth/session.ts';
import type { ProductionOrder } from '../../../../src/shared/domain/types.ts';
import { event, notify, notifyManagers } from '../events/service.ts';
export async function lockOrder(db: Db, actor: Actor, key: string, pending = false) {
  const order = await one<Record<string, any>>(
    db,
    'SELECT * FROM production_orders WHERE production_order_id=$1 FOR UPDATE',
    [key],
  );
  ensure(order, 'Lệnh không tồn tại.', 404);
  ensure(
    actor.role !== 'employee' || order.assigned_to === actor.id,
    'Bạn không được giao lệnh này.',
    403,
  );
  if (pending) ensure(order.status === 'pending', 'Lệnh không còn chờ xử lý.', 409);
  return order;
}
export async function requirements(db: Db, key: string) {
  return (
    await db.query(
      'SELECT b.material_id,sum(d.target_quantity*b.quantity) AS quantity FROM production_order_details d JOIN bom_details b ON b.bom_id=d.bom_id WHERE d.production_order_id=$1 GROUP BY b.material_id ORDER BY b.material_id',
      [key],
    )
  ).rows.map((row) => ({ materialId: row.material_id as string, quantity: Number(row.quantity) }));
}
export async function related(db: Db, key: string, onlyPending = false) {
  return (
    await db.query(
      `SELECT 1 FROM material_issue_requests WHERE production_id=$1 AND ${onlyPending ? "status='pending'" : "status<>'rejected'"} UNION ALL SELECT 1 FROM material_replenishment_requests WHERE production_id=$1 AND ${onlyPending ? "status='pending'" : "status<>'rejected'"} UNION ALL SELECT 1 FROM material_receipt_notes n JOIN material_replenishment_requests r USING(material_replenishment_request_id) WHERE r.production_id=$1 AND n.status='pending'`,
      [key],
    )
  ).rowCount;
}
export async function saveOrder(db: Db, actor: Actor, value: ProductionOrder) {
  requirePermission(actor, 'orders', value.id ? 'update' : 'create');
  const old = value.id ? await lockOrder(db, actor, value.id, true) : null;
  if (old)
    ensure(
      !(await related(db, value.id)),
      'Lệnh đã có chứng từ liên quan, không sửa kế hoạch.',
      409,
    );
  const assigned = text(value.assignedTo, 'Nhân viên', 20),
    due = date(value.dueDate, 'Ngày cần hoàn thành'),
    note = text(value.note, 'Ghi chú', 4000, true);
  const employee = await one(
    db,
    "SELECT u.user_id FROM users u JOIN roles r USING(role_id) WHERE u.user_id=$1 AND u.is_active AND r.name='employee' FOR UPDATE OF u",
    [assigned],
  );
  ensure(employee, 'Chỉ giao lệnh cho nhân viên đang hoạt động.');
  lines(value.items, (item) => item.productId);
  const prior = old
    ? (
        await db.query(
          'SELECT product_id,bom_id FROM production_order_details WHERE production_order_id=$1',
          [value.id],
        )
      ).rows
    : [];
  for (const productId of value.items.map((item) => item.productId).sort())
    await db.query('SELECT 1 FROM products WHERE product_id=$1 FOR UPDATE', [productId]);
  for (const item of value.items) {
    quantity(item.target, 'Mục tiêu', false, true);
    ensure(item.target <= 2147483647, 'Mục tiêu quá lớn.');
    text(item.bomId, 'Phiên bản BOM', 20);
    const bom = await one<Record<string, any>>(
      db,
      'SELECT b.*,p.unit_id AS product_unit FROM bom b JOIN products p USING(product_id) WHERE b.bom_id=$1 AND b.product_id=$2 FOR UPDATE OF b',
      [item.bomId, item.productId],
    );
    ensure(
      bom &&
        bom.unit_id === bom.product_unit &&
        (bom.is_active ||
          prior.some((p) => p.bom_id === item.bomId && p.product_id === item.productId)),
      'Phiên bản BOM không hợp lệ hoặc đã ngừng hoạt động.',
    );
    ensure(
      (await db.query('SELECT 1 FROM bom_details WHERE bom_id=$1', [item.bomId])).rowCount,
      'BOM chưa có định mức.',
    );
  }
  const key = value.id || (await nextCode(db, 'PO'));
  if (old) {
    await db.query(
      'UPDATE production_orders SET assigned_to=$2,due_date=$3,note=$4 WHERE production_order_id=$1',
      [key, assigned, due, note],
    );
    await db.query('DELETE FROM production_order_details WHERE production_order_id=$1', [key]);
  } else
    await db.query(
      'INSERT INTO production_orders(production_order_id,created_by,assigned_to,due_date,note) VALUES($1,$2,$3,$4,$5)',
      [key, actor.id, assigned, due, note],
    );
  for (const item of value.items)
    await db.query(
      'INSERT INTO production_order_details(production_order_detail_id,production_order_id,product_id,bom_id,target_quantity) VALUES($1,$2,$3,$4,$5)',
      [id('PD'), key, item.productId, item.bomId, item.target],
    );
  await event(
    db,
    actor,
    'production_orders',
    key,
    old ? 'update' : 'create',
    old?.status || null,
    'pending',
    {
      items: value.items.map((item) => ({
        productId: item.productId,
        bomId: item.bomId,
        target: item.target,
      })),
    },
  );
  await notify(db, assigned, 'production_orders', key, `Bạn được giao lệnh ${key}`);
  return key;
}
export async function orderAction(
  db: Db,
  actor: Actor,
  value: { id: string; action: string; quantities?: Record<string, number> },
) {
  ensure(
    ['start', 'cancel', 'progress', 'complete'].includes(value.action),
    'Thao tác lệnh không hợp lệ.',
  );
  requirePermission(actor, 'orders', value.action);
  const order = await lockOrder(db, actor, value.id);
  const items = (
    await db.query(
      'SELECT * FROM production_order_details WHERE production_order_id=$1 ORDER BY product_id',
      [value.id],
    )
  ).rows;
  let target = order.status;
  if (value.action === 'start') {
    ensure(order.status === 'pending', 'Lệnh không còn chờ xử lý.', 409);
    const need = await requirements(db, value.id);
    const approved = (
      await db.query(
        "SELECT material_issue_request_id FROM material_issue_requests WHERE production_id=$1 AND status IN ('pending','approved')",
        [value.id],
      )
    ).rows;
    ensure(approved.length === 1, 'Lệnh cần đúng một phiếu xuất NVL đã duyệt.');
    const doc = (
      await db.query(
        'SELECT status FROM material_issue_requests WHERE material_issue_request_id=$1',
        [approved[0].material_issue_request_id],
      )
    ).rows[0];
    ensure(doc.status === 'approved', 'Phiếu xuất NVL chưa được duyệt.');
    const actual = (
      await db.query(
        'SELECT material_id,request_quantity FROM material_issue_request_details WHERE material_issue_request_id=$1',
        [approved[0].material_issue_request_id],
      )
    ).rows;
    ensure(
      need.length > 0 &&
        need.length === actual.length &&
        need.every(
          (n) =>
            Math.abs(
              Number(actual.find((a) => a.material_id === n.materialId)?.request_quantity || 0) -
                n.quantity,
            ) < 1e-6,
        ),
      'Chưa xuất đủ toàn bộ nguyên liệu theo BOM.',
    );
    target = 'in_progress';
  }
  if (value.action === 'cancel') {
    ensure(order.status === 'pending', 'Chỉ hủy lệnh chờ xử lý.', 409);
    ensure(
      !(
        await db.query(
          "SELECT 1 FROM material_issue_requests WHERE production_id=$1 AND status='approved'",
          [value.id],
        )
      ).rowCount,
      'Đã xuất NVL, chưa hỗ trợ hoàn trả để hủy.',
    );
    ensure(!(await related(db, value.id, true)), 'Cần xử lý các phiếu đang chờ trước khi hủy.');
    target = 'cancelled';
  }
  if (value.action === 'progress' || value.action === 'complete') {
    ensure(order.status === 'in_progress', 'Chỉ cập nhật lệnh đang sản xuất.', 409);
    if (value.action === 'progress') {
      ensure(
        value.quantities &&
          typeof value.quantities === 'object' &&
          !Array.isArray(value.quantities) &&
          Object.keys(value.quantities).length === items.length,
        'Cần số lượng cho từng thành phẩm.',
      );
      for (const item of items) {
        const count = quantity(value.quantities[item.product_id], 'Sản lượng', true, true);
        ensure(count <= item.target_quantity, 'Sản lượng không vượt mục tiêu.');
        await db.query(
          'UPDATE production_order_details SET completed_quantity=$2 WHERE production_order_detail_id=$1',
          [item.production_order_detail_id, count],
        );
      }
    } else {
      ensure(
        items.some((item) => item.completed_quantity > 0),
        'Cần cập nhật số lượng hoàn thành trước.',
      );
      target = 'completed';
    }
  }
  if (target !== order.status)
    await db.query('UPDATE production_orders SET status=$2 WHERE production_order_id=$1', [
      value.id,
      target,
    ]);
  await event(
    db,
    actor,
    'production_orders',
    value.id,
    value.action,
    order.status,
    target,
    value.action === 'progress' ? { quantities: value.quantities } : {},
  );
  if (value.action === 'complete')
    await notifyManagers(
      db,
      'production_orders',
      value.id,
      `Lệnh ${value.id} đã hoàn thành`,
      'production_orders',
      'read',
    );
}
