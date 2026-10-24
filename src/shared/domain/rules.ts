import type { Database, ProductionOrder, StockDocument } from './types';

export const EPSILON = 0.000001;
export const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export function activeMaterialIssue(db: Database, orderId: string, excludeId?: string) {
  return db.documents.find((doc) => doc.kind === 'material-issues' && doc.orderId === orderId && doc.id !== excludeId && ['pending', 'approved'].includes(doc.status));
}
export function issuedQuantity(
  db: Database,
  orderId: string,
  materialId: string,
  pending = false,
  excludeId?: string,
) {
  return rounded(
    db.documents
      .filter(
        (doc) =>
          doc.kind === 'material-issues' &&
          doc.orderId === orderId &&
          doc.id !== excludeId &&
          (doc.status === 'approved' || (pending && doc.status === 'pending')),
      )
      .reduce(
        (sum, doc) =>
          sum +
          doc.lines
            .filter((line) => line.itemId === materialId)
            .reduce((s, line) => s + line.quantity, 0),
        0,
      ),
  );
}
export function canStartOrder(db: Database, order: ProductionOrder) {
  const issue = activeMaterialIssue(db, order.id);
  return (
    order.status === 'pending' &&
    issue?.status === 'approved' &&
    db.documents.filter((doc) => doc.kind === 'material-issues' && doc.orderId === order.id && ['pending', 'approved'].includes(doc.status)).length === 1 &&
    issue.lines.length === order.requirements.length &&
    order.requirements.length > 0 &&
    order.requirements.every(
      (line) => Math.abs((issue.lines.find((item) => item.itemId === line.materialId)?.quantity || 0) - line.quantity) < EPSILON,
    )
  );
}
export function canCancelOrder(db: Database, order: ProductionOrder) {
  return (
    order.status === 'pending' &&
    !db.documents.some(
      (doc) =>
        doc.kind === 'material-issues' && doc.orderId === order.id && doc.status === 'approved',
    )
  );
}
export function bomLocked(db: Database, productId: string, bomId?: string) {
  return db.orders.some(
    (order) =>
      order.items.some((item) => item.productId === productId && (!bomId || !item.bomId || item.bomId===bomId)),
  );
}
export function calculateRequirements(db: Database, items: ProductionOrder['items']) {
  const requirements = new Map<string, number>();
  for (const item of items) {
    const bom = db.boms.find((bom) => item.bomId ? bom.id===item.bomId&&bom.productId===item.productId : bom.productId===item.productId&&bom.active!==false);
    if (!bom?.lines.length)
      throw new Error(
        `Sản phẩm ${db.products.find((p) => p.id === item.productId)?.name || item.productId} chưa có BOM hợp lệ.`,
      );
    for (const line of bom.lines)
      requirements.set(
        line.materialId,
        rounded((requirements.get(line.materialId) || 0) + line.quantity * item.target),
      );
  }
  return [...requirements].map(([materialId, quantity]) => ({ materialId, quantity }));
}
export function receiptMinimum(db: Database, request: StockDocument, materialId: string) {
  const material = db.materials.find((item) => item.id === materialId);
  if (!material) return 0;
  if (request.orderId) {
    const order = db.orders.find((item) => item.id === request.orderId);
    if (!order || order.status !== 'pending') return 0;
    const required =
      order.requirements.find((line) => line.materialId === materialId)?.quantity || 0;
    return rounded(
      Math.max(0, required - issuedQuantity(db, order.id, materialId) - material.stock),
    );
  }
  return rounded(Math.max(0, material.minStock - material.stock));
}
export function assertPositive(value: number, label = 'Số lượng') {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} phải lớn hơn 0.`);
}
