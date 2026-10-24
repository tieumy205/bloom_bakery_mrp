import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChefHat,
  CircleCheck,
  ClipboardCheck,
  Package,
  Plus,
  Wheat,
} from 'lucide-react';
import { useSession } from '../../../app/providers/SessionProvider';
import { useDatabase } from '../../data/hooks/useDatabase';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
  TextLink,
} from '../../../shared/ui/primitives';
import { date, number, today } from '../../../shared/domain/format';
import { documentLabels } from '../../documents/pages/DocumentsPage';

export function DashboardPage() {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const [tab, setTab] = useState<'materials' | 'products'>('materials');
  const [search, setSearch] = useState('');
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được tổng quan.'}
        retry={() => void refetch()}
      />
    );
  const low = data.materials.filter((m) => m.stock < m.minStock);
  const waiting = data.documents.filter((d) => d.status === 'pending' && d.kind !== 'receipts');
  const running = data.orders.filter((o) => o.status === 'in_progress');
  const completed = data.orders.filter((o) => o.status === 'completed');
  const stock = data[tab].filter((item) =>
    `${item.id} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="KHÔNG GIAN LÀM VIỆC"
        title="Tổng quan kho"
        description="Mọi thứ bạn cần để vận hành một ngày làm bánh suôn sẻ."
        action={
          <span className="date-chip">
            <CalendarDays size={15} />
            {date(today())}
          </span>
        }
      />
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">
            <span /> MỘT NGÀY MỚI TẠI BLOOM
          </span>
          <h2>
            Chào {user.name.split(' ')[0]},<br />
            sẵn sàng cho những mẻ bánh mới?
          </h2>
          <p>
            {waiting.length
              ? `Có ${waiting.length} phiếu đang chờ bạn duyệt. Cùng kiểm tra kho và kế hoạch hôm nay.`
              : 'Các phiếu đã được xử lý. Cùng kiểm tra kho và kế hoạch hôm nay.'}
          </p>
          <Link className="button button-primary" to="/app/orders/new">
            <Plus size={15} />
            Tạo lệnh sản xuất
          </Link>
          <Link className="welcome-link" to="/app/orders">
            Xem kế hoạch <ArrowRight size={13} />
          </Link>
        </div>
        <div className="bakery-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-leaf leaf-one" />
          <div className="art-leaf leaf-two" />
          <div className="art-bread">
            <i />
            <i />
            <i />
          </div>
          <div className="art-label">
            <Wheat size={15} /> FRESHLY PLANNED, DAILY.
          </div>
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✧</span>
        </div>
      </section>
      <div className="stat-grid">
        <Link to="/app/materials?status=low" className="dashboard-stat">
          <div>
            <span className="stat-caption">Nguyên liệu tồn thấp</span>
            <span className="stat-icon amber">
              <Wheat size={19} />
            </span>
          </div>
          <strong>
            {low.length}
            <small>nguyên liệu</small>
          </strong>
          <p>
            <span className="tiny-dot amber-bg" />
            {low.length ? 'Cần kiểm tra bổ sung' : 'Tồn kho đảm bảo'}
          </p>
        </Link>
        <Link
          to={`/app/${waiting[0]?.kind || 'requests'}?status=pending`}
          className="dashboard-stat"
        >
          <div>
            <span className="stat-caption">Phiếu chờ duyệt</span>
            <span className="stat-icon blue">
              <ClipboardCheck size={19} />
            </span>
          </div>
          <strong>
            {waiting.length}
            <small>phiếu</small>
          </strong>
          <p>
            {waiting.length ? 'Xử lý để tiếp tục sản xuất' : 'Đã xử lý tất cả'}
            <ArrowUpRight size={13} />
          </p>
        </Link>
        <Link to="/app/orders?status=in_progress" className="dashboard-stat">
          <div>
            <span className="stat-caption">Đang sản xuất</span>
            <span className="stat-icon green">
              <ChefHat size={19} />
            </span>
          </div>
          <strong>
            {running.length}
            <small>lệnh</small>
          </strong>
          <p>
            <span className="tiny-dot green-bg" />
            Đang thực hiện tại xưởng
          </p>
        </Link>
        <Link to="/app/orders?status=completed" className="dashboard-stat">
          <div>
            <span className="stat-caption">Lệnh đã hoàn thành</span>
            <span className="stat-icon rose">
              <CircleCheck size={19} />
            </span>
          </div>
          <strong>
            {completed.length}
            <small>lệnh</small>
          </strong>
          <p>
            Trong dữ liệu hiện tại
            <ArrowUpRight size={13} />
          </p>
        </Link>
      </div>
      <div className="dashboard-columns">
        <Card
          title={
            <>
              <ClipboardCheck size={17} /> Cần phê duyệt{' '}
              <span className="section-count">{waiting.length}</span>
            </>
          }
          action={
            <TextLink to={`/app/${waiting[0]?.kind || 'requests'}?status=pending`}>
              Xem phiếu
            </TextLink>
          }
        >
          <div className="approval-list">
            {waiting.slice(0, 4).map((doc) => (
              <Link key={doc.id} to={`/app/${doc.kind}/${doc.id}`}>
                <span
                  className={`approval-icon ${doc.kind === 'requests' ? 'amber-icon' : 'blue-icon'}`}
                >
                  {doc.kind === 'requests' ? (
                    <ArrowDownLeft size={20} />
                  ) : (
                    <ArrowUpRight size={20} />
                  )}
                </span>
                <div>
                  <strong>{documentLabels[doc.kind]}</strong>
                  <small>
                    {doc.id} <i />
                    {data.users.find((u) => u.id === doc.createdBy)?.name}
                  </small>
                </div>
                <StatusBadge kind={doc.kind} status={doc.status} />
                <ArrowRight size={14} />
              </Link>
            ))}
            {!waiting.length && (
              <EmptyState
                title="Không có phiếu chờ duyệt"
                description="Bạn đã xử lý hết các yêu cầu hiện tại."
              />
            )}
          </div>
          <div className="approval-summary">
            {(['requests', 'material-issues', 'product-issues'] as const).map((kind) => (
              <Link to={`/app/${kind}?status=pending`} key={kind}>
                <strong>{waiting.filter((d) => d.kind === kind).length}</strong>
                <span>
                  {kind === 'requests'
                    ? 'Bổ sung NVL'
                    : kind === 'material-issues'
                      ? 'Xuất NVL'
                      : 'Xuất TP'}
                </span>
              </Link>
            ))}
          </div>
        </Card>
        <Card
          title={
            <>
              <Wheat size={17} /> Cảnh báo tồn thấp
            </>
          }
          action={<Badge tone="amber">{low.length} cần chú ý</Badge>}
        >
          <div className="low-stock-list">
            {low.slice(0, 4).map((material) => (
              <Link to={`/app/materials/${material.id}`} key={material.id}>
                <div>
                  <strong>{material.name}</strong>
                  <span>
                    <b>{number(material.stock)}</b> / {number(material.minStock)} {material.unit}
                  </span>
                </div>
                <div className="stock-level">
                  <span
                    style={{
                      width: `${Math.max(2, Math.min(100, (material.stock / material.minStock) * 100))}%`,
                    }}
                  />
                </div>
              </Link>
            ))}
            {!low.length && (
              <EmptyState
                title="Nguyên liệu đảm bảo"
                description="Chưa có nguyên liệu dưới tồn tối thiểu."
              />
            )}
          </div>
          <div className="card-bottom-link">
            <TextLink to="/app/materials?status=low">Kiểm tra tồn nguyên liệu</TextLink>
            <span>So với mức tồn tối thiểu</span>
          </div>
        </Card>
      </div>
      <Card
        title={
          <>
            <ChefHat size={18} /> Lệnh đang sản xuất
          </>
        }
        action={<TextLink to="/app/orders?status=in_progress">Tất cả lệnh</TextLink>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã lệnh</th>
                <th>Thành phẩm</th>
                <th>Người phụ trách</th>
                <th>Tiến độ theo sản phẩm</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {running.slice(0, 4).map((order) => (
                <tr
                  key={order.id}
                  className="clickable-row"
                  onClick={() => {
                    window.location.href = `/app/orders/${order.id}`;
                  }}
                >
                  <td>
                    <Link className="code" to={`/app/orders/${order.id}`}>
                      {order.id}
                    </Link>
                  </td>
                  <td>
                    <strong>
                      {data.products.find((p) => p.id === order.items[0].productId)?.name}
                    </strong>
                    {order.items.length > 1 && (
                      <small className="block">+{order.items.length - 1} thành phẩm</small>
                    )}
                  </td>
                  <td>
                    <div className="person-cell">
                      <span className="avatar small-avatar">
                        {data.users.find((u) => u.id === order.assignedTo)?.name[0]}
                      </span>
                      {data.users.find((u) => u.id === order.assignedTo)?.name}
                    </div>
                  </td>
                  <td>
                    {order.items.map((item) => (
                      <div className="dashboard-progress" key={item.productId}>
                        <small>{data.products.find((p) => p.id === item.productId)?.name}</small>
                        <div>
                          <div className="progress-track">
                            <span style={{ width: `${(item.completed / item.target) * 100}%` }} />
                          </div>
                          <span>
                            {number(item.completed)}/{number(item.target)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </td>
                  <td>
                    <StatusBadge kind="orders" status={order.status} />
                  </td>
                  <td>
                    <ArrowUpRight size={15} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!running.length && (
          <EmptyState
            title="Chưa có lệnh đang sản xuất"
            description="Các lệnh bắt đầu sẽ xuất hiện ở đây."
          />
        )}
      </Card>
      <Card
        title={
          <>
            <Package size={17} /> Tồn kho nhanh
          </>
        }
        action={<TextLink to={`/app/${tab}`}>Xem danh mục</TextLink>}
      >
        <div className="quick-stock-toolbar">
          <div className="segmented">
            <button
              className={tab === 'materials' ? 'active' : ''}
              onClick={() => setTab('materials')}
            >
              Nguyên liệu
            </button>
            <button
              className={tab === 'products' ? 'active' : ''}
              onClick={() => setTab('products')}
            >
              Thành phẩm
            </button>
          </div>
          <input
            aria-label="Tìm tồn kho nhanh"
            placeholder="Tìm nguyên liệu, thành phẩm…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="quick-stock-grid">
          {stock.slice(0, 6).map((item) => (
            <Link to={`/app/${tab}/${item.id}`} key={item.id}>
              <span
                className={`item-thumb ${tab === 'materials' ? 'material-thumb' : 'product-thumb'}`}
              >
                {tab === 'materials' ? <Wheat size={18} /> : <Package size={18} />}
              </span>
              <div>
                <small>{item.id}</small>
                <strong>{item.name}</strong>
              </div>
              <span
                className={'minStock' in item && item.stock < item.minStock ? 'amber-text' : ''}
              >
                {number(item.stock)}
                <small>{item.unit}</small>
              </span>
            </Link>
          ))}
        </div>
        {!stock.length && <EmptyState title="Không tìm thấy mặt hàng" />}
      </Card>
    </>
  );
}
