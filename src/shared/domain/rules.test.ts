import { describe, expect, it } from 'vitest';
import { createSeed } from '../../mocks/fixtures';
import { applyCommand } from '../../mocks/commands';
import { can } from './permissions';
import { canStartOrder } from './rules';
import type { Database, StockDocument } from './types';

const manager = { userId: 'u-manager' },
  employee = { userId: 'u-lan' },
  admin = { userId: 'u-admin' };
function receipt(db: Database): StockDocument {
  const request = db.documents[0];
  return {
    ...request,
    id: '',
    kind: 'receipts',
    requestId: request.id,
    supplier: 'NCC Bột Việt',
    receiptDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    lines: request.lines.map((l) => ({ ...l })),
    timeline: [],
  };
}

describe('Phân quyền và khóa dữ liệu', () => {
  it('Manager tạo BOM mới cho thành phẩm chưa có định mức và không tạo trùng', () => {
    let db = applyCommand(
      createSeed(),
      {
        type: 'save-product',
        payload: {
          id: '',
          name: 'Bánh hạnh nhân',
          unit: 'cái',
          stock: 0,
          image: '',
          createdAt: '',
        },
      },
      manager,
    );
    const product = db.products.at(-1)!;
    const bom = {
      id: '',
      productId: product.id,
      lines: [{ materialId: 'NVL001', quantity: 0.08 }],
      createdAt: '',
    };
    db = applyCommand(db, { type: 'save-bom', payload: bom }, manager);
    expect(db.boms.find((b) => b.productId === product.id)?.lines).toEqual(bom.lines);
    expect(() => applyCommand(db, { type: 'save-bom', payload: bom }, manager)).toThrow(
      'không được nhập trùng tên phiên bản trước đó',
    );
    expect(() =>
      applyCommand(
        db,
        {
          type: 'save-bom',
          payload: { ...bom, version: '2.0', lines: [{ materialId: 'NVL001', quantity: 0.08 }] },
        },
        manager,
      ),
    ).toThrow('không được tạo 1 phiên bản mới trùng với phiên bản đã có');
  });
  it('Phiếu xuất TP mới chỉ lấy từ kho, không gắn lệnh hoàn thành', () => {
    const db = createSeed();
    const legacy = db.documents.find((doc) => doc.kind === 'product-issues')!;
    const draft = { ...legacy, id: '' };
    expect(() => applyCommand(db, { type: 'save-document', payload: draft }, employee)).toThrow(
      'Chỉ tạo phiếu xuất thành phẩm từ kho',
    );
    const next = applyCommand(
      db,
      { type: 'save-document', payload: { ...draft, orderId: undefined } },
      employee,
    );
    expect(next.documents[0].orderId).toBeUndefined();
    expect(next.documents[0].status).toBe('pending');
    expect(next.products.find((p) => p.id === 'TP002')?.stock).toBe(120);
  });
  it('CRUD danh mục và tài khoản mới không tự tạo tồn hoặc mất tham chiếu', () => {
    let db = applyCommand(
      createSeed(),
      {
        type: 'save-material',
        payload: {
          id: '',
          name: 'Bột hạnh nhân',
          unit: 'kg',
          minStock: 5,
          stock: 100,
          createdAt: '',
        },
      },
      manager,
    );
    const material = db.materials.at(-1)!;
    expect(material.stock).toBe(0);
    db = applyCommand(
      db,
      { type: 'save-material', payload: { ...material, name: 'Bột hạnh nhân mịn', stock: 99 } },
      manager,
    );
    expect(db.materials.at(-1)?.stock).toBe(0);
    db = applyCommand(
      db,
      { type: 'delete-catalog', payload: { kind: 'materials', id: material.id } },
      manager,
    );
    expect(db.materials.some((m) => m.id === material.id)).toBe(false);
    db = applyCommand(
      db,
      {
        type: 'save-user',
        payload: {
          id: '',
          name: 'Nhân viên thử',
          email: 'test@bloom.local',
          role: 'employee',
          active: true,
          createdAt: '',
        },
      },
      admin,
    );
    const user = db.users.at(-1)!;
    expect(user.id).toBeTruthy();
    db = applyCommand(db, { type: 'delete-user', payload: user.id }, admin);
    expect(db.users.some((u) => u.id === user.id)).toBe(false);
  });
  it('Employee không sửa phiếu của người khác và không thao tác lệnh không được giao', () => {
    const db = createSeed();
    expect(() =>
      applyCommand(db, { type: 'save-document', payload: db.documents[0] }, { userId: 'u-huy' }),
    ).toThrow('do bạn tạo');
    expect(() =>
      applyCommand(
        db,
        {
          type: 'order-action',
          payload: { id: 'PO023', action: 'progress', quantities: { TP003: 100 } },
        },
        employee,
      ),
    ).toThrow('không được giao');
  });
  it('Ngày nhập tương lai và tiến độ vượt mục tiêu bị chặn', () => {
    const db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    const input = receipt(db);
    input.receiptDate = '2099-01-01';
    expect(() => applyCommand(db, { type: 'save-document', payload: input }, manager)).toThrow(
      'tương lai',
    );
    expect(() =>
      applyCommand(
        db,
        {
          type: 'order-action',
          payload: { id: 'PO023', action: 'progress', quantities: { TP003: 101 } },
        },
        { userId: 'u-huy' },
      ),
    ).toThrow('mục tiêu');
  });
  it('Admin chỉ xem nghiệp vụ, Employee không duyệt và Manager không quản trị tài khoản', () => {
    expect(can('admin', 'materials', 'update')).toBe(false);
    expect(can('admin', 'orders', 'read')).toBe(true);
    expect(can('employee', 'requests', 'approve')).toBe(false);
    expect(can('manager', 'users', 'create')).toBe(false);
  });
  it('Chặn thao tác trái quyền ngay tại repository', () => {
    expect(() =>
      applyCommand(
        createSeed(),
        { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
        employee,
      ),
    ).toThrow('quyền');
  });
  it('Không để Admin tự khóa hoặc tự mất quyền', () => {
    const db = createSeed();
    expect(() =>
      applyCommand(db, { type: 'save-user', payload: { ...db.users[0], active: false } }, admin),
    ).toThrow('tự khóa');
  });
  it('BOM đang được dùng không thể sửa', () => {
    const db = createSeed();
    expect(() => applyCommand(db, { type: 'save-bom', payload: db.boms[0] }, manager)).toThrow(
      'BOM đang',
    );
  });
});

describe('Giao dịch và điều kiện nghiệp vụ', () => {
  it('Chạy toàn bộ bổ sung → nhập → xuất → sản xuất → xuất TP và không nhập TP hai lần', () => {
    let db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    db = applyCommand(db, { type: 'save-document', payload: receipt(db) }, manager);
    const receiptId = db.documents[0].id;
    db = applyCommand(
      db,
      { type: 'document-action', payload: { id: receiptId, action: 'submit' } },
      manager,
    );
    db = applyCommand(
      db,
      { type: 'document-action', payload: { id: receiptId, action: 'complete' } },
      manager,
    );
    const order = db.orders.find((o) => o.id === 'PO024')!;
    const issue: StockDocument = {
      ...db.documents[0],
      id: '',
      kind: 'material-issues',
      requestId: undefined,
      orderId: order.id,
      lines: order.requirements.map((l) => ({ itemId: l.materialId, quantity: l.quantity })),
    };
    db = applyCommand(db, { type: 'save-document', payload: issue }, employee);
    const issueId = db.documents[0].id;
    expect(canStartOrder(db, db.orders[0])).toBe(false);
    db = applyCommand(
      db,
      { type: 'document-action', payload: { id: issueId, action: 'approve' } },
      manager,
    );
    expect(canStartOrder(db, db.orders[0])).toBe(true);
    db = applyCommand(
      db,
      { type: 'order-action', payload: { id: order.id, action: 'start' } },
      employee,
    );
    db = applyCommand(
      db,
      {
        type: 'order-action',
        payload: { id: order.id, action: 'progress', quantities: { TP001: 190, TP002: 95 } },
      },
      employee,
    );
    db = applyCommand(
      db,
      { type: 'order-action', payload: { id: order.id, action: 'complete' } },
      employee,
    );
    expect(db.products[0].stock).toBe(270);
    expect(() =>
      applyCommand(
        db,
        { type: 'order-action', payload: { id: order.id, action: 'complete' } },
        employee,
      ),
    ).toThrow();
    db = applyCommand(
      db,
      {
        type: 'save-document',
        payload: {
          ...issue,
          id: '',
          kind: 'product-issues',
          orderId: undefined,
          lines: [{ itemId: 'TP001', quantity: 30 }],
        },
      },
      employee,
    );
    const productIssueId = db.documents[0].id;
    db = applyCommand(
      db,
      { type: 'document-action', payload: { id: productIssueId, action: 'approve' } },
      manager,
    );
    expect(db.products[0].stock).toBe(240);
    expect(db.materials[0].stock).toBe(0);
  });
  it('Mỗi lệnh chỉ có một phiếu xuất NVL chờ duyệt hoặc đã duyệt', () => {
    const db = createSeed();
    db.materials.forEach((material) => { material.stock = 100; });
    const issue: StockDocument = {
      ...db.documents[0],
      id: '',
      kind: 'material-issues',
      orderId: 'PO024',
      lines: db.orders.find((order) => order.id === 'PO024')!.requirements.map((line) => ({ itemId: line.materialId, quantity: line.quantity })),
    };
    const next = applyCommand(db, { type: 'save-document', payload: issue }, employee);
    expect(() =>
      applyCommand(
        next,
        {
          type: 'save-document',
          payload: issue,
        },
        employee,
      ),
    ).toThrow('một lần');
    const approved = applyCommand(next, { type: 'document-action', payload: { id: next.documents[0].id, action: 'approve' } }, manager);
    expect(() => applyCommand(approved, { type: 'save-document', payload: issue }, employee)).toThrow('một lần');
  });
  it('Không cho thiếu dòng hoặc xuất một phần nhu cầu BOM', () => {
    const db = createSeed();
    db.materials.forEach((material) => { material.stock = 100; });
    const issue: StockDocument = { ...db.documents[0], id: '', kind: 'material-issues', orderId: 'PO024', lines: db.orders[0].requirements.map((line) => ({ itemId: line.materialId, quantity: line.quantity })) };
    expect(() => applyCommand(db, { type: 'save-document', payload: { ...issue, lines: issue.lines.slice(1) } }, employee)).toThrow('đầy đủ');
    issue.lines[0].quantity -= 1;
    expect(() => applyCommand(db, { type: 'save-document', payload: issue }, employee)).toThrow('nhu cầu BOM');
  });
  it('Phiếu từ chối cho phép tạo lại, phiếu mới vẫn phải đủ BOM', () => {
    const db = createSeed();
    db.materials.forEach((material) => { material.stock = 100; });
    const issue: StockDocument = { ...db.documents[0], id: '', kind: 'material-issues', orderId: 'PO024', lines: db.orders[0].requirements.map((line) => ({ itemId: line.materialId, quantity: line.quantity })) };
    const pending = applyCommand(db, { type: 'save-document', payload: issue }, employee);
    const rejected = applyCommand(pending, { type: 'document-action', payload: { id: pending.documents[0].id, action: 'reject', reason: 'Cần tạo lại phiếu' } }, manager);
    const replacement = applyCommand(rejected, { type: 'save-document', payload: issue }, employee);
    expect(replacement.documents.filter((doc) => doc.kind === 'material-issues' && doc.orderId === 'PO024' && doc.status === 'pending')).toHaveLength(1);
  });
  it('Cho nhận khác số yêu cầu nếu đạt tối thiểu; ngày nhập hàng được giữ', () => {
    const db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    const input = receipt(db);
    input.lines[0].quantity = 20;
    input.receiptDate = '2026-01-01';
    const next = applyCommand(db, { type: 'save-document', payload: input }, manager);
    expect(next.documents[0].lines[0].quantity).toBe(20);
    expect(next.documents[0].receiptDate).toBe('2026-01-01');
    input.lines[0].quantity = 1;
    expect(() => applyCommand(db, { type: 'save-document', payload: input }, manager)).toThrow(
      'tối thiểu',
    );
  });
  it('Tồn kho đủ không đồng nghĩa với đủ nguyên liệu đã xuất', () => {
    const db = createSeed();
    db.materials.forEach((m) => {
      m.stock = 1000;
    });
    expect(canStartOrder(db, db.orders[0])).toBe(false);
    expect(() =>
      applyCommand(
        db,
        { type: 'order-action', payload: { id: 'PO024', action: 'start' } },
        employee,
      ),
    ).toThrow('Chưa xuất đủ');
  });
  it('Từ chối bắt buộc lý do', () =>
    expect(() =>
      applyCommand(
        createSeed(),
        { type: 'document-action', payload: { id: 'BS018', action: 'reject', reason: ' ' } },
        manager,
      ),
    ).toThrow('lý do'));
  it('Phiếu nhập không thể nhảy từ nháp đến hoàn tất', () => {
    let db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    db = applyCommand(db, { type: 'save-document', payload: receipt(db) }, manager);
    expect(() =>
      applyCommand(
        db,
        { type: 'document-action', payload: { id: db.documents[0].id, action: 'complete' } },
        manager,
      ),
    ).toThrow('chờ hoàn tất');
  });
  it('Một bổ sung không thể có hai phiếu nhập', () => {
    let db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    const input = receipt(db);
    db = applyCommand(db, { type: 'save-document', payload: input }, manager);
    expect(() => applyCommand(db, { type: 'save-document', payload: input }, manager)).toThrow(
      'đã có phiếu nhập',
    );
  });
  it('Hoàn tất nhập tăng tồn đúng một lần và fulfill bổ sung', () => {
    let db = applyCommand(
      createSeed(),
      { type: 'document-action', payload: { id: 'BS018', action: 'approve' } },
      manager,
    );
    const input = receipt(db);
    db = applyCommand(db, { type: 'save-document', payload: input }, manager);
    const id = db.documents[0].id;
    db = applyCommand(db, { type: 'document-action', payload: { id, action: 'submit' } }, manager);
    db = applyCommand(
      db,
      { type: 'document-action', payload: { id, action: 'complete' } },
      manager,
    );
    expect(db.materials[0].stock).toBe(26);
    expect(db.documents.find((d) => d.id === 'BS018')?.status).toBe('fulfilled');
    expect(() =>
      applyCommand(db, { type: 'document-action', payload: { id, action: 'complete' } }, manager),
    ).toThrow();
  });
  it('Lỗi trên dòng thứ hai không làm trừ tồn dòng thứ nhất', () => {
    const db = createSeed();
    db.documents[2].lines = [
      { itemId: 'TP001', quantity: 10 },
      { itemId: 'TP002', quantity: 10000 },
    ];
    expect(() =>
      applyCommand(
        db,
        { type: 'document-action', payload: { id: 'XT009', action: 'approve' } },
        manager,
      ),
    ).toThrow('không đủ tồn');
    expect(db.products[0].stock).toBe(80);
    expect(db.documents[2].status).toBe('pending');
  });
  it('Chặn sửa phiếu đã duyệt', () => {
    const db = createSeed();
    expect(() =>
      applyCommand(db, { type: 'save-document', payload: db.documents[1] }, { userId: 'u-huy' }),
    ).toThrow('không thể chỉnh sửa');
  });
});
