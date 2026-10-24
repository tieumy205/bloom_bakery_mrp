import type { Command } from '../shared/domain/commands';
import type {
  Action,
  Database,
  Module,
  Session,
  StockDocument,
  User,
} from '../shared/domain/types';
import { can } from '../shared/domain/permissions';
import {
  assertPositive,
  activeMaterialIssue,
  bomLocked,
  calculateRequirements,
  canCancelOrder,
  canStartOrder,
  EPSILON,
  receiptMinimum,
  rounded,
} from '../shared/domain/rules';
import { today } from '../shared/domain/format';
import { readDatabase, writeDatabase } from './storage';

function requirePermission(user: User, module: Module, action: Action) {
  if (!can(user, module, action)) throw new Error('Bạn không có quyền thực hiện thao tác này.');
}
function nextId(prefix: string, ids: string[]) {
  return `${prefix}${String(Math.max(0, ...ids.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length)) || 0)) + 1).padStart(3, '0')}`;
}
function uniqueLines(lines: { itemId: string; quantity: number }[]) {
  if (!lines.length) throw new Error('Cần ít nhất một dòng có số lượng lớn hơn 0.');
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length)
    throw new Error('Không được chọn trùng nguyên liệu hoặc thành phẩm.');
  lines.forEach((line) => assertPositive(line.quantity));
}
function notify(
  db: Database,
  title: string,
  body: string,
  href: string,
  recipient: { userId?: string; role?: User['role'] },
) {
  db.notifications.unshift({
    id: crypto.randomUUID(),
    title,
    body,
    href,
    ...recipient,
    createdAt: new Date().toISOString(),
    readBy: [],
  });
}
function move(
  db: Database,
  itemId: string,
  itemType: 'material' | 'product',
  delta: number,
  reference: string,
  day = today(),
) {
  const item = (itemType === 'material' ? db.materials : db.products).find(
    (row) => row.id === itemId,
  );
  if (!item) throw new Error('Không tìm thấy vật tư.');
  if (item.stock + delta < -EPSILON)
    throw new Error(`${item.name} không đủ tồn kho. Tồn hiện tại: ${item.stock} ${item.unit}.`);
  item.stock = rounded(item.stock + delta);
  db.movements.push({ id: crypto.randomUUID(), itemId, itemType, delta, date: day, reference });
}
function validateIssue(db: Database, doc: StockDocument) {
  if (!doc.orderId) throw new Error('Phiếu xuất NVL phải được tạo từ lệnh sản xuất.');
  const order = db.orders.find((item) => item.id === doc.orderId);
  if (!order || order.status !== 'pending') throw new Error('Chỉ xuất NVL khi lệnh còn chờ xử lý.');
  if (activeMaterialIssue(db, order.id, doc.id))
    throw new Error(
      'Lệnh đã có phiếu xuất NVL chờ duyệt hoặc đã duyệt. Mỗi lệnh chỉ xuất NVL một lần.',
    );
  if (
    !order.requirements.length ||
    doc.lines.length !== order.requirements.length ||
    new Set(doc.lines.map((line) => line.itemId)).size !== order.requirements.length
  )
    throw new Error('Phiếu xuất một lần phải có đầy đủ nguyên liệu theo BOM.');
  for (const line of doc.lines) {
    const requirement =
      order.requirements.find((item) => item.materialId === line.itemId)?.quantity || 0;
    if (!requirement || Math.abs(line.quantity - requirement) >= EPSILON)
      throw new Error('Chỉ xuất NVL một lần: số lượng phải bằng đầy đủ nhu cầu BOM.');
    const material = db.materials.find((item) => item.id === line.itemId);
    if (!material || material.stock + EPSILON < line.quantity)
      throw new Error(
        `${material?.name || line.itemId} không đủ tồn. Vui lòng bổ sung nguyên liệu.`,
      );
  }
}

