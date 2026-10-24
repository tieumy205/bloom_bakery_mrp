import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCheck,
  FileInput,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useSession } from '../../../app/providers/SessionProvider';
import { useDatabase } from '../../data/hooks/useDatabase';
import type { Database, DocumentKind, StockDocument } from '../../../shared/domain/types';
import {
  activeMaterialIssue,
  issuedQuantity,
  receiptMinimum,
  rounded,
} from '../../../shared/domain/rules';
import { date, dateTime, number, today } from '../../../shared/domain/format';
import { can } from '../../../shared/domain/permissions';
import {
  BackLink,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  ReadOnly,
  StatusBadge,
  Timeline,
} from '../../../shared/ui/primitives';
import { DataTable } from '../../../shared/ui/DataTable';
import { CommandModal } from '../../../shared/ui/CommandModal';

export const documentLabels: Record<DocumentKind, string> = {
  requests: 'Phiếu bổ sung NVL',
  receipts: 'Phiếu nhập NVL',
  'material-issues': 'Phiếu xuất NVL',
  'product-issues': 'Phiếu xuất thành phẩm',
};
const descriptions: Record<DocumentKind, string> = {
  requests: 'Theo dõi yêu cầu nguyên liệu cho sản xuất và tồn tối thiểu.',
  receipts: 'Tiếp nhận nguyên liệu từ các phiếu bổ sung đã được duyệt.',
  'material-issues': 'Xuất nguyên liệu theo định mức của lệnh sản xuất.',
  'product-issues': 'Theo dõi và phê duyệt thành phẩm xuất khỏi kho.',
};

