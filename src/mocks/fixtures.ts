import type { Database } from '../shared/domain/types';
import { today } from '../shared/domain/format';

export function createSeed(): Database {
  const day = today();
  const at = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const db: Database = {
    users: [
      {
        id: 'u-admin',
        name: 'Hoàng Anh',
        email: 'admin@bloom.local',
        role: 'admin',
        active: true,
        createdAt: at,
      },
      {
        id: 'u-manager',
        name: 'Minh Nguyễn',
        email: 'minh@bloom.local',
        role: 'manager',
        active: true,
        createdAt: at,
      },
      {
        id: 'u-lan',
        name: 'Lan Trần',
        email: 'lan@bloom.local',
        role: 'employee',
        active: true,
        createdAt: at,
      },
      {
        id: 'u-huy',
        name: 'Huy Phạm',
        email: 'huy@bloom.local',
        role: 'employee',
        active: true,
        createdAt: at,
      },
    ],
    materials: [
      { id: 'NVL001', name: 'Bột mì số 13', unit: 'kg', stock: 12, minStock: 25, createdAt: at },
      { id: 'NVL002', name: 'Bơ lạt Anchor', unit: 'kg', stock: 3, minStock: 10, createdAt: at },
      { id: 'NVL003', name: 'Đường cát trắng', unit: 'kg', stock: 32, minStock: 15, createdAt: at },
      {
        id: 'NVL004',
        name: 'Sữa tươi không đường',
        unit: 'lít',
        stock: 8,
        minStock: 20,
        createdAt: at,
      },
      { id: 'NVL005', name: 'Trứng gà', unit: 'quả', stock: 180, minStock: 100, createdAt: at },
      { id: 'NVL006', name: 'Men nở instant', unit: 'kg', stock: 2.5, minStock: 2, createdAt: at },
      { id: 'NVL007', name: 'Muối tinh', unit: 'kg', stock: 6, minStock: 2, createdAt: at },
      { id: 'NVL008', name: 'Chocolate đen 70%', unit: 'kg', stock: 4, minStock: 8, createdAt: at },
    ],
    products: [
      { id: 'TP001', name: 'Croissant bơ Pháp', unit: 'cái', stock: 80, image: '', createdAt: at },
      {
        id: 'TP002',
        name: 'Bánh mì truyền thống',
        unit: 'cái',
        stock: 120,
        image: '',
        createdAt: at,
      },
      {
        id: 'TP003',
        name: 'Bánh cuộn chocolate',
        unit: 'cái',
        stock: 45,
        image: '',
        createdAt: at,
      },
      { id: 'TP004', name: 'Brioche sữa tươi', unit: 'cái', stock: 30, image: '', createdAt: at },
    ],
    boms: [
      {
        id: 'BOM001',
        productId: 'TP001',
        lines: [
          { materialId: 'NVL001', quantity: 0.08 },
          { materialId: 'NVL002', quantity: 0.035 },
          { materialId: 'NVL003', quantity: 0.012 },
        ],
        createdAt: at,
      },
      {
        id: 'BOM002',
        productId: 'TP002',
        lines: [
          { materialId: 'NVL001', quantity: 0.1 },
          { materialId: 'NVL006', quantity: 0.002 },
          { materialId: 'NVL007', quantity: 0.002 },
        ],
        createdAt: at,
      },
      {
        id: 'BOM003',
        productId: 'TP003',
        lines: [
          { materialId: 'NVL001', quantity: 0.07 },
          { materialId: 'NVL008', quantity: 0.025 },
          { materialId: 'NVL002', quantity: 0.02 },
        ],
        createdAt: at,
      },
      {
        id: 'BOM004',
        productId: 'TP004',
        lines: [
          { materialId: 'NVL001', quantity: 0.06 },
          { materialId: 'NVL004', quantity: 0.04 },
          { materialId: 'NVL005', quantity: 0.25 },
        ],
        createdAt: at,
      },
    ],
    orders: [
      {
        id: 'PO024',
        items: [
          { productId: 'TP001', target: 200, completed: 0 },
          { productId: 'TP002', target: 100, completed: 0 },
        ],
        assignedTo: 'u-lan',
        createdBy: 'u-manager',
        createdAt: at,
        dueDate: day,
        note: 'Chuẩn bị mẻ bánh cho quầy buổi chiều.',
        status: 'pending',
        requirements: [
          { materialId: 'NVL001', quantity: 26 },
          { materialId: 'NVL002', quantity: 7 },
          { materialId: 'NVL003', quantity: 2.4 },
          { materialId: 'NVL006', quantity: 0.2 },
          { materialId: 'NVL007', quantity: 0.2 },
        ],
        timeline: [{ title: 'Tạo lệnh và giao cho Lan Trần', actor: 'Minh Nguyễn', at }],
      },
      {
        id: 'PO023',
        items: [{ productId: 'TP003', target: 100, completed: 60 }],
        assignedTo: 'u-huy',
        createdBy: 'u-manager',
        createdAt: at,
        dueDate: day,
        note: 'Mẻ bánh buổi sáng.',
        status: 'in_progress',
        requirements: [
          { materialId: 'NVL001', quantity: 7 },
          { materialId: 'NVL008', quantity: 2.5 },
          { materialId: 'NVL002', quantity: 2 },
        ],
        timeline: [
          { title: 'Tạo lệnh', actor: 'Minh Nguyễn', at },
          { title: 'Bắt đầu sản xuất', actor: 'Huy Phạm', at },
        ],
      },
      {
        id: 'PO022',
        items: [{ productId: 'TP002', target: 150, completed: 145 }],
        assignedTo: 'u-lan',
        createdBy: 'u-manager',
        createdAt: at,
        dueDate: day,
        note: '',
        status: 'completed',
        requirements: [
          { materialId: 'NVL001', quantity: 15 },
          { materialId: 'NVL006', quantity: 0.3 },
          { materialId: 'NVL007', quantity: 0.3 },
        ],
        timeline: [{ title: 'Hoàn thành · 145 bánh mì', actor: 'Lan Trần', at }],
      },
    ],
    documents: [
      {
        id: 'BS018',
        kind: 'requests',
        status: 'pending',
        orderId: 'PO024',
        source: 'order',
        createdBy: 'u-lan',
        createdAt: at,
        lines: [
          { itemId: 'NVL001', quantity: 14, minimum: 14 },
          { itemId: 'NVL002', quantity: 4, minimum: 4 },
        ],
        supplier: '',
        receiptDate: '',
        note: 'Bổ sung cho mẻ bánh buổi chiều.',
        timeline: [{ title: 'Gửi yêu cầu bổ sung', actor: 'Lan Trần', at }],
      },
      {
        id: 'XN017',
        kind: 'material-issues',
        status: 'approved',
        orderId: 'PO023',
        createdBy: 'u-huy',
        createdAt: at,
        reviewedAt: at,
        reviewedBy: 'u-manager',
        lines: [
          { itemId: 'NVL001', quantity: 7 },
          { itemId: 'NVL008', quantity: 2.5 },
          { itemId: 'NVL002', quantity: 2 },
        ],
        supplier: '',
        receiptDate: '',
        note: '',
        timeline: [{ title: 'Duyệt xuất nguyên liệu', actor: 'Minh Nguyễn', at }],
      },
      {
        id: 'XT009',
        kind: 'product-issues',
        status: 'pending',
        orderId: 'PO022',
        createdBy: 'u-lan',
        createdAt: at,
        lines: [{ itemId: 'TP002', quantity: 40 }],
        supplier: '',
        receiptDate: '',
        note: 'Xuất cho quầy bán hàng.',
        timeline: [{ title: 'Gửi phiếu xuất thành phẩm', actor: 'Lan Trần', at }],
      },
    ],
    movements: [],
    openingStock: {},
    notifications: [
      {
        id: 'n1',
        role: 'manager',
        title: 'Có phiếu bổ sung cần duyệt',
        body: 'Lan Trần gửi BS018 cho lệnh PO024.',
        href: '/app/requests/BS018',
        createdAt: at,
        readBy: [],
      },
      {
        id: 'n2',
        userId: 'u-lan',
        title: 'Bạn được giao lệnh PO024',
        body: 'Croissant bơ Pháp và bánh mì truyền thống.',
        href: '/app/orders/PO024',
        createdAt: at,
        readBy: [],
      },
    ],
  };
  // Deterministic report history. Opening balances reconcile with the visible current stock.
  for (let offset = 14; offset >= 1; offset--) {
    const timestamp = new Date(`${day}T00:00:00+07:00`);
    timestamp.setUTCDate(timestamp.getUTCDate() - offset);
    const historyDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(timestamp);
    const variation = offset % 4;
    for (const [itemId, incoming, outgoing] of [
      ['NVL001', 10, 12 + variation],
      ['NVL002', 3, 3.5 + variation / 10],
      ['NVL003', 4, 4.5 + variation / 5],
    ] as const) {
      db.movements.push(
        {
          id: `history-in-${offset}-${itemId}`,
          itemId,
          itemType: 'material',
          delta: incoming,
          date: historyDay,
          reference: `DEMO-IN-${offset}`,
        },
        {
          id: `history-out-${offset}-${itemId}`,
          itemId,
          itemType: 'material',
          delta: -outgoing,
          date: historyDay,
          reference: `DEMO-OUT-${offset}`,
        },
      );
    }
    db.movements.push(
      {
        id: `history-product-in-${offset}`,
        itemId: 'TP001',
        itemType: 'product',
        delta: 80 + variation * 5,
        date: historyDay,
        reference: `DEMO-PO-${offset}`,
      },
      {
        id: `history-product-out-${offset}`,
        itemId: 'TP001',
        itemType: 'product',
        delta: -(90 + variation * 5),
        date: historyDay,
        reference: `DEMO-XT-${offset}`,
      },
      {
        id: `history-bread-in-${offset}`,
        itemId: 'TP002',
        itemType: 'product',
        delta: 100,
        date: historyDay,
        reference: `DEMO-BREAD-IN-${offset}`,
      },
      {
        id: `history-bread-out-${offset}`,
        itemId: 'TP002',
        itemType: 'product',
        delta: -110,
        date: historyDay,
        reference: `DEMO-BREAD-OUT-${offset}`,
      },
    );
  }
  // Posted seed documents and completed orders must also contribute to reports.
  for (const doc of db.documents.filter(
    (doc) => doc.status === 'approved' && ['material-issues', 'product-issues'].includes(doc.kind),
  )) {
    for (const line of doc.lines)
      db.movements.push({
        id: `seed-${doc.id}-${line.itemId}`,
        itemId: line.itemId,
        itemType: doc.kind === 'product-issues' ? 'product' : 'material',
        delta: -line.quantity,
        date: day,
        reference: doc.id,
      });
  }
  for (const order of db.orders.filter((order) => order.status === 'completed')) {
    for (const item of order.items.filter((item) => item.completed > 0))
      db.movements.push({
        id: `seed-${order.id}-${item.productId}`,
        itemId: item.productId,
        itemType: 'product',
        delta: item.completed,
        date: day,
        reference: order.id,
      });
  }
  db.openingStock = Object.fromEntries(
    [...db.materials, ...db.products].map((item) => [
      item.id,
      Math.round(
        (item.stock -
          db.movements.filter((m) => m.itemId === item.id).reduce((sum, m) => sum + m.delta, 0)) *
          1e6,
      ) / 1e6,
    ]),
  );
  for(const bom of db.boms){bom.version='1.0';bom.active=true;}
  for(const order of db.orders)for(const item of order.items)item.bomId=db.boms.find((bom)=>bom.productId===item.productId)?.id;
  return db;
}
