import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  ChefHat,
  CirclePlay,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useDatabase } from '../../data/hooks/useDatabase';
import { useSession } from '../../../app/providers/SessionProvider';
import type { Database, ProductionOrder } from '../../../shared/domain/types';
import {
  activeMaterialIssue,
  canCancelOrder,
  canStartOrder,
  issuedQuantity,
} from '../../../shared/domain/rules';
import { date, number, today } from '../../../shared/domain/format';
import {
  BackLink,
  Badge,
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
import { can } from '../../../shared/domain/permissions';

const orderStatuses = [
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'in_progress', label: 'Đang sản xuất' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'cancelled', label: 'Đã hủy' },
];
export function OrdersPage() {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const wildcard = useParams()['*'];
  const navigate = useNavigate();
  const [editing, setEditing] = useState<ProductionOrder | null>(null);
  const [action, setAction] = useState<'start' | 'cancel' | 'complete' | 'progress' | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [issueNotice, setIssueNotice] = useState('');
  const path = user.role === 'admin' ? '/admin/orders' : '/app/orders';
  useEffect(() => {
    setIssueNotice('');
  }, [wildcard]);
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được lệnh sản xuất.'}
        retry={() => void refetch()}
      />
    );
  const rows = data.orders.filter((o) => user.role !== 'employee' || o.assignedTo === user.id);
  const order = rows.find((o) => o.id === wildcard);
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name || id;
  const assignee = (id: string) =>
    data.users.find((u) => u.id === id)?.name || 'Tài khoản đã ngừng';
  const newOrder = (): ProductionOrder => ({
    id: '',
    items: [{ productId: '', target: 1, completed: 0 }],
    assignedTo: '',
    createdBy: user.id,
    createdAt: '',
    dueDate: today(),
    note: '',
    status: 'pending',
    requirements: [],
    timeline: [],
  });
  if (wildcard === 'new' && !can(user, 'orders', 'create'))
    return <EmptyState title="Bạn không có quyền tạo lệnh" />;
  if (wildcard && wildcard !== 'new' && !order)
    return (
      <EmptyState
        title="Không tìm thấy lệnh được phép xem"
        description="Lệnh không tồn tại hoặc không được giao cho bạn."
        action={<Button onClick={() => navigate(path)}>Về danh sách</Button>}
      />
    );
  const canEdit =
    can(user, 'orders', 'update') &&
    order?.status === 'pending' &&
    !data.documents.some((d) => d.orderId === order.id && d.status !== 'rejected');
  const ready = order ? canStartOrder(data, order) : false;
  const existingIssue = order ? activeMaterialIssue(data, order.id) : undefined;
  const materialShortage = order
    ? order.requirements.some(
        (line) =>
          (data.materials.find((m) => m.id === line.materialId)?.stock || 0) < line.quantity,
      )
    : false;
  const related = data.documents.filter(
    (doc) => doc.orderId === order?.id && (user.role !== 'employee' || doc.createdBy === user.id),
  );
  return (
    <>
      {order ? (
        <>
          <BackLink to={path} />
          <PageHeader
            eyebrow="SẢN XUẤT / CHI TIẾT LỆNH"
            title={order.id}
            description={`Tạo bởi ${assignee(order.createdBy)} · ${date(order.createdAt)}`}
            action={
              <>
                <StatusBadge status={order.status} kind="orders" />
                {user.role === 'admin' && <ReadOnly />}
                {user.role === 'employee' &&
                  order.status === 'pending' &&
                  (ready ? (
                    can(user, 'orders', 'start') && (
                      <Button onClick={() => setAction('start')}>
                        <CirclePlay size={16} />
                        Tiến hành sản xuất
                      </Button>
                    )
                  ) : (
                    <>
                      {can(user, 'requests', 'create') && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (!materialShortage) {
                              setIssueNotice('Không được tạo phiếu bổ sung khi NVL còn đủ');
                            } else {
                              setIssueNotice('');
                              navigate(`/app/requests/new?order=${order.id}`);
                            }
                          }}
                        >
                          <Plus size={15} />
                          Bổ sung NVL
                        </Button>
                      )}
                      {existingIssue ? (
                        can(user, 'material-issues') && (
                          <Link
                            className="button button-primary"
                            to={`/app/material-issues/${existingIssue.id}`}
                          >
                            <ArrowRight size={15} />
                            Xem phiếu xuất NVL
                          </Link>
                        )
                      ) : (
                        can(user, 'material-issues', 'create') && (
                          <Button
                            onClick={() => {
                              if (materialShortage) {
                                setIssueNotice(
                                  'Tồn NVL chưa đủ so với nhu cầu BOM. Hãy tạo phiếu bổ sung và hoàn tất nhập kho trước khi xuất NVL.',
                                );
                              } else {
                                setIssueNotice('');
                                navigate(`/app/material-issues/new?order=${order.id}`);
                              }
                            }}
                          >
                            <ArrowRight size={15} />
                            Xuất NVL
                          </Button>
                        )
                      )}
                    </>
                  ))}
                {user.role === 'employee' && order.status === 'in_progress' && (
                  <>
                    {can(user, 'orders', 'progress') && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQuantities(
                            Object.fromEntries(order.items.map((i) => [i.productId, i.completed])),
                          );
                          setAction('progress');
                        }}
                      >
                        <Pencil size={15} />
                        Cập nhật tiến độ
                      </Button>
                    )}
                    {can(user, 'orders', 'complete') && (
                      <Button onClick={() => setAction('complete')}>
                        <CheckCheck size={16} />
                        Hoàn thành
                      </Button>
                    )}
                  </>
                )}
                {user.role === 'manager' && order.status === 'pending' && (
                  <>
                    {canEdit && (
                      <Button
                        variant="secondary"
                        onClick={() => setEditing(structuredClone(order))}
                      >
                        <Pencil size={15} />
                        Sửa lệnh
                      </Button>
                    )}
                    {can(user, 'orders', 'cancel') && (
                      <Button
                        variant="secondary"
                        disabled={!canCancelOrder(data, order)}
                        title={
                          !canCancelOrder(data, order)
                            ? 'Đã xuất NVL; chưa hỗ trợ hoàn trả nên không thể hủy.'
                            : ''
                        }
                        onClick={() => setAction('cancel')}
                      >
                        Hủy lệnh
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          />
          {issueNotice && <Notice tone="error">{issueNotice}</Notice>}
          <div className="detail-layout">
            <div className="detail-main">
              {order.status === 'pending' && (
                <Notice tone={ready ? 'success' : 'warning'}>
                  <strong>
                    {ready
                      ? 'Đã xuất đủ nguyên liệu. Sẵn sàng sản xuất.'
                      : 'Chưa xuất đủ nguyên liệu để bắt đầu.'}
                  </strong>
                  <p>
                    {ready
                      ? 'Nhân viên được giao có thể tiến hành sản xuất.'
                      : 'Chỉ lượng trên phiếu xuất đã duyệt được tính vào điều kiện bắt đầu.'}
                  </p>
                </Notice>
              )}
              {user.role === 'manager' &&
                order.status === 'pending' &&
                !canCancelOrder(data, order) && (
                  <Notice>
                    Đã có phiếu xuất NVL được duyệt. Chưa hỗ trợ hoàn trả nên không thể hủy lệnh.
                  </Notice>
                )}
              {order.status === 'cancelled' && (
                <Notice tone="error">Lệnh đã hủy. Các thao tác sản xuất được khóa.</Notice>
              )}
              {order.status === 'completed' && (
                <Notice tone="success">
                  Đã hoàn thành. Thành phẩm được nhập kho theo số lượng thực tế.
                </Notice>
              )}
              <Card title="Thành phẩm trong lệnh">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Thành phẩm</th>
                        <th className="numeric">Mục tiêu</th>
                        <th className="numeric">Đã hoàn thành</th>
                        <th>Tiến độ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => {
                        const product = data.products.find((p) => p.id === item.productId);
                        return (
                          <tr key={item.productId}>
                            <td>
                              <strong>{product?.name}</strong>
                              <small className="block">{item.productId}</small>
                              <small className="block">
                                BOM{' '}
                                {item.bomVersion ||
                                  data.boms.find((b) => b.id === item.bomId)?.version ||
                                  item.bomId ||
                                  '1.0'}
                              </small>
                            </td>
                            <td className="numeric">
                              {number(item.target)} {product?.unit}
                            </td>
                            <td className="numeric">
                              <strong>{number(item.completed)}</strong> {product?.unit}
                            </td>
                            <td>
                              <div className="progress-inline">
                                <div className="progress-track">
                                  <span
                                    style={{ width: `${(item.completed / item.target) * 100}%` }}
                                  />
                                </div>
                                <small>{Math.round((item.completed / item.target) * 100)}%</small>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card
                title="Nhu cầu nguyên liệu"
                action={<span className="muted">Theo BOM tại thời điểm tạo lệnh</span>}
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Nguyên liệu</th>
                        <th className="numeric">Cần theo BOM</th>
                        <th className="numeric">Đã xuất</th>
                        <th className="numeric">Chờ duyệt</th>
                        <th>Tình trạng</th>
                        <th className="numeric">Tồn kho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.requirements.map((line) => {
                        const material = data.materials.find((m) => m.id === line.materialId);
                        const issued = issuedQuantity(data, order.id, line.materialId);
                        const pending =
                          issuedQuantity(data, order.id, line.materialId, true) - issued;
                        return (
                          <tr key={line.materialId}>
                            <td>
                              <strong>{material?.name}</strong>
                              <small className="block">{material?.unit}</small>
                            </td>
                            <td className="numeric">{number(line.quantity)}</td>
                            <td className="numeric">{number(issued)}</td>
                            <td className="numeric">{number(pending)}</td>
                            <td>
                              <Badge
                                tone={line.quantity > (material?.stock || 0) ? 'amber' : 'green'}
                              >
                                {line.quantity > (material?.stock || 0) ? 'Còn thiếu' : 'Đủ'}
                              </Badge>
                            </td>
                            <td className="numeric">{number(material?.stock || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Chứng từ liên quan">
                <div className="linked-documents">
                  {related.length ? (
                    related.map((doc) => (
                      <Link
                        key={doc.id}
                        to={`${user.role === 'admin' ? '/admin' : '/app'}/${doc.kind}/${doc.id}`}
                      >
                        <span className="linked-icon">
                          <ClipboardList size={18} />
                        </span>
                        <div>
                          <strong>{doc.id}</strong>
                          <small>
                            {
                              {
                                requests: 'Bổ sung NVL',
                                receipts: 'Nhập NVL',
                                'material-issues': 'Xuất NVL',
                                'product-issues': 'Xuất thành phẩm',
                              }[doc.kind]
                            }
                          </small>
                        </div>
                        <StatusBadge status={doc.status} kind={doc.kind} />
                        <ArrowRight size={14} />
                      </Link>
                    ))
                  ) : (
                    <EmptyState
                      title="Chưa có chứng từ"
                      description="Các phiếu của lệnh sẽ được liên kết tại đây."
                    />
                  )}
                </div>
              </Card>
            </div>
            <aside className="detail-aside">
              <Card title="Thông tin lệnh">
                <div className="card-body">
                  <div className="info-line">
                    <UserRound size={16} />
                    <div>
                      <small>Nhân viên được giao</small>
                      <strong>{assignee(order.assignedTo)}</strong>
                    </div>
                  </div>
                  <div className="info-line">
                    <CalendarDays size={16} />
                    <div>
                      <small>Ngày cần hoàn thành</small>
                      <strong>{date(order.dueDate)}</strong>
                    </div>
                  </div>
                  <div className="aside-note">
                    <small>Ghi chú lệnh</small>
                    <p>{order.note || 'Không có ghi chú.'}</p>
                  </div>
                </div>
              </Card>
              <Card title="Tiến trình xử lý">
                <div className="card-body">
                  <Timeline entries={order.timeline} />
                </div>
              </Card>
            </aside>
          </div>
        </>
      ) : (
        <>
          <PageHeader
            eyebrow="SẢN XUẤT"
            title={user.role === 'employee' ? 'Lệnh được giao' : 'Lệnh sản xuất'}
            description={
              user.role === 'employee'
                ? 'Theo dõi nguyên liệu và hoàn thành từng mẻ bánh của bạn.'
                : 'Lên kế hoạch và theo dõi những mẻ bánh đang được thực hiện.'
            }
            action={
              can(user, 'orders', 'create') ? (
                <Button onClick={() => navigate(`${path}/new`)}>
                  <Plus size={16} />
                  Tạo lệnh sản xuất
                </Button>
              ) : user.role === 'admin' ? (
                <ReadOnly />
              ) : undefined
            }
          />
          {user.role === 'employee' && (
            <div className="employee-banner">
              <span className="employee-banner-icon">
                <ChefHat size={30} />
              </span>
              <div>
                <strong>Chào {user.name.split(' ')[0]}, cùng bắt đầu mẻ bánh mới.</strong>
                <p>
                  Bạn có {rows.filter((o) => o.status === 'pending').length} lệnh chờ xử lý và{' '}
                  {rows.filter((o) => o.status === 'in_progress').length} lệnh đang sản xuất.
                </p>
              </div>
              <Badge tone="green">Không gian sản xuất</Badge>
            </div>
          )}
          <Card>
            <DataTable
              rows={rows}
              searchValue={(o) =>
                `${o.id} ${o.items.map((i) => productName(i.productId)).join(' ')} ${assignee(o.assignedTo)}`
              }
              statuses={orderStatuses}
              statusValue={(o) => o.status}
              dateValue={(o) => o.createdAt}
              onRowClick={(o) => navigate(`${path}/${o.id}`)}
              columns={[
                {
                  key: 'id',
                  label: 'Mã lệnh',
                  sortValue: (o) => o.id,
                  render: (o) => <span className="code">{o.id}</span>,
                },
                {
                  key: 'products',
                  label: 'Thành phẩm',
                  render: (o) => (
                    <div>
                      <strong>{productName(o.items[0].productId)}</strong>
                      {o.items.length > 1 && (
                        <small className="block">+{o.items.length - 1} thành phẩm khác</small>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'assigned',
                  label: 'Người phụ trách',
                  sortValue: (o) => assignee(o.assignedTo),
                  render: (o) => (
                    <div className="person-cell">
                      <span className="avatar small-avatar">{assignee(o.assignedTo)[0]}</span>
                      {assignee(o.assignedTo)}
                    </div>
                  ),
                },
                {
                  key: 'created',
                  label: 'Ngày tạo',
                  sortValue: (o) => o.createdAt,
                  render: (o) => date(o.createdAt),
                },
                {
                  key: 'due',
                  label: 'Ngày hoàn thành',
                  sortValue: (o) => o.dueDate,
                  render: (o) => date(o.dueDate),
                },
                {
                  key: 'status',
                  label: 'Trạng thái',
                  render: (o) => <StatusBadge kind="orders" status={o.status} />,
                },
              ]}
            />
          </Card>
        </>
      )}
      {(editing || wildcard === 'new') && can(user, 'orders', editing ? 'update' : 'create') && (
        <OrderEditor
          db={data}
          initial={editing || newOrder()}
          onClose={() => {
            if (editing) setEditing(null);
            else navigate(path);
          }}
          onSuccess={() => {
            if (!editing) navigate(path);
          }}
        />
      )}
      {order && action && (
        <CommandModal
          title={
            {
              start: 'Tiến hành sản xuất',
              cancel: 'Hủy lệnh sản xuất',
              complete: 'Hoàn thành sản xuất',
              progress: 'Cập nhật tiến độ',
            }[action]
          }
          label={action === 'progress' ? 'Lưu tiến độ' : 'Xác nhận'}
          danger={action === 'cancel'}
          onClose={() => setAction(null)}
          command={{ type: 'order-action', payload: { id: order.id, action, quantities } }}
        >
          {action === 'progress' ? (
            <>
              <Notice tone="info">
                Chỉ cập nhật số lượng hoàn thành. Sản phẩm và mục tiêu được giữ nguyên.
              </Notice>
              {order.items.map((item) => (
                <Field
                  key={item.productId}
                  label={productName(item.productId)}
                  hint={`Mục tiêu: ${number(item.target)}`}
                  required
                >
                  <input
                    aria-label={`Hoàn thành ${productName(item.productId)}`}
                    required
                    type="number"
                    min="0"
                    max={item.target}
                    step="1"
                    value={quantities[item.productId] ?? 0}
                    onChange={(e) =>
                      setQuantities({ ...quantities, [item.productId]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </>
          ) : action === 'complete' ? (
            <>
              <p>
                Xác nhận hoàn thành <strong>{order.id}</strong> và nhập kho theo sản lượng thực tế:
              </p>
              <ul className="quantity-list">
                {order.items.map((i) => (
                  <li key={i.productId}>
                    <span>{productName(i.productId)}</span>
                    <strong>
                      {number(i.completed)} / {number(i.target)}
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          ) : action === 'start' ? (
            <Notice tone="success">
              Đã xuất đủ nguyên liệu theo BOM. Bắt đầu sản xuất lệnh {order.id}?
            </Notice>
          ) : (
            <Notice tone="warning">
              Xác nhận hủy {order.id}? Lệnh đã hủy chỉ được xem và không thể tiếp tục sản xuất.
            </Notice>
          )}
        </CommandModal>
      )}
    </>
  );
}

function OrderEditor({
  db,
  initial,
  onClose,
  onSuccess,
}: {
  db: Database;
  initial: ProductionOrder;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const value = structuredClone(initial);
    value.items = value.items.map((item) => ({
      ...item,
      bomId:
        item.bomId || db.boms.find((b) => b.productId === item.productId && b.active !== false)?.id,
    }));
    return value;
  });
  return (
    <CommandModal
      title={draft.id ? `Chỉnh sửa ${draft.id}` : 'Tạo lệnh sản xuất'}
      wide
      label="Lưu lệnh sản xuất"
      onClose={onClose}
      onSuccess={onSuccess}
      command={{ type: 'save-order', payload: draft }}
    >
      <div className="form-grid">
        <Field label="Nhân viên phụ trách" required>
          <select
            aria-label="Nhân viên phụ trách"
            required
            value={draft.assignedTo}
            onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
          >
            <option value="">Chọn nhân viên</option>
            {db.users
              .filter((u) => u.role === 'employee' && u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Ngày cần hoàn thành" required>
          <input
            aria-label="Ngày cần hoàn thành"
            required
            type="date"
            value={draft.dueDate}
            onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
          />
        </Field>
      </div>
      <label className="section-label">Thành phẩm & số lượng mục tiêu</label>
      <div className="bom-lines">
        {draft.items.map((item, index) => (
          <div className="bom-line order-line" key={index}>
            <select
              aria-label={`Thành phẩm dòng ${index + 1}`}
              required
              value={item.productId}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  items: draft.items.map((i, idx) =>
                    idx === index
                      ? {
                          ...i,
                          productId: e.target.value,
                          bomId: db.boms.find(
                            (b) => b.productId === e.target.value && b.active !== false,
                          )?.id,
                        }
                      : i,
                  ),
                })
              }
            >
              <option value="">Chọn thành phẩm</option>
              {db.products.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  disabled={draft.items.some((i, idx) => idx !== index && i.productId === p.id)}
                >
                  {p.name}
                  {db.boms.some((b) => b.productId === p.id) ? '' : ' · Chưa có BOM'}
                </option>
              ))}
            </select>
            <select
              aria-label={`Chọn phiên bản dòng ${index + 1}`}
              required
              value={item.bomId || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  items: draft.items.map((row, i) =>
                    i === index ? { ...row, bomId: e.target.value } : row,
                  ),
                })
              }
            >
              <option value="">Chọn phiên bản</option>
              {db.boms
                .filter(
                  (b) =>
                    b.productId === item.productId &&
                    (b.active !== false || b.id === initial.items[index]?.bomId),
                )
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.version || '1.0'}
                  </option>
                ))}
            </select>
            <input
              aria-label={`Mục tiêu dòng ${index + 1}`}
              required
              type="number"
              min="1"
              step="1"
              value={item.target}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  items: draft.items.map((i, idx) =>
                    idx === index ? { ...i, target: Number(e.target.value) } : i,
                  ),
                })
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Xóa thành phẩm dòng ${index + 1}`}
              onClick={() =>
                setDraft({ ...draft, items: draft.items.filter((_, idx) => idx !== index) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          setDraft({
            ...draft,
            items: [...draft.items, { productId: '', target: 1, completed: 0 }],
          })
        }
      >
        <Plus size={15} />
        Thêm thành phẩm
      </Button>
      <Field label="Ghi chú">
        <textarea
          aria-label="Ghi chú lệnh"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </Field>
    </CommandModal>
  );
}
