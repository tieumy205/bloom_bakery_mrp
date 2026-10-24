import type { Db } from '../../core/db.ts';
import type { Actor } from '../auth/session.ts';
import { allowed } from '../auth/session.ts';
import type {
  Database,
  StockDocument,
  TimelineEntry,
} from '../../../../src/shared/domain/types.ts';
export const documents = {
  requests: {
    table: 'material_replenishment_requests',
    key: 'material_replenishment_request_id',
    details: 'material_replenishment_request_details',
    detailKey: 'replenishment_request_detail_id',
    quantity: 'requested_quantity',
    item: 'material_id',
  },
  receipts: {
    table: 'material_receipt_notes',
    key: 'material_receipt_note_id',
    details: 'material_receipt_note_details',
    detailKey: 'material_receipt_note_detail_id',
    quantity: 'received_quantity',
    item: 'material_id',
  },
  'material-issues': {
    table: 'material_issue_requests',
    key: 'material_issue_request_id',
    details: 'material_issue_request_details',
    detailKey: 'material_issue_request_detail_id',
    quantity: 'request_quantity',
    item: 'material_id',
  },
  'product-issues': {
    table: 'product_issue_requests',
    key: 'product_issue_request_id',
    details: 'product_issue_request_details',
    detailKey: 'product_issue_request_detail_id',
    quantity: 'request_quantity',
    item: 'product_id',
  },
} as const;
export type DocumentKind = keyof typeof documents;
const stamp = (value: Date | null | undefined) => value?.toISOString() || '';
export async function snapshot(db: Db, actor: Actor, scope = true): Promise<Database> {
  const query = async (table: string) => (await db.query(`SELECT * FROM ${table}`)).rows;
  const rawUsers = (
    await db.query(
      'SELECT u.user_id,u.full_name,u.email,u.is_active,u.created_at,r.name AS role FROM users u JOIN roles r USING(role_id) ORDER BY u.full_name',
    )
  ).rows;
  const users = rawUsers.map((u) => ({
    id: u.user_id,
    name: u.full_name,
    email: u.email || '',
    role: u.role,
    active: u.is_active,
    createdAt: stamp(u.created_at),
  }));
  const units = await query('units'),
    rawMaterials = await query('materials'),
    rawProducts = await query('products'),
    rawBoms = await query('bom'),
    bomLines = await query('bom_details'),
    orderDetails = await query('production_order_details'),
    rawOrders = await query('production_orders'),
    events = await query('business_events');
  const name = (id: string) => users.find((u) => u.id === id)?.name || id;
  const titles: Record<string, string> = {
    create: 'Tạo mới',
    update: 'Cập nhật',
    approve: 'Duyệt phiếu',
    reject: 'Từ chối phiếu',
    submit: 'Chuyển chờ hoàn tất',
    complete: 'Hoàn thành',
    start: 'Bắt đầu sản xuất',
    progress: 'Cập nhật tiến độ',
    cancel: 'Hủy lệnh',
    fulfill: 'Đã nhập đủ nguyên liệu',
  };
  const timeline = (
    type: string,
    id: string,
    header: { created_at: Date; created_by: string; reviewed_at?: Date; approved_by?: string },
  ): TimelineEntry[] => {
    const list = events
      .filter((e) => e.object_type === type && e.object_id === id)
      .sort((a, b) => Number(a.event_id) - Number(b.event_id))
      .map((e) => ({
        title: titles[e.action] || e.action,
        actor: name(e.actor_user_id),
        at: stamp(e.occurred_at),
        note: e.details?.note || undefined,
      }));
    if (list.length) return list;
    const known = [
      { title: 'Tạo chứng từ', actor: name(header.created_by), at: stamp(header.created_at) },
    ];
    if (header.reviewed_at)
      known.push({
        title: 'Xử lý phiếu',
        actor: name(header.approved_by || ''),
        at: stamp(header.reviewed_at),
      });
    return known;
  };
  const unit = (id: string) => units.find((u) => u.unit_id === id)?.symbol || id;
  const materials = rawMaterials.map((m) => ({
    id: m.material_id,
    name: m.material_name,
    unit: unit(m.unit_id),
    stock: Number(m.stock_quantity),
    minStock: Number(m.min_stock),
    createdAt: stamp(m.created_at),
  }));
  const products = rawProducts.map((p) => ({
    id: p.product_id,
    name: p.product_name,
    unit: unit(p.unit_id),
    stock: Number(p.stock_quantity),
    image: p.image_url || '',
    createdAt: stamp(p.created_at),
  }));
  const boms = rawBoms.map((b) => ({
    id: b.bom_id,
    productId: b.product_id,
    version: b.version_code,
    active: b.is_active,
    used: orderDetails.some((d) => d.bom_id === b.bom_id),
    createdAt: stamp(b.created_at),
    lines: bomLines
      .filter((l) => l.bom_id === b.bom_id)
      .map((l) => ({ materialId: l.material_id, quantity: Number(l.quantity) })),
  }));
  const orders = rawOrders.map((o) => {
    const items = orderDetails
      .filter((d) => d.production_order_id === o.production_order_id)
      .map((d) => ({
        productId: d.product_id,
        target: d.target_quantity,
        completed: d.completed_quantity,
        bomId: d.bom_id,
        bomVersion: boms.find((b) => b.id === d.bom_id)?.version,
      }));
    const requirements = new Map<string, number>();
    for (const item of items)
      for (const line of boms.find((b) => b.id === item.bomId)?.lines || [])
        requirements.set(
          line.materialId,
          Math.round(
            ((requirements.get(line.materialId) || 0) + line.quantity * item.target) * 1e6,
          ) / 1e6,
        );
    return {
      id: o.production_order_id,
      items,
      assignedTo: o.assigned_to,
      createdBy: o.created_by,
      createdAt: stamp(o.created_at),
      dueDate: o.due_date || '',
      note: o.note || '',
      status: o.status,
      timeline: timeline('production_orders', o.production_order_id, o),
      requirements: [...requirements].map(([materialId, quantity]) => ({ materialId, quantity })),
    };
  });
  const suppliers = await query('suppliers');
  const allDocs: StockDocument[] = [];
  for (const [kind, meta] of Object.entries(documents)) {
    const headers = await query(meta.table),
      lines = await query(meta.details);
    for (const h of headers) {
      const request =
        kind === 'receipts'
          ? allDocs.find((d) => d.id === h.material_replenishment_request_id)
          : undefined;
      allDocs.push({
        id: h[meta.key],
        kind: kind as DocumentKind,
        status: h.status,
        orderId: h.production_id || request?.orderId || undefined,
        requestId:
          h.material_replenishment_request_id && kind === 'receipts'
            ? h.material_replenishment_request_id
            : undefined,
        source:
          h.request_type === 'production'
            ? 'order'
            : h.request_type === 'minStock'
              ? 'min-stock'
              : request?.source,
        createdBy: h.created_by,
        createdAt: stamp(h.created_at),
        reviewedAt: h.reviewed_at ? stamp(h.reviewed_at) : undefined,
        reviewedBy: h.approved_by || undefined,
        rejectionReason: h.rejection_reason || undefined,
        note: h.note || '',
        supplier: suppliers.find((s) => s.supplier_id === h.supplier_id)?.supplier_name || '',
        receiptDate: h.receipt_date || '',
        lines: lines
          .filter((l) => l[meta.key] === h[meta.key])
          .map((l) => ({
            itemId: l[meta.item],
            quantity: Number(l[meta.quantity]),
            minimum: l.requirement_quantity ? Number(l.requirement_quantity) : undefined,
          })),
        timeline: timeline(meta.table, h[meta.key], h),
      });
    }
  }
  allDocs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const movements = [];
  const openingStock: Record<string, number> = {};
  for (const [table, itemType, key] of [
    ['material_transactions', 'material', 'material_id'],
    ['product_transactions', 'product', 'product_id'],
  ] as const) {
    for (const row of await query(table))
      movements.push({
        id: row[itemType === 'material' ? 'material_transaction_id' : 'product_transaction_id'],
        itemId: row[key],
        itemType,
        delta: Number(row.quantity_change),
        date: row.business_date,
        reference: row.record_id,
      });
  }
  for (const item of [...materials, ...products])
    openingStock[item.id] =
      Math.round(
        (item.stock -
          movements.filter((m) => m.itemId === item.id).reduce((sum, m) => sum + m.delta, 0)) *
          1e6,
      ) / 1e6;
  const notifications = (await query('notifications'))
    .filter((n) => n.user_id === actor.id)
    .map((n) => ({
      id: n.notification_id,
      userId: n.user_id,
      title: n.message,
      body: n.message,
      href: `/${actor.role === 'admin' ? 'admin' : 'app'}/${Object.entries(documents).find(([, m]) => m.table === n.object_type)?.[0] || 'orders'}/${n.record_id}`,
      createdAt: stamp(n.created_at),
      readBy: n.read_at ? [actor.id] : [],
    }));
  const referenceData = {
    units: units.map((u) => ({ id: u.unit_id, name: u.unit_name, symbol: u.symbol })),
    suppliers:
      !scope || allowed(actor, 'receipts')
        ? suppliers
            .filter((s) => s.is_active)
            .map((s) => ({ id: s.supplier_id, name: s.supplier_name }))
        : [],
  };
  if (!scope)
    return {
      ...referenceData,
      users,
      materials,
      products,
      boms,
      orders,
      documents: allDocs,
      movements,
      openingStock,
      notifications,
    };
  const visibleOrders = allowed(actor, 'orders')
    ? orders.filter((o) => actor.role !== 'employee' || o.assignedTo === actor.id)
    : [];
  const visibleDocs = allDocs.filter(
    (d) => allowed(actor, d.kind) && (actor.role !== 'employee' || d.createdBy === actor.id),
  );
  const ids = new Set([
    actor.id,
    ...visibleOrders.flatMap((o) => [o.createdBy, o.assignedTo]),
    ...visibleDocs.flatMap((d) => [d.createdBy, d.reviewedBy || '']),
  ]);
  const report = allowed(actor, 'reports'),
    bomRead = allowed(actor, 'boms');
  return {
    ...referenceData,
    users: users
      .filter(
        (u) =>
          allowed(actor, 'users') ||
          ids.has(u.id) ||
          (allowed(actor, 'orders', 'create') && u.role === 'employee' && u.active),
      )
      .map((u) => ({ ...u, email: allowed(actor, 'users') || u.id === actor.id ? u.email : '' })),
    materials: allowed(actor, 'materials') || report || bomRead ? materials : [],
    products:
      allowed(actor, 'products') ||
      report ||
      bomRead ||
      allowed(actor, 'orders', 'read') ||
      allowed(actor, 'orders', 'create')
        ? products
        : [],
    boms:
      bomRead || allowed(actor, 'orders', 'create') || allowed(actor, 'orders', 'update')
        ? boms
        : [],
    orders: visibleOrders,
    documents: visibleDocs,
    movements: report ? movements : [],
    openingStock: report ? openingStock : {},
    notifications: allowed(actor, 'notifications') ? notifications : [],
  };
}