/** Pure transaction: mutations become visible only if every rule passes. */
export function applyCommand(input: Database, command: Command, session: Session): Database {
  const db = structuredClone(input);
  const actor = db.users.find((user) => user.id === session.userId && user.active);
  if (!actor) throw new Error('Tài khoản không hoạt động. Vui lòng chọn lại tài khoản demo.');
  const at = new Date().toISOString();
  switch (command.type) {
    case 'save-user': {
      const user = command.payload;
      const existing = db.users.find((row) => row.id === user.id);
      requirePermission(actor, 'users', existing ? 'update' : 'create');
      if (!user.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email))
        throw new Error('Vui lòng nhập họ tên và email hợp lệ.');
      if (
        db.users.some(
          (row) => row.id !== user.id && row.email.toLowerCase() === user.email.toLowerCase(),
        )
      )
        throw new Error('Email này đã được sử dụng.');
      if (existing?.id === actor.id && (!user.active || user.role !== 'admin'))
        throw new Error('Không thể tự khóa hoặc gỡ quyền Admin của tài khoản hiện tại.');
      if (
        existing?.role === 'employee' &&
        (!user.active || user.role !== 'employee') &&
        db.orders.some(
          (order) =>
            order.assignedTo === user.id && ['pending', 'in_progress'].includes(order.status),
        )
      )
        throw new Error('Nhân viên đang được giao lệnh chưa hoàn thành.');
      if (existing)
        Object.assign(existing, {
          name: user.name.trim(),
          email: user.email.trim(),
          role: user.role,
          active: user.active,
        });
      else
        db.users.push({
          name: user.name,
          email: user.email,
          role: user.role,
          active: user.active,
          id: crypto.randomUUID(),
          createdAt: at,
        });
      break;
    }
    case 'delete-user': {
      requirePermission(actor, 'users', 'delete');
      if (command.payload === actor.id) throw new Error('Không thể xóa tài khoản đang sử dụng.');
      if (
        db.orders.some(
          (o) => o.assignedTo === command.payload || o.createdBy === command.payload,
        ) ||
        db.documents.some(
          (d) => d.createdBy === command.payload || d.reviewedBy === command.payload,
        )
      )
        throw new Error(
          'Tài khoản có dữ liệu liên quan. Hãy chuyển sang trạng thái ngừng hoạt động.',
        );
      db.users = db.users.filter((user) => user.id !== command.payload);
      break;
    }
    case 'save-material': {
      const value = command.payload;
      const existing = db.materials.find((row) => row.id === value.id);
      requirePermission(actor, 'materials', existing ? 'update' : 'create');
      if (
        !value.name.trim() ||
        !value.unit.trim() ||
        !Number.isFinite(value.minStock) ||
        value.minStock < 0
      )
        throw new Error('Tên, đơn vị và tồn tối thiểu chưa hợp lệ.');
      if (
        existing &&
        existing.unit !== value.unit &&
        (existing.stock > 0 ||
          db.boms.some((b) => b.lines.some((l) => l.materialId === existing.id)) ||
          db.documents.some((d) => d.lines.some((l) => l.itemId === existing.id)))
      )
        throw new Error('Không thể đổi đơn vị khi nguyên liệu đã có tồn hoặc được sử dụng.');
      if (existing)
        Object.assign(existing, { name: value.name, unit: value.unit, minStock: value.minStock });
      else {
        const id = nextId(
          'M',
          db.materials.map((m) => m.id),
        );
        db.materials.push({ ...value, id, stock: 0, createdAt: at });
        db.openingStock[id] = 0;
      }
      break;
    }
    case 'save-product': {
      const value = command.payload;
      const existing = db.products.find((row) => row.id === value.id);
      requirePermission(actor, 'products', existing ? 'update' : 'create');
      if (!value.name.trim() || !value.unit.trim())
        throw new Error('Vui lòng nhập tên và đơn vị thành phẩm.');
      if (value.image && !/^data:image\/(png|jpeg|webp);base64,/.test(value.image))
        throw new Error('Ảnh cần là PNG, JPEG hoặc WebP.');
      if (
        existing &&
        existing.unit !== value.unit &&
        (existing.stock > 0 || db.boms.some((b) => b.productId === existing.id))
      )
        throw new Error('Không thể đổi đơn vị thành phẩm đã có tồn hoặc BOM.');
      if (existing)
        Object.assign(existing, { name: value.name, unit: value.unit, image: value.image });
      else {
        const id = nextId(
          'B',
          db.products.map((p) => p.id),
        );
        db.products.push({ ...value, id, stock: 0, createdAt: at });
        db.openingStock[id] = 0;
      }
      break;
    }
    case 'save-bom': {
      const value = command.payload;
      const existing = db.boms.find((row) => row.id === value.id);
      requirePermission(actor, 'boms', existing ? 'update' : 'create');
      if (existing && bomLocked(db, existing.productId, existing.id))
        throw new Error('BOM đang được lệnh chờ xử lý hoặc đang sản xuất sử dụng.');
      if (!db.products.some((p) => p.id === value.productId))
        throw new Error('Vui lòng chọn thành phẩm.');
      if (
        db.boms.some(
          (b) =>
            b.productId === value.productId &&
            (b.version || '1.0') === (value.version || '1.0') &&
            b.id !== value.id,
        )
      )
        throw new Error('không được nhập trùng tên phiên bản trước đó');
      uniqueLines(value.lines.map((l) => ({ itemId: l.materialId, quantity: l.quantity })));
      if (value.lines.some((l) => !db.materials.some((m) => m.id === l.materialId)))
        throw new Error('Nguyên liệu không tồn tại.');
      const recipe = (lines: { materialId: string; quantity: number }[]) =>
        lines.map((l) => `${l.materialId}:${l.quantity}`).sort().join('|');
      if (
        db.boms.some(
          (b) =>
            b.productId === value.productId &&
            b.id !== value.id &&
            recipe(b.lines) === recipe(value.lines),
        )
      )
        throw new Error('không được tạo 1 phiên bản mới trùng với phiên bản đã có');
      if (value.active !== false)
        for (const bom of db.boms)
          if (bom.productId === value.productId && bom.id !== value.id) bom.active = false;
      if (existing)
        Object.assign(existing, {
          lines: value.lines,
          productId: value.productId,
          version: value.version || '1.0',
          active: value.active !== false,
        });
      else
        db.boms.push({
          ...value,
          id: nextId(
            'BOM',
            db.boms.map((b) => b.id),
          ),
          createdAt: at,
          version: value.version || '1.0',
          active: value.active !== false,
        });
      break;
    }
    case 'set-bom-active': {
      requirePermission(actor, 'boms', 'update');
      const bom = db.boms.find((b) => b.id === command.payload.id);
      if (!bom) throw new Error('Không tìm thấy BOM.');
      if (command.payload.active)
        for (const other of db.boms) if (other.productId === bom.productId) other.active = false;
      bom.active = command.payload.active;
      break;
    }
    case 'delete-catalog': {
      const { kind, id } = command.payload;
      requirePermission(actor, kind, 'delete');
      if (kind === 'boms') {
        const bom = db.boms.find((b) => b.id === id);
        if (bom && bomLocked(db, bom.productId, bom.id))
          throw new Error('BOM đang được sử dụng, không thể xóa.');
        db.boms = db.boms.filter((b) => b.id !== id);
      } else {
        const item = db[kind].find((row) => row.id === id);
        if (
          item?.stock ||
          db.documents.some((d) => d.lines.some((l) => l.itemId === id)) ||
          db.boms.some((b) => b.productId === id || b.lines.some((l) => l.materialId === id)) ||
          db.orders.some((o) => o.items.some((i) => i.productId === id)) ||
          db.movements.some((m) => m.itemId === id)
        )
          throw new Error('Danh mục có tồn hoặc dữ liệu liên quan nên không thể xóa.');
        if (kind === 'materials') db.materials = db.materials.filter((m) => m.id !== id);
        else db.products = db.products.filter((p) => p.id !== id);
      }
      break;
    }
    case 'save-order': {
      const value = command.payload;
      const existing = db.orders.find((row) => row.id === value.id);
      requirePermission(actor, 'orders', existing ? 'update' : 'create');
      if (
        existing &&
        (existing.status !== 'pending' ||
          db.documents.some((d) => d.orderId === existing.id && d.status !== 'rejected'))
      )
        throw new Error('Chỉ sửa lệnh chờ xử lý chưa có chứng từ liên quan.');
      if (!db.users.some((u) => u.id === value.assignedTo && u.role === 'employee' && u.active))
        throw new Error('Vui lòng chọn nhân viên đang hoạt động.');
      uniqueLines(value.items.map((i) => ({ itemId: i.productId, quantity: i.target })));
      if (value.items.some((i) => !Number.isInteger(i.target)))
        throw new Error('Số lượng mục tiêu phải là số nguyên dương.');
      if (!value.dueDate) throw new Error('Vui lòng chọn ngày cần hoàn thành.');
      const requirements = calculateRequirements(db, value.items);
      const id =
        existing?.id ||
        nextId(
          'PO',
          db.orders.map((o) => o.id),
        );
      if (existing)
        Object.assign(existing, {
          items: value.items.map((i) => ({ ...i, completed: 0 })),
          assignedTo: value.assignedTo,
          note: value.note,
          dueDate: value.dueDate,
          requirements,
          timeline: [...existing.timeline, { title: 'Cập nhật lệnh', actor: actor.name, at }],
        });
      else
        db.orders.unshift({
          ...value,
          id,
          status: 'pending',
          createdBy: actor.id,
          createdAt: at,
          requirements,
          timeline: [{ title: 'Tạo lệnh và giao nhân viên', actor: actor.name, at }],
        });
      notify(
        db,
        `Bạn được giao lệnh ${id}`,
        'Xem nhu cầu nguyên liệu và các bước tiếp theo.',
        `/app/orders/${id}`,
        { userId: value.assignedTo },
      );
      break;
    }
    case 'order-action': {
      const { id, action, quantities } = command.payload;
      requirePermission(actor, 'orders', action);
      const order = db.orders.find((o) => o.id === id);
      if (!order) throw new Error('Lệnh không còn tồn tại.');
      if (actor.role === 'employee' && order.assignedTo !== actor.id)
        throw new Error('Bạn không được giao lệnh này.');
      if (action === 'start') {
        if (!canStartOrder(db, order))
          throw new Error('Chưa xuất đủ nguyên liệu được duyệt hoặc lệnh không còn chờ xử lý.');
        order.status = 'in_progress';
      }
      if (action === 'cancel') {
        if (!canCancelOrder(db, order))
          throw new Error('Chỉ hủy lệnh chờ xử lý chưa xuất NVL được duyệt. Chưa hỗ trợ hoàn trả.');
        if (db.documents.some((d) => d.orderId === id && d.status === 'pending'))
          throw new Error('Cần từ chối các phiếu đang chờ của lệnh trước khi hủy.');
        order.status = 'cancelled';
      }
      if (action === 'progress' || action === 'complete') {
        if (order.status !== 'in_progress') throw new Error('Chỉ cập nhật lệnh đang sản xuất.');
        if (action === 'progress')
          order.items.forEach((item) => {
            const quantity = quantities?.[item.productId];
            if (
              quantity === undefined ||
              !Number.isInteger(quantity) ||
              quantity < 0 ||
              quantity > item.target
            )
              throw new Error('Số lượng hoàn thành phải từ 0 đến mục tiêu và là số nguyên.');
            item.completed = quantity;
          });
        if (action === 'complete') {
          if (!order.items.some((i) => i.completed > 0))
            throw new Error('Cần cập nhật ít nhất một thành phẩm lớn hơn 0 trước khi hoàn thành.');
          order.items.forEach((item) => {
            if (item.completed > 0) move(db, item.productId, 'product', item.completed, order.id);
          });
          order.status = 'completed';
        }
      }
      order.timeline.push({
        title: {
          start: 'Bắt đầu sản xuất',
          cancel: 'Hủy lệnh',
          progress: 'Cập nhật tiến độ',
          complete: 'Hoàn thành và nhập kho thành phẩm',
        }[action],
        actor: actor.name,
        at,
      });
      if (action === 'complete')
        notify(
          db,
          `Lệnh ${id} đã hoàn thành`,
          'Thành phẩm đã được nhập kho theo số lượng thực tế.',
          `/app/orders/${id}`,
          { role: 'manager' },
        );
      break;
    }
    case 'save-document': {
      const value = command.payload;
      const existing = db.documents.find((d) => d.id === value.id);
      if (!existing && value.kind === 'product-issues' && value.orderId)
        throw new Error('Chỉ tạo phiếu xuất thành phẩm từ kho, không tạo từ lệnh sản xuất.');
      requirePermission(actor, value.kind, existing ? 'update' : 'create');
      if (
        existing &&
        (existing.kind !== value.kind ||
          (existing.kind === 'receipts'
            ? existing.status !== 'draft'
            : existing.status !== 'pending'))
      )
        throw new Error('Phiếu đã được xử lý, không thể chỉnh sửa.');
      if (existing && actor.role === 'employee' && existing.createdBy !== actor.id)
        throw new Error('Chỉ sửa phiếu do bạn tạo.');
      if (
        existing &&
        (existing.orderId !== value.orderId ||
          existing.requestId !== value.requestId ||
          existing.source !== value.source)
      )
        throw new Error('Không thể thay đổi nguồn chứng từ.');
      uniqueLines(value.lines);
      const items = value.kind === 'product-issues' ? db.products : db.materials;
      if (value.lines.some((l) => !items.some((item) => item.id === l.itemId)))
        throw new Error('Vật tư không tồn tại.');
      if (value.orderId) {
        const order = db.orders.find((o) => o.id === value.orderId);
        if (!order || (actor.role === 'employee' && order.assignedTo !== actor.id))
          throw new Error('Bạn không được giao lệnh nguồn.');
        if (['requests', 'material-issues'].includes(value.kind) && order.status !== 'pending')
          throw new Error('Lệnh nguồn không còn chờ xử lý.');
        if (value.kind === 'product-issues' && order.status !== 'completed')
          throw new Error('Chỉ xuất TP từ lệnh đã hoàn thành.');
        if (
          value.kind === 'product-issues' &&
          value.lines.some((line) => !order.items.some((i) => i.productId === line.itemId))
        )
          throw new Error('Thành phẩm không thuộc lệnh nguồn.');
        if (
          value.kind === 'requests' &&
          value.lines.some((line) => !order.requirements.some((i) => i.materialId === line.itemId))
        )
          throw new Error('Nguyên liệu không thuộc BOM của lệnh.');
      }
      if (value.kind === 'material-issues') validateIssue(db, value);
      if (value.kind === 'requests') {
        const order = db.orders.find((o) => o.id === value.orderId);
        const shortage = value.lines.some((line) => {
          const material = db.materials.find((m) => m.id === line.itemId)!;
          const need = order
            ? order.requirements.find((n) => n.materialId === line.itemId)?.quantity || 0
            : material.minStock;
          return need > material.stock;
        });
        if (!shortage) throw new Error('Không được tạo phiếu bổ sung khi NVL còn đủ.');
      }
      if (value.kind === 'product-issues')
        value.lines.forEach((line) => {
          if ((db.products.find((p) => p.id === line.itemId)?.stock || 0) + EPSILON < line.quantity)
            throw new Error('Số lượng xuất vượt tồn thành phẩm.');
        });
      if (value.kind === 'receipts') {
        const request = db.documents.find((d) => d.id === value.requestId && d.kind === 'requests');
        if (!request || request.status !== 'approved')
          throw new Error('Chỉ tạo nhập kho từ phiếu bổ sung đã duyệt.');
        if (
          db.documents.some(
            (d) => d.kind === 'receipts' && d.requestId === request.id && d.id !== value.id,
          )
        )
          throw new Error('Phiếu bổ sung đã có phiếu nhập.');
        if (
          value.lines.length !== request.lines.length ||
          value.lines.some((l) => !request.lines.some((r) => r.itemId === l.itemId))
        )
          throw new Error('Danh sách nguyên liệu phải khớp phiếu bổ sung.');
        if (!value.receiptDate || value.receiptDate > today())
          throw new Error('Ngày nhập hàng không hợp lệ hoặc ở tương lai.');
        if (!value.supplier.trim()) throw new Error('Vui lòng nhập nhà cung cấp.');
        value.lines.forEach((line) => {
          if (line.quantity + EPSILON < receiptMinimum(db, request, line.itemId))
            throw new Error('Lượng nhận nhỏ hơn mức tối thiểu cần thiết.');
        });
      }
      const prefixes = {
        requests: 'MR',
        receipts: 'RN',
        'material-issues': 'MI',
        'product-issues': 'PI',
      };
      if (existing) {
        Object.assign(existing, {
          lines: value.lines,
          supplier: value.supplier,
          receiptDate: value.receiptDate,
          note: value.note,
        });
        existing.timeline.push({ title: 'Chỉnh sửa phiếu', actor: actor.name, at });
      } else {
        const id = nextId(
          prefixes[value.kind],
          db.documents.map((d) => d.id),
        );
        db.documents.unshift({
          ...value,
          id,
          status: value.kind === 'receipts' ? 'draft' : 'pending',
          createdBy: actor.id,
          createdAt: at,
          timeline: [
            {
              title: value.kind === 'receipts' ? 'Tạo phiếu nhập nháp' : 'Gửi phiếu chờ duyệt',
              actor: actor.name,
              at,
            },
          ],
        });
        if (value.kind !== 'receipts')
          notify(
            db,
            `Phiếu ${id} chờ duyệt`,
            `${actor.name} vừa gửi phiếu mới.`,
            `/app/${value.kind}/${id}`,
            { role: 'manager' },
          );
      }
      break;
    }
    case 'delete-document': {
      const doc = db.documents.find((d) => d.id === command.payload);
      if (!doc) throw new Error('Phiếu không tồn tại.');
      requirePermission(actor, doc.kind, 'delete');
      if (
        doc.kind === 'receipts'
          ? doc.status !== 'draft'
          : doc.status !== 'pending' || doc.createdBy !== actor.id
      )
        throw new Error('Không được xóa phiếu đã xử lý hoặc của người khác.');
      db.documents = db.documents.filter((d) => d.id !== doc.id);
      break;
    }
    case 'document-action': {
      const { id, action, reason } = command.payload;
      const doc = db.documents.find((d) => d.id === id);
      if (!doc) throw new Error('Phiếu không tồn tại.');
      requirePermission(actor, doc.kind, action === 'submit' ? 'update' : action);
      if (action === 'approve' || action === 'reject') {
        if (doc.status !== 'pending' || doc.kind === 'receipts')
          throw new Error('Phiếu không còn chờ duyệt.');
        if (action === 'reject' && !reason?.trim()) throw new Error('Vui lòng nhập lý do từ chối.');
        if (action === 'approve') {
          if (
            doc.orderId &&
            ['requests', 'material-issues'].includes(doc.kind) &&
            db.orders.find((o) => o.id === doc.orderId)?.status !== 'pending'
          )
            throw new Error('Lệnh nguồn không còn chờ xử lý.');
          if (doc.kind === 'material-issues') {
            validateIssue(db, doc);
            doc.lines.forEach((line) => move(db, line.itemId, 'material', -line.quantity, id));
          }
          if (doc.kind === 'product-issues')
            doc.lines.forEach((line) => move(db, line.itemId, 'product', -line.quantity, id));
        }
        doc.status = action === 'approve' ? 'approved' : 'rejected';
        doc.reviewedAt = at;
        doc.reviewedBy = actor.id;
        doc.rejectionReason = action === 'reject' ? reason?.trim() : undefined;
        notify(
          db,
          `Phiếu ${id} ${action === 'approve' ? 'đã duyệt' : 'bị từ chối'}`,
          reason || 'Mở phiếu để xem chi tiết.',
          `/app/${doc.kind}/${id}`,
          { userId: doc.createdBy },
        );
      }
      if (action === 'submit') {
        if (doc.kind !== 'receipts' || doc.status !== 'draft')
          throw new Error('Chỉ chuyển phiếu nhập nháp sang chờ hoàn tất.');
        doc.status = 'pending';
      }
      if (action === 'complete') {
        if (doc.kind !== 'receipts' || doc.status !== 'pending')
          throw new Error('Chỉ hoàn tất phiếu nhập đang chờ hoàn tất.');
        const request = db.documents.find((d) => d.id === doc.requestId);
        if (!request || request.status !== 'approved')
          throw new Error('Phiếu bổ sung nguồn không hợp lệ.');
        for (const line of doc.lines) {
          if (line.quantity + EPSILON < receiptMinimum(db, request, line.itemId))
            throw new Error(
              'Nhu cầu đã thay đổi. Lượng nhận không đạt mức tối thiểu; cần xử lý phiếu nguồn trước.',
            );
          move(db, line.itemId, 'material', line.quantity, id, doc.receiptDate);
        }
        doc.status = 'completed';
        request.status = 'fulfilled';
        request.timeline.push({ title: `Đã hoàn tất từ phiếu nhập ${id}`, actor: actor.name, at });
        notify(
          db,
          `Phiếu ${request.id} đã được nhập kho`,
          `Xem phiếu bổ sung để tiếp tục sản xuất.`,
          `/app/requests/${request.id}`,
          { userId: request.createdBy },
        );
      }
      doc.timeline.push({
        title: {
          approve: 'Duyệt phiếu',
          reject: 'Từ chối phiếu',
          submit: 'Chuyển chờ hoàn tất',
          complete: 'Hoàn tất nhập kho',
        }[action],
        actor: actor.name,
        at,
        note: reason,
      });
      break;
    }
    case 'read-notification': {
      requirePermission(actor, 'notifications', 'read');
      db.notifications
        .filter((n) => command.payload === 'all' || n.id === command.payload)
        .filter((n) => n.userId === actor.id || n.role === actor.role)
        .forEach((n) => {
          if (!n.readBy.includes(actor.id)) n.readBy.push(actor.id);
        });
      break;
    }
  }
  return db;
}
export function executeMockCommand(command: Command, session: Session) {
  writeDatabase(applyCommand(readDatabase(), command, session));
}