export function DocumentsPage({ kind }: { kind: DocumentKind }) {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const wildcard = useParams()['*'];
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<
    'approve' | 'reject' | 'submit' | 'complete' | 'delete' | null
  >(null);
  const [reason, setReason] = useState('');
  const prefix = user.role === 'admin' ? '/admin' : '/app';
  const path = `${prefix}/${kind}`;
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được phiếu.'}
        retry={() => void refetch()}
      />
    );
  const rows = data.documents.filter(
    (d) => d.kind === kind && (user.role !== 'employee' || d.createdBy === user.id),
  );
  const doc = rows.find((d) => d.id === wildcard);
  const items = kind === 'product-issues' ? data.products : data.materials;
  const owner = (id: string) => data.users.find((u) => u.id === id)?.name || 'Tài khoản đã ngừng';
  const linkedReceipt =
    doc && data.documents.find((d) => d.kind === 'receipts' && d.requestId === doc.id);
  const canEdit =
    !!doc &&
    can(user, kind, 'update') &&
    (kind === 'receipts'
      ? user.role === 'manager' && doc.status === 'draft'
      : user.role === 'employee' && doc.createdBy === user.id && doc.status === 'pending');
  let draft: StockDocument | undefined,
    draftError = '';
  if (wildcard === 'new') {
    try {
      draft = createDocumentDraft(data, kind, params, user.id);
    } catch (e) {
      draftError = e instanceof Error ? e.message : 'Nguồn phiếu không hợp lệ.';
    }
    if (!can(user, kind, 'create')) {
      draftError = 'Bạn không có quyền tạo loại phiếu này.';
      draft = undefined;
    }
  }
  if (wildcard && wildcard !== 'new' && !doc)
    return (
      <EmptyState
        title="Không tìm thấy phiếu được phép xem"
        description="Phiếu không tồn tại hoặc không thuộc phạm vi của bạn."
        action={<Button onClick={() => navigate(path)}>Về danh sách</Button>}
      />
    );
  const statuses =
    kind === 'receipts'
      ? [
          { value: 'draft', label: 'Nháp' },
          { value: 'pending', label: 'Chờ hoàn tất' },
          { value: 'completed', label: 'Đã nhập kho' },
        ]
      : [
          { value: 'pending', label: 'Chờ duyệt' },
          { value: 'approved', label: 'Đã duyệt' },
          { value: 'rejected', label: 'Từ chối' },
          ...(kind === 'requests' ? [{ value: 'fulfilled', label: 'Đã hoàn tất' }] : []),
        ];
  return (
    <>
      {doc ? (
        <>
          <BackLink to={path} />
          <PageHeader
            eyebrow={documentLabels[kind].toUpperCase()}
            title={doc.id}
            description={`Tạo bởi ${owner(doc.createdBy)} · ${date(doc.createdAt)}`}
            action={
              <>
                <StatusBadge kind={kind} status={doc.status} />
                {user.role === 'admin' && <ReadOnly />}
                {canEdit && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil size={15} />
                    Chỉnh sửa
                  </Button>
                )}
                {doc.status === (kind === 'receipts' ? 'draft' : 'pending') &&
                  can(user, kind, 'delete') &&
                  (user.role !== 'employee' || doc.createdBy === user.id) && (
                    <Button variant="ghost" onClick={() => setAction('delete')}>
                      <Trash2 size={15} />
                      Xóa phiếu
                    </Button>
                  )}
                {user.role === 'manager' && doc.status === 'pending' && kind !== 'receipts' && (
                  <>
                    {can(user, kind, 'reject') && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setReason('');
                          setAction('reject');
                        }}
                      >
                        <X size={15} />
                        Từ chối
                      </Button>
                    )}
                    {can(user, kind, 'approve') && (
                      <Button onClick={() => setAction('approve')}>
                        <Check size={15} />
                        Duyệt phiếu
                      </Button>
                    )}
                  </>
                )}
                {can(user, kind, 'update') && kind === 'receipts' && doc.status === 'draft' && (
                  <Button onClick={() => setAction('submit')}>
                    <ArrowRight size={15} />
                    Chuyển chờ hoàn tất
                  </Button>
                )}
                {can(user, kind, 'complete') && kind === 'receipts' && doc.status === 'pending' && (
                  <Button onClick={() => setAction('complete')}>
                    <CheckCheck size={15} />
                    Hoàn tất nhập kho
                  </Button>
                )}
                {user.role === 'manager' &&
                  kind === 'requests' &&
                  doc.status === 'approved' &&
                  (linkedReceipt ? can(user, 'receipts') : can(user, 'receipts', 'create')) &&
                  (linkedReceipt ? (
                    <Link
                      className="button button-primary"
                      to={`${prefix}/receipts/${linkedReceipt.id}`}
                    >
                      <FileInput size={15} />
                      Xem {linkedReceipt.id}
                    </Link>
                  ) : (
                    <Link
                      className="button button-primary"
                      to={`/app/receipts/new?request=${doc.id}`}
                    >
                      <FileInput size={15} />
                      Tạo phiếu nhập NVL
                    </Link>
                  ))}
              </>
            }
          />
          {kind === 'receipts' && <ReceiptSteps status={doc.status} />}
          {doc.rejectionReason && (
            <Notice tone="error">
              <strong>Lý do từ chối</strong>
              <p>{doc.rejectionReason}</p>
            </Notice>
          )}
          <div className="detail-layout">
            <div className="detail-main">
              {kind === 'receipts' && doc.status === 'completed' && (
                <Notice tone="success">
                  Đã nhập kho theo ngày {date(doc.receiptDate)}. Phiếu bổ sung {doc.requestId} đã
                  hoàn tất.
                </Notice>
              )}
              {kind === 'material-issues' && doc.status === 'approved' && (
                <Notice tone="success">
                  Nguyên liệu đã được trừ kho. Lượng xuất được tính vào điều kiện bắt đầu sản xuất.
                </Notice>
              )}
              {kind === 'product-issues' && doc.status === 'approved' && (
                <Notice tone="success">Thành phẩm đã được trừ khỏi kho.</Notice>
              )}
              <Card
                title={
                  kind === 'product-issues' ? 'Thành phẩm trong phiếu' : 'Nguyên liệu trong phiếu'
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{kind === 'product-issues' ? 'Thành phẩm' : 'Nguyên liệu'}</th>
                        <th className="numeric">
                          {kind === 'receipts' ? 'Số lượng nhập' : 'Số lượng yêu cầu'}
                        </th>
                        <th>Đơn vị</th>
                        <th className="numeric">Tồn hiện tại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((line) => {
                        const item = items.find((i) => i.id === line.itemId);
                        return (
                          <tr key={line.itemId}>
                            <td>
                              <strong>{item?.name || line.itemId}</strong>
                              <small className="block">{line.itemId}</small>
                            </td>
                            <td className="numeric">
                              <strong>{number(line.quantity)}</strong>
                            </td>
                            <td>{item?.unit}</td>
                            <td className="numeric">{number(item?.stock || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Nguồn phiếu & ghi chú">
                <div className="card-body">
                  <div className="detail-kv">
                    <span>Nguồn</span>
                    <strong>
                      {doc.source === 'min-stock'
                        ? 'Bổ sung theo tồn tối thiểu'
                        : doc.orderId
                          ? 'Lệnh sản xuất'
                          : doc.requestId
                            ? 'Phiếu bổ sung được duyệt'
                            : 'Xuất thành phẩm từ kho'}
                    </strong>
                    {doc.orderId && (
                      <>
                        <span>Lệnh sản xuất</span>
                        <Link className="text-link" to={`${prefix}/orders/${doc.orderId}`}>
                          {doc.orderId}
                          <ArrowRight size={13} />
                        </Link>
                      </>
                    )}
                    {doc.requestId && (
                      <>
                        <span>Phiếu bổ sung</span>
                        <Link className="text-link" to={`${prefix}/requests/${doc.requestId}`}>
                          {doc.requestId}
                          <ArrowRight size={13} />
                        </Link>
                      </>
                    )}
                    {kind === 'receipts' && (
                      <>
                        <span>Nhà cung cấp</span>
                        <strong>{doc.supplier}</strong>
                        <span>Ngày nhập hàng</span>
                        <strong>{date(doc.receiptDate)}</strong>
                      </>
                    )}
                  </div>
                  <p className="document-note">{doc.note || 'Không có ghi chú.'}</p>
                  {kind === 'requests' && linkedReceipt && (
                    <Link className="text-link" to={`${prefix}/receipts/${linkedReceipt.id}`}>
                      Xem phiếu nhập {linkedReceipt.id}
                      <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </Card>
              {canEdit && kind === 'receipts' && (
                <div className="quiet-action">
                  <Button variant="ghost" onClick={() => setAction('delete')}>
                    <Trash2 size={14} />
                    Xóa phiếu nháp
                  </Button>
                </div>
              )}
            </div>
            <aside className="detail-aside">
              <Card title="Thông tin xử lý">
                <div className="card-body">
                  <div className="aside-info">
                    <small>Người tạo</small>
                    <strong>{owner(doc.createdBy)}</strong>
                  </div>
                  <div className="aside-info">
                    <small>Thời điểm tạo</small>
                    <strong>{dateTime(doc.createdAt)}</strong>
                  </div>
                  {doc.reviewedAt && (
                    <>
                      <div className="aside-info">
                        <small>Người duyệt / từ chối</small>
                        <strong>{owner(doc.reviewedBy || '')}</strong>
                      </div>
                      <div className="aside-info">
                        <small>Thời điểm xét duyệt</small>
                        <strong>{dateTime(doc.reviewedAt)}</strong>
                      </div>
                    </>
                  )}
                </div>
              </Card>
              <Card title="Tiến trình xử lý">
                <div className="card-body">
                  <Timeline entries={doc.timeline} />
                </div>
              </Card>
            </aside>
          </div>
        </>
      ) : (
        <>
          <PageHeader
            eyebrow={user.role === 'employee' ? 'PHIẾU CỦA TÔI' : 'CHỨNG TỪ'}
            title={documentLabels[kind]}
            description={descriptions[kind]}
            action={
              user.role === 'admin' ? (
                <ReadOnly />
              ) : can(user, kind, 'create') && kind === 'product-issues' ? (
                <Button onClick={() => navigate(`${path}/new`)}>
                  <Plus size={16} />
                  Tạo phiếu xuất TP
                </Button>
              ) : undefined
            }
          />
          {user.role === 'employee' && (
            <div className="document-tabs">
              {(['requests', 'material-issues', 'product-issues'] as DocumentKind[])
                .filter((k) => can(user, k))
                .map((k) => (
                  <Link className={kind === k ? 'active' : ''} key={k} to={`/app/${k}`}>
                    {documentLabels[k].replace('Phiếu ', '')}
                  </Link>
                ))}
            </div>
          )}
          {kind === 'receipts' && user.role === 'manager' && (
            <Notice tone="info">
              Tạo phiếu nhập từ chi tiết phiếu bổ sung đã duyệt. Mỗi phiếu bổ sung có tối đa một
              phiếu nhập.
            </Notice>
          )}
          {user.role === 'employee' && kind === 'material-issues' && (
            <Notice tone="info">
              Tạo phiếu xuất NVL từ chi tiết lệnh sản xuất đang chờ xử lý.
            </Notice>
          )}
          <Card>
            <DataTable
              rows={rows}
              searchValue={(d) =>
                `${d.id} ${d.orderId || ''} ${d.requestId || ''} ${owner(d.createdBy)}`
              }
              dateValue={(d) => d.createdAt}
              statuses={statuses}
              statusValue={(d) => d.status}
              onRowClick={(d) => navigate(`${path}/${d.id}`)}
              columns={[
                {
                  key: 'id',
                  label: 'Mã phiếu',
                  sortValue: (d) => d.id,
                  render: (d) => <span className="code">{d.id}</span>,
                },
                {
                  key: 'source',
                  label: 'Nguồn phiếu',
                  render: (d) =>
                    d.requestId ||
                    d.orderId ||
                    (d.source === 'min-stock' ? 'Tồn tối thiểu' : 'Từ kho'),
                },
                {
                  key: 'creator',
                  label: 'Người tạo',
                  sortValue: (d) => owner(d.createdBy),
                  render: (d) => owner(d.createdBy),
                },
                {
                  key: 'lines',
                  label: 'Số mặt hàng',
                  numeric: true,
                  render: (d) => d.lines.length,
                },
                {
                  key: 'date',
                  label: kind === 'receipts' ? 'Ngày nhập hàng' : 'Ngày tạo',
                  sortValue: (d) => (kind === 'receipts' ? d.receiptDate : d.createdAt),
                  render: (d) => date(kind === 'receipts' ? d.receiptDate : d.createdAt),
                },
                {
                  key: 'status',
                  label: 'Trạng thái',
                  render: (d) => <StatusBadge status={d.status} kind={kind} />,
                },
              ]}
            />
          </Card>
        </>
      )}
      {draftError && (
        <Notice tone="error">
          {draftError}{' '}
          <Link className="text-link" to={path}>
            Về danh sách
          </Link>
        </Notice>
      )}
      {(draft || (editing && doc)) && (
        <DocumentEditor
          key={doc?.id || 'new'}
          db={data}
          initial={editing && doc ? doc : draft!}
          onClose={() => {
            setEditing(false);
            if (draft) navigate(path);
          }}
          onSuccess={() => {
            if (draft) navigate(path);
          }}
        />
      )}
      {doc && action && (
        <CommandModal
          title={
            {
              approve: 'Duyệt phiếu',
              reject: 'Từ chối phiếu',
              submit: 'Chuyển chờ hoàn tất',
              complete: 'Hoàn tất nhập kho',
              delete: 'Xóa phiếu',
            }[action]
          }
          label={
            action === 'reject' ? 'Từ chối phiếu' : action === 'delete' ? 'Xóa phiếu' : 'Xác nhận'
          }
          danger={action === 'reject' || action === 'delete'}
          onClose={() => setAction(null)}
          onSuccess={() => {
            if (action === 'delete') navigate(path);
          }}
          command={
            action === 'delete'
              ? { type: 'delete-document', payload: doc.id }
              : {
                  type: 'document-action',
                  payload: { id: doc.id, action, reason: action === 'reject' ? reason : undefined },
                }
          }
        >
          <p>
            {action === 'approve'
              ? `Duyệt phiếu ${doc.id}? ${kind === 'requests' ? 'Sau khi duyệt, bạn có thể tạo phiếu nhập.' : 'Số lượng trên phiếu sẽ được trừ khỏi tồn kho.'}`
              : action === 'reject'
                ? `Từ chối phiếu ${doc.id}. Người tạo sẽ nhận được lý do bên dưới.`
                : action === 'submit'
                  ? 'Chuyển phiếu sang chờ hoàn tất? Nhà cung cấp, ngày nhập hàng, số lượng và ghi chú sẽ được khóa.'
                  : action === 'complete'
                    ? `Xác nhận nhập kho theo ngày ${date(doc.receiptDate)}? Tồn nguyên liệu sẽ tăng và phiếu bổ sung nguồn tự hoàn tất.`
                    : `Xác nhận xóa phiếu ${doc.id}?`}
          </p>
          {action === 'reject' && (
            <Field label="Lý do từ chối" required>
              <textarea
                aria-label="Lý do từ chối"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {action === 'complete' && (
            <ul className="quantity-list">
              {doc.lines.map((line) => (
                <li key={line.itemId}>
                  <span>{items.find((i) => i.id === line.itemId)?.name}</span>
                  <strong>
                    {number(line.quantity)} {items.find((i) => i.id === line.itemId)?.unit}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </CommandModal>
      )}
    </>
  );
}

function ReceiptSteps({ status }: { status: StockDocument['status'] }) {
  const steps = ['draft', 'pending', 'completed'];
  const current = steps.indexOf(status);
  return (
    <div className="receipt-steps">
      {['Nháp', 'Chờ hoàn tất', 'Đã nhập kho'].map((label, index) => (
        <div className={index <= current ? 'step-active' : ''} key={label}>
          <span>{index < current ? <Check size={13} /> : index + 1}</span>
          <strong>{label}</strong>
          {index < 2 && <i />}
        </div>
      ))}
    </div>
  );
}

function createDocumentDraft(
  db: Database,
  kind: DocumentKind,
  params: URLSearchParams,
  userId: string,
): StockDocument {
  const orderId = params.get('order') || undefined;
  const order = db.orders.find((o) => o.id === orderId);
  const base: StockDocument = {
    id: '',
    kind,
    status: kind === 'receipts' ? 'draft' : 'pending',
    orderId,
    createdBy: userId,
    createdAt: '',
    lines: [],
    supplier: '',
    receiptDate: today(),
    note: '',
    timeline: [],
  };
  if (kind === 'receipts') {
    const request = db.documents.find(
      (d) => d.id === params.get('request') && d.kind === 'requests' && d.status === 'approved',
    );
    if (!request) throw new Error('Cần mở từ một phiếu bổ sung đã được duyệt.');
    if (db.documents.some((d) => d.kind === 'receipts' && d.requestId === request.id))
      throw new Error('Phiếu bổ sung đã có phiếu nhập. Vui lòng mở phiếu hiện có.');
    return {
      ...base,
      requestId: request.id,
      orderId: request.orderId,
      source: request.source,
      lines: request.lines.map((l) => ({
        itemId: l.itemId,
        quantity: Math.max(l.quantity, receiptMinimum(db, request, l.itemId)),
      })),
    };
  }
  if (kind === 'requests' || kind === 'material-issues') {
    if (kind === 'material-issues' || orderId) {
      if (!order || order.status !== 'pending' || order.assignedTo !== userId)
        throw new Error('Cần mở từ lệnh chờ xử lý được giao cho bạn.');
      if (kind === 'material-issues' && activeMaterialIssue(db, order.id))
        throw new Error(
          'Lệnh đã có phiếu xuất NVL chờ duyệt hoặc đã duyệt. Vui lòng mở phiếu hiện có; mỗi lệnh chỉ xuất NVL một lần.',
        );
      base.source = 'order';
      base.lines = order.requirements.map((line) => {
        const material = db.materials.find((m) => m.id === line.materialId);
        const remaining = Math.max(
          0,
          line.quantity - issuedQuantity(db, order.id, line.materialId, kind === 'material-issues'),
        );
        return {
          itemId: line.materialId,
          quantity: rounded(
            kind === 'requests' ? Math.max(0, remaining - (material?.stock || 0)) : line.quantity,
          ),
        };
      });
    } else {
      if (params.get('source') !== 'min-stock')
        throw new Error('Tạo bổ sung từ màn tồn nguyên liệu hoặc từ lệnh sản xuất.');
      base.source = 'min-stock';
      const materialId = params.get('material');
      base.lines = db.materials
        .filter((m) => (materialId ? m.id === materialId : m.stock < m.minStock))
        .map((m) => ({ itemId: m.id, quantity: rounded(Math.max(0, m.minStock - m.stock)) }));
    }
  } else {
    if (orderId)
      throw new Error('Chỉ tạo phiếu xuất thành phẩm từ kho, không tạo từ lệnh sản xuất.');
    const productId = params.get('product') || '';
    if (productId && !db.products.some((product) => product.id === productId))
      throw new Error('Thành phẩm không tồn tại trong kho.');
    base.lines = [{ itemId: productId, quantity: 0 }];
  }
  if (kind === 'requests' && !base.lines.some((line) => line.quantity > 0))
    throw new Error('Không được tạo phiếu bổ sung khi NVL còn đủ.');
  if (
    kind === 'material-issues' &&
    base.lines.some(
      (line) => line.quantity > (db.materials.find((m) => m.id === line.itemId)?.stock || 0),
    )
  )
    throw new Error(
      'Tồn NVL chưa đủ. Hãy tạo phiếu bổ sung và hoàn tất nhập kho trước khi xuất NVL.',
    );
  return base;
}

function DocumentEditor({
  db,
  initial,
  onClose,
  onSuccess,
}: {
  db: Database;
  initial: StockDocument;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const value = structuredClone(initial);
    if (value.kind === 'material-issues') {
      const source = db.orders.find((item) => item.id === value.orderId);
      if (source)
        value.lines = source.requirements.map((line) => ({
          itemId: line.materialId,
          quantity: line.quantity,
        }));
    }
    return value;
  });
  const [newSupplier, setNewSupplier] = useState(false);
  const { kind } = draft;
  const receipt = kind === 'receipts',
    productIssue = kind === 'product-issues';
  const request = db.documents.find((d) => d.id === draft.requestId);
  const order = db.orders.find((o) => o.id === draft.orderId);
  const items = productIssue ? db.products : db.materials;
  const setQuantity = (index: number, quantity: number) =>
    setDraft({
      ...draft,
      lines: draft.lines.map((line, i) => (i === index ? { ...line, quantity } : line)),
    });
  return (
    <CommandModal
      title={`${draft.id ? 'Chỉnh sửa' : 'Tạo'} ${documentLabels[kind].toLowerCase()}`}
      wide
      label={receipt ? 'Lưu phiếu nháp' : draft.id ? 'Lưu thay đổi' : 'Gửi chờ duyệt'}
      onClose={onClose}
      onSuccess={onSuccess}
      command={() => ({
        type: 'save-document',
        payload: {
          ...draft,
          lines: receipt ? draft.lines : draft.lines.filter((line) => line.quantity > 0),
        },
      })}
    >
      <div className="context-lock">
        <LockKeyhole size={16} />
        <div>
          <strong>
            {draft.requestId
              ? `Phiếu bổ sung ${draft.requestId}`
              : draft.orderId
                ? `Lệnh sản xuất ${draft.orderId}`
                : productIssue
                  ? 'Xuất thành phẩm từ kho'
                  : 'Bổ sung theo tồn tối thiểu'}
          </strong>
        </div>
      </div>
      {receipt && (
        <div className="form-grid">
          <Field label="Nhà cung cấp" required>
            <select
              aria-label="Nhà cung cấp"
              required
              value={newSupplier ? '__new__' : draft.supplier}
              onChange={(e) => {
                setNewSupplier(e.target.value === '__new__');
                setDraft({
                  ...draft,
                  supplier: e.target.value === '__new__' ? '' : e.target.value,
                });
              }}
            >
              <option value="">Chọn nhà cung cấp</option>
              {(db.suppliers || []).map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
              {draft.supplier &&
                !newSupplier &&
                !(db.suppliers || []).some((s) => s.name === draft.supplier) && (
                  <option value={draft.supplier}>{draft.supplier}</option>
                )}
              <option value="__new__">+ Thêm nhà cung cấp khác</option>
            </select>
            {newSupplier && (
              <input
                aria-label="Tên nhà cung cấp mới"
                placeholder="Tên nhà cung cấp mới"
                required
                value={draft.supplier}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              />
            )}
          </Field>
          <Field label="Ngày nhập hàng" required>
            <input
              aria-label="Ngày nhập hàng"
              type="date"
              required
              max={today()}
              value={draft.receiptDate}
              onChange={(e) => setDraft({ ...draft, receiptDate: e.target.value })}
            />
          </Field>
        </div>
      )}
      {kind === 'material-issues' && (
        <Notice tone="info">
          Mỗi lệnh chỉ xuất NVL một lần, đủ toàn bộ định mức BOM. Số lượng được điền sẵn và khóa;
          nếu tồn chưa đủ, hãy bổ sung trước khi gửi. Phiếu bị từ chối có thể được thay thế bằng
          phiếu mới.
        </Notice>
      )}
      {kind === 'requests' && (
        <p className="form-note">
          {order
            ? 'Gợi ý = phần còn cần theo BOM − tồn hiện tại. Tồn tối thiểu hiển thị riêng để tham khảo.'
            : 'Gợi ý = tồn tối thiểu − tồn hiện tại (không nhỏ hơn 0).'}{' '}
          Bạn có thể điều chỉnh lượng yêu cầu.
        </p>
      )}
      <div className="table-scroll editor-table">
        <table>
          <thead>
            <tr>
              <th>{productIssue ? 'Thành phẩm' : 'Nguyên liệu'}</th>
              <th className="numeric">Tồn</th>
              {kind === 'requests' && (
                <th className="numeric">{order ? 'Còn cần / Tối thiểu' : 'Tồn tối thiểu'}</th>
              )}
              {kind === 'material-issues' && <th className="numeric">Nhu cầu BOM</th>}
              {receipt && (
                <>
                  <th className="numeric">Số lượng yêu cầu</th>
                </>
              )}
              <th className="numeric">{receipt ? 'Số lượng nhập' : 'Số lượng yêu cầu'}</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line, index) => {
              const item = items.find((i) => i.id === line.itemId);
              const remaining = order
                ? Math.max(
                    0,
                    (order.requirements.find((l) => l.materialId === line.itemId)?.quantity || 0) -
                      issuedQuantity(
                        db,
                        order.id,
                        line.itemId,
                        kind === 'material-issues',
                        draft.id || undefined,
                      ),
                  )
                : 0;
              const minimum = receipt && request ? receiptMinimum(db, request, line.itemId) : 0;
              const max =
                kind === 'material-issues'
                  ? order?.requirements.find((l) => l.materialId === line.itemId)?.quantity
                  : productIssue
                    ? item?.stock || 0
                    : undefined;
              return (
                <tr key={`${index}-${line.itemId}`}>
                  <td>
                    {productIssue && !order ? (
                      <select
                        aria-label={`Thành phẩm xuất dòng ${index + 1}`}
                        required
                        value={line.itemId}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            lines: draft.lines.map((l, i) =>
                              i === index ? { ...l, itemId: e.target.value, quantity: 0 } : l,
                            ),
                          })
                        }
                      >
                        <option value="">Chọn thành phẩm</option>
                        {db.products.map((p) => (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={draft.lines.some((l, i) => i !== index && l.itemId === p.id)}
                          >
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <strong>{item?.name || line.itemId}</strong>
                        <small className="block">{line.itemId}</small>
                      </>
                    )}
                  </td>
                  <td className="numeric">
                    {number(item?.stock || 0)} {item?.unit}
                  </td>
                  {kind === 'requests' && (
                    <td className="numeric">
                      {order && `${number(remaining)} / `}
                      {number(item && 'minStock' in item ? item.minStock : 0)} {item?.unit}
                    </td>
                  )}
                  {kind === 'material-issues' && (
                    <td className="numeric">
                      {number(remaining)} {item?.unit}
                    </td>
                  )}
                  {receipt && (
                    <>
                      <td className="numeric">
                        {number(
                          request?.lines.find((l) => l.itemId === line.itemId)?.quantity || 0,
                        )}
                      </td>
                    </>
                  )}
                  <td className="numeric">
                    <input
                      aria-label={`Số lượng ${item?.name || `dòng ${index + 1}`}`}
                      type="number"
                      required
                      step={productIssue ? '1' : 'any'}
                      min={receipt ? Math.max(minimum, 0.000001) : 0}
                      max={max}
                      readOnly={kind === 'material-issues'}
                      value={line.quantity}
                      onChange={(e) => setQuantity(index, Number(e.target.value))}
                    />
                    <small className="block">{item?.unit}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!draft.lines.length && (
        <Notice>Không có dòng nguyên liệu phù hợp. Kiểm tra lại nguồn phiếu.</Notice>
      )}
      {productIssue && !order && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setDraft({ ...draft, lines: [...draft.lines, { itemId: '', quantity: 0 }] })
          }
        >
          <Plus size={14} />
          Thêm thành phẩm
        </Button>
      )}
      <Field label="Ghi chú">
        <textarea
          aria-label="Ghi chú phiếu"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </Field>
    </CommandModal>
  );
}
